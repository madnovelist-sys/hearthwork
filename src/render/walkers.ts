// The little people. Purely cosmetic: they walk between home, work and the
// fire along worn paths, and go indoors when the city sleeps.
import { buildCostGrid, findPath } from '../sim/path';
import { currentTarget } from '../sim/forest';
import { doorOf, workSite } from '../sim/planner';
import { hashString } from '../sim/rng';
import { TREE, type GameState, type Person } from '../sim/types';
import { ageOf } from '../sim/world';
import { dirOf, type Dir } from './citizens';

export interface Walker {
  id: number;
  x: number;
  y: number;
  /** Where they're walking: points anywhere on the map, not tile centres. */
  path: { x: number; y: number }[] | null;
  seg: number;
  /** Their velocity, in tiles a second (they turn smoothly rather than snapping). */
  vx: number;
  vy: number;
  /** How far they've walked, in screen px at zoom 1: their steps follow it, so feet don't slide. */
  stride: number;
  waitUntil: number;
  next: 'work' | 'social' | 'home';
  alpha: number;
  inside: boolean;
  offX: number;
  offY: number;
  speed: number;
  facing: number;
  /** Which way they're walking on screen (for the painted villagers' front, back and side views). */
  dir: Dir;
  moving: boolean;
}

const MAX_WALKERS = 450;

export class Walkers {
  list = new Map<number, Walker>();
  private grid: Float32Array | null = null;
  private gridAt = 0;
  private gridKey = '';
  private treeTiles: number[] = [];
  private treesAt = 0;

  private crowd = new Map<number, Walker[]>();

  /** How much people keep indoors (0..1, from the weather), and whether the fields lie fallow. */
  indoor = 0;
  fieldsAsleep = false;
  frozen = false;
  get cold() { return this.indoor > 0.5; }

  update(s: GameState, now: number, dtMs: number, night: number) {
    const dt = Math.max(0, Math.min(dtMs, 100)) / 1000;
    const key = `${s.buildings.length}:${s.day >> 3}`;
    if (!this.grid || (key !== this.gridKey && now - this.gridAt > 3000)) {
      this.grid = buildCostGrid(s.map, s.buildings);
      this.gridAt = now;
      this.gridKey = key;
    }
    if (now - this.treesAt > 10_000) this.collectTrees(s, now);

    // Who's walking where, so people can step around each other.
    this.crowd.clear();
    for (const w of this.list.values()) {
      if (!w.path || w.alpha < 0.3) continue;
      const k = Math.floor(w.x) * 4096 + Math.floor(w.y);
      const cell = this.crowd.get(k);
      if (cell) cell.push(w); else this.crowd.set(k, [w]);
    }

    const seen = new Set<number>();
    let n = 0;
    for (const p of s.people) {
      if (!p.alive || p.away !== undefined || p.home === undefined) continue;
      if (++n > MAX_WALKERS) break;
      seen.add(p.id);
      let w = this.list.get(p.id);
      const home = s.buildings[p.home];
      if (!home || home.removed) continue;
      const door = doorOf(home);
      if (!w) {
        const h = hashString(`w${p.id}`);
        w = {
          id: p.id, x: door.x + 0.5, y: door.y + 0.5, path: null, seg: 0,
          waitUntil: now + (h % 4000), next: 'work', alpha: 0, inside: true,
          offX: ((h % 100) / 100 - 0.5) * 0.5, offY: (((h >> 8) % 100) / 100 - 0.5) * 0.5,
          speed: 0.75 + ((h >> 16) % 30) / 100, facing: 1, dir: 'down', moving: false, vx: 0, vy: 0, stride: (h >> 3) % 17,
        };
        this.list.set(p.id, w);
      }
      const age = ageOf(s, p);
      const speed = w.speed * (age < 10 ? 1.15 : age >= 60 ? 0.65 : 1);
      const stayIn = !!(p.sick || p.injured) || night > 0.55;
      // A leg ends; arriving home means going indoors.
      const arrive = () => {
        const atHome = w!.next === 'work';
        w!.path = null;
        w!.inside = atHome;
        w!.waitUntil = now + this.stay(p, w!, atHome);
      };

      // Night falls (or they're unwell): head home.
      if (stayIn && !w.inside && w.next !== 'work') {
        w.next = 'work';
        if (!this.go(s, w, door, now)) arrive();
      }

      w.moving = false;
      if (w.path && w.seg < w.path.length) {
        if (this.walk(s, w, speed, dt)) arrive();
        else {
          w.moving = true;
          w.inside = false;
          w.alpha = Math.min(1, w.alpha + dt * 3);
        }
        continue;
      }
      w.vx = 0; w.vy = 0;
      if (w.inside) w.alpha = Math.max(0, w.alpha - dt * 2.5);
      else w.alpha = Math.min(1, w.alpha + dt * 3);
      if (now < w.waitUntil || stayIn) continue;

      // The next leg: home, then work, then somewhere social, then home again.
      // In the cold or the wet, most people keep indoors; those whose work is outside still go.
      const leg = w.next;
      const roll = hashString(`${p.id}:${Math.floor(now / 15000)}`) % 100;
      if (leg === 'work' && roll < this.indoor * 100 && !this.mustGoOut(p)) {
        w.waitUntil = now + 4000 + roll * 80;
        continue;
      }
      if (leg === 'social' && roll < this.indoor * 100) w.next = 'home';
      const going = w.next;
      const target = going === 'work' ? this.workTarget(s, p, home) : going === 'social' ? this.socialTarget(s, p, now) : door;
      w.next = going === 'work' ? 'social' : going === 'social' ? 'home' : 'work';
      if (!target || !this.go(s, w, target, now)) arrive();
    }
    for (const id of [...this.list.keys()]) if (!seen.has(id)) this.list.delete(id);
  }

