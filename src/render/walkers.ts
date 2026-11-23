// The little people. Purely cosmetic: they walk between home, work and the
// fire along worn paths, and go indoors when the city sleeps. They carry
// things and set them down: a jar to the well and home full, a basket out to
// the harvest, the bank or the bushes and back heaped, a bundle of firewood
// from the woods; and they work where you can see them (reaping, hoeing,
// drawing water, fishing, gathering).
import { buildCostGrid, findPath } from '../sim/path';
import { currentTarget } from '../sim/forest';
import { doorOf, workSite } from '../sim/planner';
import { hashString } from '../sim/rng';
import { TERRAIN, TREE, type Building, type GameState, type Person } from '../sim/types';
import { ageOf } from '../sim/world';
import { dirOf, facesRight, type Dir } from './citizens';
import type { Item } from './items';
import { Obstacles } from './obstacles';
import { looksWet } from '../sim/shore';
import { doorstep, placement } from './layout';
import { DRAW_MS } from './work';
import { harvestOf } from './harvest';
import { seasonIndex, seasonProgress } from '../sim/world';

/** How long it takes to bend down to the ground and straighten up again. */
export const STOOP_MS = 900;
/** The moment in a stoop when their hands reach the ground (and something changes hands). */
const AT_GROUND = 0.45;
export type WorkSheet = 'reap' | 'hoe';
/** The eight ways of facing, clockwise round the screen. */
const AROUND: Dir[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
/** One step on the ground in the way someone faces (world tiles). */
const AHEAD: Record<Dir, [number, number]> = {
  se: [1, 0], ne: [0, -1], sw: [0, 1], nw: [-1, 0],
  e: [Math.SQRT1_2, -Math.SQRT1_2], s: [Math.SQRT1_2, Math.SQRT1_2], w: [-Math.SQRT1_2, Math.SQRT1_2], n: [-Math.SQRT1_2, -Math.SQRT1_2],
};
const turn = (d: Dir, steps: number): Dir => AROUND[(AROUND.indexOf(d) + steps + 8) % 8];

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
  /** Where they're going (to find a new way if they get stuck), and for how long they've been stuck. */
  goal?: { x: number; y: number };
  stuck: number;
  /** Going indoors: the doorstep they step up to before they're gone. */
  doorstep?: { x: number; y: number };
  /** What this walk is for (water from a well), and what they're doing now they're there. */
  errand?: { kind: 'water'; well: number };
  task?: { kind: 'water'; well: number; start: number } | { kind: 'queue'; well: number } | { kind: 'fish'; fx: number; fy: number };
  /** What they're holding, and what they've set down by them (theirs, to pick up again). */
  load?: Item;
  set?: { item: Item; x: number; y: number };
  /**
   * Bending to the ground (to put something down at `at`, leaving it there if `drop`, or to pick
   * up what's there, or something new, `gives`), or a work loop with their tools.
   */
  act?: { kind: 'stoop'; start: number; put: boolean; at?: { x: number; y: number }; drop?: boolean; gives?: Item; only?: boolean } | { kind: 'work'; sheet: WorkSheet; start: number };
  /** The work they're out at (what fills their basket), and when they next bend to it. */
  work?: 'reap' | 'hoe' | 'fish' | 'gather' | 'wood';
  nextBend?: number;
  /** Taking the day's work somewhere (a building's id): the granary, or home. */
  haul?: number;
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
/** Where people meet, besides the fire. */
const GATHER = new Set(['well', 'stall', 'alehouse', 'temple', 'shrine', 'guildhall', 'hall']);
/** How much room someone takes up, in tiles (half a shoulder-width, more or less). */
const BODY = 0.1;

export class Walkers {
  list = new Map<number, Walker>();
  private grid: Float32Array | null = null;
  private gridAt = 0;
  private gridKey = '';
  private treeTiles: number[] = [];
  private treesAt = 0;

  private crowd = new Map<number, Walker[]>();
  /** Who is drawing water at each well, since when, and which side they stand (+1 right, -1 left on screen). */
  readonly wells = new Map<number, { walker: number; start: number; toward: number }>();
  /** Things set down at doors (a basket of barley at the granary), until they're taken in. */
  readonly dropped: { item: Item; x: number; y: number; until: number }[] = [];
  /** What people walk around (buildings as drawn, trees, rocks, props). */
  readonly obstacles = new Obstacles();

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
      // Nobody walks where the water's edge has been painted over the land.
      const wet = looksWet(s.map);
      for (let i = 0; i < wet.length; i++) if (wet[i] && s.map.terrain[i] !== TERRAIN.BRIDGE) this.grid[i] = Infinity;
      this.gridAt = now;
      this.gridKey = key;
    }
    if (now - this.treesAt > 10_000) this.collectTrees(s, now);
    for (let i = this.dropped.length - 1; i >= 0; i--) if (now > this.dropped[i].until) this.dropped.splice(i, 1);

    // Who's walking where, so people can step around each other.
    this.crowd.clear();
    for (const w of this.list.values()) {
      if (!w.path || w.alpha < 0.3) continue;
      const k = Math.floor(w.x) * 4096 + Math.floor(w.y);
      const cell = this.crowd.get(k);
      if (cell) cell.push(w); else this.crowd.set(k, [w]);
    }

    // How many are at or on their way to each well (nobody sets out to join a long wait).
    const atWell = new Map<number, number>();
    for (const w of this.list.values()) {
      const id = w.errand?.kind === 'water' ? w.errand.well : w.task?.kind === 'queue' || w.task?.kind === 'water' ? w.task.well : -1;
      if (id >= 0) atWell.set(id, (atWell.get(id) ?? 0) + 1);
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
      const door = this.doorFor(s, home);
      if (!w) {
        const h = hashString(`w${p.id}`);
        w = {
          id: p.id, x: door.x + 0.5, y: door.y + 0.5, path: null, seg: 0,
          waitUntil: now + (h % 4000), next: 'work', alpha: 0, inside: true,
          offX: ((h % 100) / 100 - 0.5) * 0.5, offY: (((h >> 8) % 100) / 100 - 0.5) * 0.5,
          speed: 0.75 + ((h >> 16) % 30) / 100, facing: 1, dir: 's', moving: false, vx: 0, vy: 0, stride: (h >> 3) % 17, stuck: 0,
        };
        this.list.set(p.id, w);
      }
      const age = ageOf(s, p);
      const speed = w.speed * (age < 10 ? 1.15 : age >= 60 ? 0.65 : 1);
      const stayIn = !!(p.sick || p.injured) || night > 0.55;
      // A leg ends; arriving home means going indoors.
      const arrive = () => {
        // Bringing the day's work: set it down at the door, then carry on.
        if (w!.haul !== undefined) {
          const to = s.buildings[w!.haul];
          w!.haul = undefined;
          w!.path = null;
          w!.inside = false;
          if (to) {
            const at = placement(to);
            w!.dir = dirOf(at.cx - w!.x, at.cy - w!.y, w!.dir);
          }
          this.stoop(w!, now, true, { drop: true });
          w!.waitUntil = now + STOOP_MS + 300;
          return;
        }
        const atHome = w!.next === 'work';
        w!.path = null;
        w!.inside = atHome;
        w!.doorstep = atHome ? doorstep(home) : undefined;
        w!.waitUntil = now + this.stay(p, w!, atHome);
        if (!atHome) this.beginTask(s, p, w!, now);
      };

      // Bending down or straightening up: they stay where they are till it's done.
      if (w.act?.kind === 'stoop') {
        const a = w.act;
        const t = (now - a.start) / STOOP_MS;
        if (t >= AT_GROUND && !a.only) {
          if (a.put && w.load) {
            const at = a.at ?? this.ahead(w, a.drop ? 0.22 : 0.3);
            if (a.drop) this.dropped.push({ item: w.load, x: at.x, y: at.y, until: now + 25_000 + (hashString(`d${p.id}:${s.day}`) % 10_000) });
            else w.set = { item: w.load, x: at.x, y: at.y };
            w.load = undefined;
          } else if (!a.put && w.set) {
            w.load = w.set.item;
            w.set = undefined;
          } else if (!a.put && a.gives && !w.load) {
            w.load = a.gives;
          }
        }
        if (t < 1) { w.moving = false; w.vx = 0; w.vy = 0; continue; }
        w.act = undefined;
        // Back to the line, if they're fishing.
        if (w.task?.kind === 'fish') { w.dir = dirOf(w.task.fx - w.x, w.task.fy - w.y, w.dir); w.facing = facesRight(w.dir) ? 1 : -1; }
      }

      // Night falls (or they're unwell): head home, taking whatever they'd set down.
      if (stayIn && !w.inside && w.next !== 'work') {
        w.next = 'work';
        if (w.set) { w.load = w.set.item; w.set = undefined; }
        w.act = undefined; w.work = undefined; w.haul = undefined;
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
      // Going in: up to the door of the house as it stands, then gone.
      const step = w.inside && w.doorstep && w.alpha > 0.05 ? w.doorstep : undefined;
      if (step) {
        const ex = step.x - w.x, ey = step.y - w.y, e = Math.hypot(ex, ey);
        if (e < 0.08) w.doorstep = undefined;
        else {
          const k = Math.min(e, speed * 0.8 * dt) / e;
          w.x += ex * k; w.y += ey * k;
          w.stride += Math.hypot((ex - ey) * k * 32, (ex + ey) * k * 16);
          w.dir = dirOf(ex, ey, w.dir);
          w.moving = true;
        }
      }
      if (w.inside && !step) w.alpha = Math.max(0, w.alpha - dt * 2.5);
      else if (!w.inside) w.alpha = Math.min(1, w.alpha + dt * 3);
      // Indoors, whatever they brought home is put away.
      if (w.inside && w.alpha < 0.05) { w.load = undefined; w.set = undefined; w.act = undefined; w.work = undefined; w.haul = undefined; }
      // At the well, the jar fills as the bucket is tipped into it.
      if (w.task?.kind === 'water' && w.set && now - w.task.start > 5300) w.set.item.full = true;
      // At work: reaping or hoeing in a steady loop, or bending now and then to gather.
      if (!w.inside && !w.path && now < w.waitUntil && !stayIn) {
        if ((w.work === 'reap' || w.work === 'hoe') && w.act?.kind !== 'work') {
          w.act = { kind: 'work', sheet: w.work, start: now };
          w.dir = w.work === 'reap' ? 'se' : (hashString(`hoe${p.id}:${s.day}`) % 2 ? 'se' : 'sw');
          w.facing = facesRight(w.dir) ? 1 : -1;
        }
        if ((w.work === 'gather' || w.work === 'wood') && now >= (w.nextBend ?? 0) && w.waitUntil - now > STOOP_MS + 400) {
          w.nextBend = now + STOOP_MS + 1400 + (hashString(`bend${p.id}:${Math.floor(now / 1000)}`) % 2200);
          this.stoop(w, now, false, { only: true });
          continue;
        }
      }
      // Waiting a turn at the well.
      if (w.task?.kind === 'queue' && now >= w.waitUntil && !stayIn) {
        if (this.claimWell(s, w, w.task.well, now)) continue;
        w.task = undefined;
      }
      if (now < w.waitUntil || stayIn) continue;
      w.task = undefined;
      if (w.act?.kind === 'work') w.act = undefined;

      // Done here: pick up what they set down, filled by their work (or, in the woods, a bundle of
      // the sticks they've gathered); then take it where it's wanted.
      if (w.set) {
        if (w.set.item.kind === 'basket') {
          const fill = w.work === 'reap' ? 'basket-grain' : w.work === 'fish' ? 'basket-fish' : w.work === 'gather' ? 'basket-berries' : null;
          if (fill) w.set.item = { kind: fill, full: true };
        }
        w.dir = dirOf(w.set.x - w.x, w.set.y - w.y, w.dir);
        this.stoop(w, now, false);
        w.waitUntil = now + STOOP_MS + 150;
        continue;
      }
      if (w.work === 'wood' && !w.load) {
        this.stoop(w, now, false, { gives: { kind: 'wood-bundle', full: true } });
        w.waitUntil = now + STOOP_MS + 150;
        w.work = undefined;
        continue;
      }
      w.work = undefined;
      if (w.load?.full && w.load.kind !== 'water-jar' && w.load.kind !== 'basket') {
        const to = this.haulTo(s, w.load, home);
        w.haul = to.id;
        if (!this.go(s, w, this.doorFor(s, to), now)) arrive();
        continue;
      }
      // (An empty basket that found no use is put away when they next set out elsewhere.)

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
      let target: { x: number; y: number; end?: { x: number; y: number } } | null = going === 'work' ? this.workTarget(s, p, home) : going === 'social' ? this.socialTarget(s, p, now) : door;
      // Instead of idling, a grown-up sometimes fetches water from the nearest well, with a jar.
      w.errand = undefined;
      w.work = undefined;
      if (going === 'social' && ageOf(s, p) >= 12 && hashString(`water${p.id}:${Math.floor(now / 30000)}`) % 100 < 25) {
        const well = this.nearestWell(s, home);
        if (well && (atWell.get(well.id) ?? 0) < 3) {
          atWell.set(well.id, (atWell.get(well.id) ?? 0) + 1);
          w.errand = { kind: 'water', well: well.id };
          target = { x: well.x, y: well.y, end: doorstep(well) };
          if (!w.load) w.load = { kind: 'water-jar', full: false };
        }
      }
      // Out to work: some take a basket for what they'll bring back.
      if (going === 'work' && target) {
        w.work = this.workOf(s, p, home);
        if ((w.work === 'reap' || w.work === 'fish' || w.work === 'gather') && !w.load) w.load = { kind: 'basket', full: false };
      }
      if (going !== 'work' && w.load?.kind === 'basket' && !w.load.full) w.load = undefined;
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
      const door = this.doorFor(s, home);
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
      w.load = undefined; w.set = undefined; w.act = undefined; w.work = undefined; w.haul = undefined; w.task = undefined; w.errand = undefined;
      if (at) {
        ({ x: w.x, y: w.y } = this.obstacles.pushOut(at.x + 0.5 + w.offX, at.y + 0.5 + w.offY, BODY));
        w.inside = false; w.alpha = 1;
        w.waitUntil = now + (h % 6000);
      } else {
        w.x = door.x + 0.5; w.y = door.y + 0.5;
        w.inside = true; w.alpha = 0; w.next = 'work';
        w.waitUntil = now + 1000 + ((h >> 4) % 8000);
      }
    }
    this.dropped.length = 0;
  }

  /**
   * Bend to the ground: to put down what they're holding (beside them, to pick up again, or
   * left where it is if `drop`), or to pick up what they set down, or something new (`gives`),
   * or `only` to bend to their work (picking berries, gathering sticks).
   */
  private stoop(w: Walker, now: number, put: boolean, o: { at?: { x: number; y: number }; drop?: boolean; gives?: Item; only?: boolean } = {}) {
    w.act = { kind: 'stoop', start: now, put, ...o };
    w.facing = facesRight(w.dir) ? 1 : -1;
    w.vx = 0; w.vy = 0;
  }

  /** The ground a little way in front of someone (where their hands reach when they bend). */
  private ahead(w: Walker, d: number): { x: number; y: number } {
    const [ax, ay] = AHEAD[w.dir];
    return { x: w.x + ax * d, y: w.y + ay * d };
  }

  /** Put down what they're carrying a quarter turn from the way they'll work, so it's out of the way. */
  private setAside(w: Walker, now: number, workDir: Dir) {
    w.dir = turn(workDir, 2);
    this.stoop(w, now, true);
  }

  /** Where the day's work is taken: barley to the granary, everything else home. */
  private haulTo(s: GameState, item: Item, home: Building): Building {
    if (item.kind === 'basket-grain') {
      let best: Building | undefined, bd = 30;
      for (const b of s.buildings) {
        if (b.kind !== 'granary' || !b.built || b.removed) continue;
        const d = Math.hypot(b.x - home.x, b.y - home.y);
        if (d < bd) { bd = d; best = b; }
      }
      if (best) return best;
    }
    return home;
  }

  /** What someone's work today will look like, as they set out. */
  private workOf(s: GameState, p: Person, _home: Building): Walker['work'] {
    if (p.job === 'fisher' && !this.frozen) return 'fish';
    if (p.job === 'gatherer' && !this.fieldsAsleep) return 'gather';
    if (p.job === 'woodcutter') return 'wood';
    if (p.job === 'farmer' && !this.fieldsAsleep) {
      const field = s.buildings.find((b) => b.kind === 'field' && !b.removed && b.worker === p.id);
      if (!field) return undefined;
      const cut = harvestOf(s, field);
      if (cut > 0 && cut < 1) return 'reap';
      const season = seasonIndex(s.day);
      if (season === 0 || (season === 1 && seasonProgress(s.day) < 0.55)) return 'hoe';
    }
    if (p.job === 'farmer' && this.fieldsAsleep) return 'wood';
    return undefined;
  }

  private stay(p: Person, w: Walker, atHome: boolean): number {
    const h = hashString(`${p.id}:${Math.floor(w.x * 7 + w.y * 13)}`) % 1000;
    if (atHome) return 1500 + h * 3;
    if (w.next === 'social') return 5000 + h * 7; // just arrived at work
    return 2500 + h * 4;
  }

  /** Start walking somewhere. Returns false if there's no way (or no need) to get there. */
  private go(s: GameState, w: Walker, to: { x: number; y: number; end?: { x: number; y: number } }, now: number): boolean {
    const fx = Math.floor(w.x);
    const fy = Math.floor(w.y);
    if (fx === to.x && fy === to.y && !to.end) return false;
    const tiles = findPath(s.map, s.buildings, fx, fy, to.x, to.y, 2500, this.grid ?? undefined);
    if (!tiles || tiles.length < 2) return false;
    w.task = undefined;
    w.path = this.route(s, w, tiles);
    // Exactly where they're going, if it matters (the well's step, the harvest line).
    if (to.end) w.path[w.path.length - 1] = to.end;
    w.seg = 0;
    w.waitUntil = now;
    w.inside = false;
    w.goal = to;
    w.stuck = 0;
    return true;
  }

  /**
   * The open ground where someone comes out of (or goes into) a building: in front of it if that's
   * free, else the nearest free spot around it (in a crowded street, the front may be next door).
   */
  private doors = new Map<number, { x: number; y: number; key: string }>();
  private doorFor(s: GameState, b: Building): { x: number; y: number } {
    const key = this.gridKey;
    const hit = this.doors.get(b.id);
    if (hit && hit.key === key) return hit;
    const front = doorOf(b);
    const free = (x: number, y: number) => x >= 0 && y >= 0 && x < s.map.w && y < s.map.h && isFinite(this.grid?.[y * s.map.w + x] ?? 1);
    let best = free(front.x, front.y) ? front : null;
    if (!best) {
      let bd = Infinity;
      for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
        if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) continue;
        if (!free(x, y)) continue;
        const d = Math.hypot(x - front.x, y - front.y) + (y < b.y ? 0.5 : 0); // the back is a last resort
        if (d < bd) { bd = d; best = { x, y }; }
      }
    }
    const out = { ...(best ?? front), key };
    this.doors.set(b.id, out);
    return out;
  }

  /** A bit of bank (open ground beside the water) within a few steps of somewhere, picked by h. */
  private shoreSpot(s: GameState, c: { x: number; y: number }, h: number): { x: number; y: number } | null {
    const { map } = s;
    const out: { x: number; y: number }[] = [];
    for (let y = c.y - 5; y <= c.y + 5; y++) for (let x = c.x - 5; x <= c.x + 5; x++) {
      if (x < 1 || y < 1 || x >= map.w - 1 || y >= map.h - 1) continue;
      if (!isFinite(this.grid?.[y * map.w + x] ?? Infinity)) continue;
      const wet = (i: number) => map.terrain[i] === TERRAIN.WATER || map.terrain[i] === TERRAIN.DEEP;
      if (wet(y * map.w + x)) continue;
      if (wet(y * map.w + x + 1) || wet(y * map.w + x - 1) || wet((y + 1) * map.w + x) || wet((y - 1) * map.w + x)) out.push({ x, y });
    }
    return out.length ? out[(h >>> 7) % out.length] : null;
  }

  private nearestWell(s: GameState, home: Building): Building | undefined {
    let best: Building | undefined, bd = 18;
    for (const b of s.buildings) {
      if (b.kind !== 'well' || !b.built || b.removed) continue;
      const d = Math.hypot(b.x - home.x, b.y - home.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  /**
   * Arrived: at the well, set the jar down and draw water (or wait a turn); at the water, set the
   * basket down and cast a line; at the harvest or the bushes, set the basket down and get to work.
   */
  private beginTask(s: GameState, p: Person, w: Walker, now: number) {
    if (w.next === 'social' && (w.work === 'reap' || w.work === 'gather') && w.load?.kind === 'basket') {
      this.setAside(w, now, w.work === 'reap' ? 'se' : w.dir);
      w.waitUntil += STOOP_MS;
    }
    if (w.errand?.kind === 'water') {
      const well = w.errand.well;
      w.errand = undefined;
      if (this.claimWell(s, w, well, now)) return;
      // Someone's there: stand aside and wait a turn.
      const use = this.wells.get(well)!;
      const side = this.obstacles.pushOut(w.x + 0.4, w.y + 0.25, BODY);
      if (this.open(s, side.x, side.y, -1)) { w.x = side.x; w.y = side.y; }
      w.task = { kind: 'queue', well };
      w.waitUntil = use.start + DRAW_MS + 300;
      return;
    }
    if (p.job === 'fisher' && !this.frozen && w.next === 'social') {
      // The nearest water within a couple of steps.
      let best: { x: number; y: number } | null = null, bd = 2.6;
      const tx = Math.floor(w.x), ty = Math.floor(w.y);
      for (let y = ty - 3; y <= ty + 3; y++) for (let x = tx - 3; x <= tx + 3; x++) {
        if (x < 0 || y < 0 || x >= s.map.w || y >= s.map.h) continue;
        const tr = s.map.terrain[y * s.map.w + x];
        if (tr !== TERRAIN.WATER && tr !== TERRAIN.DEEP) continue;
        const d = Math.hypot(x + 0.5 - w.x, y + 0.5 - w.y);
        if (d < bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; }
      }
      if (best) {
        const n = hashString(`cast${p.id}:${s.day}`);
        const fx = best.x + ((n % 100) / 100 - 0.5) * 0.6, fy = best.y + (((n >> 8) % 100) / 100 - 0.5) * 0.6;
        w.task = { kind: 'fish', fx, fy };
        const toward = dirOf(fx - w.x, fy - w.y, w.dir);
        w.waitUntil = Math.max(w.waitUntil, now + 12000);
        // The basket by their side first (away from the water), then the line.
        if (w.load?.kind === 'basket') {
          w.dir = turn(toward, 2);
          const [ax, ay] = AHEAD[w.dir];
          if (this.open(s, w.x + ax * 0.2, w.y + ay * 0.2, -1)) this.stoop(w, now, true);
          else { w.dir = turn(toward, -2); this.stoop(w, now, true); }
        }
        w.dir = w.act?.kind === 'stoop' ? w.dir : toward;
        w.facing = fx - fy - (w.x - w.y) >= 0 ? 1 : -1;
      }
    }
  }

  /** Take a turn at the well, if it's free: face it and draw water. */
  private claimWell(s: GameState, w: Walker, wellId: number, now: number): boolean {
    const use = this.wells.get(wellId);
    if (use && use.walker !== w.id && now - use.start < DRAW_MS && this.list.get(use.walker)?.task?.kind === 'water') return false;
    const b = s.buildings[wellId];
    if (!b || b.removed) return false;
    const spot = doorstep(b);
    const p = placement(b);
    // They stand at the step if it's free, facing the well.
    if (Math.hypot(spot.x - w.x, spot.y - w.y) < 0.8) { w.x = spot.x; w.y = spot.y; }
    const sx = (w.x - w.y) - (p.cx - p.cy);
    w.dir = dirOf(p.cx - w.x, p.cy - w.y, w.dir);
    // The jar goes down at the well's foot first, for the bucket to be tipped into.
    let start = now;
    if (w.load?.kind === 'water-jar') {
      const d = Math.hypot(p.cx - w.x, p.cy - w.y) || 1;
      this.stoop(w, now, true, { at: { x: w.x + ((p.cx - w.x) / d) * 0.2, y: w.y + ((p.cy - w.y) / d) * 0.2 } });
      start = now + STOOP_MS;
    }
    this.wells.set(wellId, { walker: w.id, start, toward: sx >= 0 ? 1 : -1 });
    w.task = { kind: 'water', well: wellId, start };
    w.waitUntil = start + DRAW_MS + 200;
    return true;
  }

  /** Stuck: find a way on to the same place from where they stand now. */
  private replan(s: GameState, w: Walker): boolean {
    const to = w.goal!;
    const tiles = findPath(s.map, s.buildings, Math.floor(w.x), Math.floor(w.y), to.x, to.y, 2500, this.grid ?? undefined);
    if (!tiles || tiles.length < 2) return false;
    // Nudge them off whatever they're wedged against first.
    const n = hashString(`${w.id}:${Math.floor(w.x * 13 + w.y * 7)}`);
    w.offX = ((n % 100) / 100 - 0.5) * 0.5; w.offY = (((n >> 8) % 100) / 100 - 0.5) * 0.5;
    w.path = this.route(s, w, tiles);
    w.seg = 0;
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
      const pt = lane && this.open(s, lane.x, lane.y, goal) && !this.obstacles.blocked(lane.x, lane.y, BODY) ? lane : { x: cx, y: cy };
      // A tile's middle may be a tree trunk: stand beside it instead.
      return k === tiles.length - 1 ? pt : this.obstacles.pushOut(pt.x, pt.y, BODY);
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
    // And nothing in the way: a building's wall, a tree, a woodshed.
    return this.obstacles.clearLine(a.x, a.y, b.x, b.y, BODY);
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
    // Round a tree, a rock or a woodshed just ahead.
    const around = this.obstacles.avoid(w.x, w.y, ux, uy, BODY);
    ux += around.x; uy += around.y;
    const turn = Math.min(1, dt * 7);
    w.vx += (ux - w.vx) * turn;
    w.vy += (uy - w.vy) * turn;
    let nx = w.x + w.vx * dt, ny = w.y + w.vy * dt;
    // Never into anything: out of any shape they'd overlap, then along (not over) a blocked plot
    // or the water's edge; if there's no way on, they wait a moment and find another way.
    ({ x: nx, y: ny } = this.obstacles.pushOut(nx, ny, BODY));
    // (Someone already standing somewhere they shouldn't, a plot or a doorway in a crowded street,
    // may walk out of it.)
    if (!this.open(s, nx, ny, goal) && this.open(s, w.x, w.y, goal)) {
      if (this.open(s, nx, w.y, goal) && !this.obstacles.blocked(nx, w.y, BODY)) ny = w.y;
      else if (this.open(s, w.x, ny, goal) && !this.obstacles.blocked(w.x, ny, BODY)) nx = w.x;
      else { nx = w.x; ny = w.y; }
    }
    const moved = Math.hypot(nx - w.x, ny - w.y);
    w.stuck = moved < speed * dt * 0.15 ? w.stuck + dt : Math.max(0, w.stuck - dt);
    if (w.stuck > 1.2) {
      w.stuck = 0;
      w.vx = 0; w.vy = 0;
      if (!w.goal || !this.replan(s, w)) { w.seg = path.length; return true; }
      return false;
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

  private workTarget(s: GameState, p: Person, home: { x: number; y: number }): { x: number; y: number; end?: { x: number; y: number } } | null {
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
    // Fishers each take their own spot along the bank near the dock (or near home).
    if (p.job === 'fisher' && !this.frozen) {
      const spot = this.shoreSpot(s, workSite(s, p) ?? home, h);
      if (spot) return spot;
    }
    const site = workSite(s, p);
    if (site && p.job === 'farmer') {
      // At harvest, they work along the line where the barley is being cut.
      const field = s.buildings.find((b) => b.kind === 'field' && !b.removed && b.worker === p.id);
      const cut = field ? harvestOf(s, field) : 0;
      if (field && cut > 0 && cut < 1) {
        const end = { x: field.x + cut * field.w, y: field.y + 0.3 + ((h >>> 4) % 100) / 100 * (field.h - 0.6) };
        return { x: Math.min(field.x + field.w - 1, Math.floor(end.x)), y: Math.floor(end.y), end };
      }
      return { x: site.x - (h % 2), y: site.y - ((h >> 1) % 2) };
    }
    return site ?? this.near(s, s.hearth, 3, h);
  }

  /**
   * Somewhere to be with others: the fire, a well, the market, the alehouse, the temple, a
   * sweetheart's door. The nearest of each kind to home is likeliest, and the bigger the town,
   * the wider people spread around them, so a town doesn't all crowd round the one fire.
   */
  private socialTarget(s: GameState, p: Person, now: number): { x: number; y: number } | null {
    const h = hashString(`${p.id}:${Math.floor(now / 20000)}`);
    const roll = h % 20;
    if (roll < 4 && p.spouse === undefined && p.courting) {
      const other = s.people[p.courting.with];
      const ob = other?.home !== undefined ? s.buildings[other.home] : undefined;
      if (ob) return this.doorFor(s, ob);
    }
    const home = p.home !== undefined ? s.buildings[p.home] : undefined;
    const places = this.gatherings(s);
    if (places.length && roll >= 4 + Math.max(2, 12 - places.length * 2) && home) {
      // One of the three nearest gathering places to home.
      const near3 = places.slice().sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y)).slice(0, 3);
      const b = near3[(h >>> 5) % near3.length];
      return this.near(s, this.doorFor(s, b), 1.6, h) ?? this.doorFor(s, b);
    }
    const spread = 2.6 + Math.sqrt(this.list.size) * 0.22;
    return this.near(s, s.hearth, spread, h);
  }

  private gatherAt = -1;
  private gatherList: { x: number; y: number; w: number; h: number }[] = [];
  private gatherings(s: GameState) {
    if (this.gatherAt !== s.day) {
      this.gatherAt = s.day;
      this.gatherList = s.buildings.filter((b) => b.built && !b.removed && GATHER.has(b.kind));
    }
    return this.gatherList as unknown as Building[];
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

