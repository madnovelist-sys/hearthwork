// The little people. Purely cosmetic: they walk between home, work and the
// fire along worn paths, and go indoors when the city sleeps.
import { buildCostGrid, findPath } from '../sim/path';
import { currentTarget } from '../sim/forest';
import { doorOf, workSite } from '../sim/planner';
import { hashString } from '../sim/rng';
import { TREE, type GameState, type Person } from '../sim/types';
import { ageOf } from '../sim/world';

export interface Walker {
  id: number;
  x: number;
  y: number;
  path: number[] | null;
  seg: number;
  waitUntil: number;
  next: 'work' | 'social' | 'home';
  alpha: number;
  inside: boolean;
  offX: number;
  offY: number;
  speed: number;
  facing: number;
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
          speed: 1.3 + ((h >> 16) % 50) / 100, facing: 1, moving: false,
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
        const ti = w.path[w.seg];
        const tx = (ti % s.map.w) + 0.5 + w.offX;
        const ty = Math.floor(ti / s.map.w) + 0.5 + w.offY;
        const dx = tx - w.x;
        const dy = ty - w.y;
        const d = Math.hypot(dx, dy);
        const step = speed * dt;
        if (d <= step) { w.x = tx; w.y = ty; w.seg++; } else { w.x += (dx / d) * step; w.y += (dy / d) * step; }
        if (Math.abs(dx - dy) > 0.01) w.facing = dx - dy > 0 ? 1 : -1;
        w.moving = true;
        w.inside = false;
        w.alpha = Math.min(1, w.alpha + dt * 3);
        if (w.seg >= w.path.length) arrive();
        continue;
      }
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
    const path = findPath(s.map, s.buildings, fx, fy, to.x, to.y, 2500, this.grid ?? undefined);
    if (!path || path.length < 2) return false;
    w.path = path;
    w.seg = 1;
    w.waitUntil = now;
    w.inside = false;
    return true;
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