  /**
   * After the window was hidden (no frames, so nobody moved), put everyone where they might
   * plausibly be by now: indoors, at work, or out and about. Cheap: no paths are walked.
   */
  scatter(s: GameState, now: number, night: number) {
    for (const w of this.list.values()) {
      const p = s.people[w.id];
      if (!p || p.home === undefined) continue;
      const home = s.buildings[p.home];
      if (!home || home.removed) continue;
      const door = doorOf(home);
      const h = hashString(`${w.id}:${Math.floor(now / 1000)}`);
      const roll = h % 100;
      const stayIn = !!(p.sick || p.injured) || night > 0.55 || this.cold;
      let at: { x: number; y: number } | null = null;
      if (!stayIn && roll < 45) { at = this.workTarget(s, p, door); w.next = 'social'; }
      else if (!stayIn && roll < 65) { at = this.socialTarget(s, p, now); w.next = 'home'; }
      w.path = null;
      w.seg = 0;
      w.moving = false;
      w.vx = 0; w.vy = 0;
      if (at) {
        w.x = at.x + 0.5 + w.offX; w.y = at.y + 0.5 + w.offY;
        w.inside = false; w.alpha = 1;
        w.waitUntil = now + (h % 6000);
      } else {
        w.x = door.x + 0.5; w.y = door.y + 0.5;
        w.inside = true; w.alpha = 0; w.next = 'work';
        w.waitUntil = now + 1000 + ((h >> 4) % 8000);
      }
    }
  }

  private stay(p: Person, w: Walker, atHome: boolean): number {
    const h = hashString(`${p.id}:${Math.floor(w.x * 7 + w.y * 13)}`) % 1000;
    if (atHome) return 1500 + h * 3;
    if (w.next === 'social') return 5000 + h * 7; // just arrived at work
    return 2500 + h * 4;
  }

  /** Start walking somewhere. Returns false if there's no way (or no need) to get there. */
  private go(s: GameState, w: Walker, to: { x: number; y: number }, now: number): boolean {
    const fx = Math.floor(w.x);
    const fy = Math.floor(w.y);
    if (fx === to.x && fy === to.y) return false;
    const tiles = findPath(s.map, s.buildings, fx, fy, to.x, to.y, 2500, this.grid ?? undefined);
    if (!tiles || tiles.length < 2) return false;
    w.path = this.route(s, w, tiles);
    w.seg = 0;
    w.waitUntil = now;
    w.inside = false;
    return true;
  }

  /**
   * Turn a path of tiles into a walk: from where they stand, in straight lines at any angle,
   * taking a shortcut wherever it's clear of buildings and water and costs no more than the way
   * round (so worn paths and roads still draw people onto them), ending a little off the
   * destination's centre (everyone has their own spot).
   */
  private route(s: GameState, w: Walker, tiles: number[]): { x: number; y: number }[] {
    const mw = s.map.w;
    const goal = tiles[tiles.length - 1];
    const pts = tiles.map((ti, k) => {
      const cx = (ti % mw) + 0.5, cy = Math.floor(ti / mw) + 0.5;
      // Each walker keeps a little to one side of the way (where there's room).
      const lane = k === 0 ? null : { x: cx + w.offX * 0.7, y: cy + w.offY * 0.7 };
      return lane && this.open(s, lane.x, lane.y, goal) ? lane : { x: cx, y: cy };
    });
    pts[0] = { x: w.x, y: w.y };
    // The cost of walking the tile path up to each point.
    const cum = [0];
    for (let k = 1; k < tiles.length; k++) {
      const step = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
      cum.push(cum[k - 1] + step * this.costAt(tiles[k], goal));
    }
    // From each corner, reach as far along the way as a straight line allows (a few points at
    // most, which keeps it cheap when everyone sets out at once).
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      while (j + 1 < pts.length && j + 1 - i <= 8
        && this.clear(s, pts[i], pts[j + 1], goal)
        && this.lineCost(s, pts[i], pts[j + 1], goal) <= (cum[j + 1] - cum[i]) * 1.06 + 0.05) j++;
      out.push(pts[j]);
      i = j;
    }
    return out.slice(1);
  }

  private costAt(ti: number, goal: number): number {
    if (ti === goal) return 1;
    const c = this.grid?.[ti] ?? 1;
    return isFinite(c) ? c : 50;
  }

  /** A spot someone can stand on: open ground (or the tile they're heading for). */
  private open(s: GameState, x: number, y: number, goal: number): boolean {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= s.map.w || ty >= s.map.h) return false;
    const i = ty * s.map.w + tx;
    return i === goal || isFinite(this.grid?.[i] ?? 1);
  }

  /** A straight walk from a to b that keeps clear of buildings, walls and water. */
  private clear(s: GameState, a: { x: number; y: number }, b: { x: number; y: number }, goal: number): boolean {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.ceil(d / 0.25);
    const px = -(b.y - a.y) / (d || 1) * 0.22, py = (b.x - a.x) / (d || 1) * 0.22;
    for (let k = 1; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n;
      if (!this.open(s, x + px, y + py, goal) || !this.open(s, x - px, y - py, goal)) return false;
    }
    return true;
  }

  private lineCost(s: GameState, a: { x: number; y: number }, b: { x: number; y: number }, goal: number): number {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / 0.25));
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const x = a.x + ((b.x - a.x) * (k + 0.5)) / n, y = a.y + ((b.y - a.y) * (k + 0.5)) / n;
      sum += this.costAt(Math.floor(y) * s.map.w + Math.floor(x), goal);
    }
    return (sum * d) / n;
  }

  /**
   * A step along the walk: steer toward the next point (turning smoothly, easing in at the end),
   * step around anyone close by, and never onto a building or into the water. Returns true on
   * arriving.
   */
  private walk(s: GameState, w: Walker, speed: number, dt: number): boolean {
    const path = w.path!;
    let wp = path[w.seg];
    let dx = wp.x - w.x, dy = wp.y - w.y;
    let d = Math.hypot(dx, dy);
    const last = w.seg === path.length - 1;
    // Round the corners: move on to the next point a little before reaching this one.
    if (!last && d < 0.35) { w.seg++; wp = path[w.seg]; dx = wp.x - w.x; dy = wp.y - w.y; d = Math.hypot(dx, dy); }
    if (w.seg === path.length - 1 && d < 0.06) { w.x = wp.x; w.y = wp.y; w.seg = path.length; w.vx = 0; w.vy = 0; return true; }
    const goal = Math.floor(path[path.length - 1].y) * s.map.w + Math.floor(path[path.length - 1].x);
    const ease = w.seg === path.length - 1 ? Math.min(1, 0.35 + d / 0.6) : 1;
    let ux = (dx / d) * speed * ease, uy = (dy / d) * speed * ease;
    // Step around people close by.
    const cx = Math.floor(w.x), cy = Math.floor(w.y);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      for (const o of this.crowd.get((cx + ox) * 4096 + cy + oy) ?? []) {
        if (o === w) continue;
        const ex = w.x - o.x, ey = w.y - o.y;
        const e = Math.hypot(ex, ey);
        if (e > 0.32 || e < 1e-4) continue;
        const push = (1 - e / 0.32) * 0.7;
        ux += (ex / e) * push; uy += (ey / e) * push;
      }
    }
    const turn = Math.min(1, dt * 7);
    w.vx += (ux - w.vx) * turn;
    w.vy += (uy - w.vy) * turn;
    let nx = w.x + w.vx * dt, ny = w.y + w.vy * dt;
    if (!this.open(s, nx, ny, goal)) {
      // Slide along whatever's in the way, or else head straight for the next point.
      if (this.open(s, nx, w.y, goal)) ny = w.y;
      else if (this.open(s, w.x, ny, goal)) nx = w.x;
      else { nx = w.x + (dx / d) * speed * dt; ny = w.y + (dy / d) * speed * dt; }
    }
    const mx = nx - w.x, my = ny - w.y;
    w.x = nx; w.y = ny;
    // Steps follow the ground covered on screen (a stride is about 17 px at zoom 1).
    w.stride += Math.hypot((mx - my) * 32, (mx + my) * 16);
    if (Math.abs(mx - my) > 1e-4) w.facing = mx - my > 0 ? 1 : -1;
    w.dir = dirOf(w.vx, w.vy, w.dir);
    return false;
  }

  /** Whose work takes them outside whatever the weather. */
  private mustGoOut(p: Person): boolean {
    if (p.job === 'fisher') return !this.frozen;
    return p.job === 'woodcutter' || p.job === 'herder' || p.job === 'gatherer' || p.job === 'builder' || p.job === 'smith' || p.job === 'potter' || p.job === 'healer' || (p.job === 'farmer' && !this.fieldsAsleep);
  }

  private workTarget(s: GameState, p: Person, home: { x: number; y: number }): { x: number; y: number } | null {
    const h = hashString(`${p.id}:${s.day}`);
    if (p.job === 'child') return this.near(s, s.hearth, 3, h) ?? this.near(s, home, 2, h);
    // In winter, farmers go hunting in the woods instead.
    if (p.job === 'farmer' && this.fieldsAsleep) {
      if (this.treeTiles.length && h % 3) {
        const t = this.treeTiles[h % this.treeTiles.length];
        return this.adjacent(s, t % s.map.w, Math.floor(t / s.map.w));
      }
      return this.near(s, home, 7, h);
    }
    const felling = currentTarget(s);
    if (p.job === 'woodcutter' && (felling >= 0 || this.treeTiles.length)) {
      const t = felling >= 0 ? felling : this.treeTiles[h % this.treeTiles.length];
      return this.adjacent(s, t % s.map.w, Math.floor(t / s.map.w));
    }
    if (p.job === 'gatherer') return this.near(s, home, 7, h);
    const site = workSite(s, p);
    if (site && p.job === 'farmer') return { x: site.x - (h % 2), y: site.y - ((h >> 1) % 2) };
    return site ?? this.near(s, s.hearth, 3, h);
  }

  private socialTarget(s: GameState, p: Person, now: number): { x: number; y: number } | null {
    const h = hashString(`${p.id}:${Math.floor(now / 20000)}`);
    const well = s.buildings.find((b) => b.kind === 'well' && b.built && !b.removed);
    const stall = s.buildings.find((b) => b.kind === 'stall' && b.built && !b.removed);
    const roll = h % 10;
    if (roll < 2 && well) return doorOf(well);
    if (roll < 3 && stall) return doorOf(stall);
    if (roll < 5 && p.spouse === undefined && p.courting) {
      const other = s.people[p.courting.with];
      const ob = other?.home !== undefined ? s.buildings[other.home] : undefined;
      if (ob) return doorOf(ob);
    }
    return this.near(s, s.hearth, 2.6, h);
  }

  private near(s: GameState, c: { x: number; y: number }, r: number, h: number): { x: number; y: number } | null {
    for (let i = 0; i < 8; i++) {
      const a = ((h >> (i * 3)) % 360) * (Math.PI / 180) + i;
      const d = 1.2 + ((h >> (i + 5)) % 100) / 100 * r;
      const x = Math.round(c.x + Math.cos(a) * d);
      const y = Math.round(c.y + Math.sin(a) * d);
      if (x < 0 || y < 0 || x >= s.map.w || y >= s.map.h) continue;
      const cost = this.grid?.[y * s.map.w + x] ?? 1;
      if (isFinite(cost)) return { x, y };
    }
    return null;
  }

  private adjacent(s: GameState, x: number, y: number): { x: number; y: number } | null {
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const cost = this.grid?.[ny * s.map.w + nx];
      if (cost !== undefined && isFinite(cost)) return { x: nx, y: ny };
    }
    return null;
  }

  private collectTrees(s: GameState, now: number) {
    this.treesAt = now;
    const { map, hearth } = s;
    const out: number[] = [];
    for (let y = Math.max(0, hearth.y - 14); y < Math.min(map.h, hearth.y + 14); y++) {
      for (let x = Math.max(0, hearth.x - 14); x < Math.min(map.w, hearth.x + 14); x++) {
        const t = map.trees[y * map.w + x];
        if (t === TREE.BROADLEAF || t === TREE.PINE) out.push(y * map.w + x);
      }
    }
    out.sort((a, b) => Math.hypot((a % map.w) - hearth.x, Math.floor(a / map.w) - hearth.y) - Math.hypot((b % map.w) - hearth.x, Math.floor(b / map.w) - hearth.y));
    this.treeTiles = out.slice(0, 24);
  }
}

