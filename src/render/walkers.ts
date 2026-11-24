// The little people. Purely cosmetic: they walk between home, work and the
// fire along worn paths, and go indoors when the city sleeps. They carry
// things and set them down: a jar to the well and home full, a basket out to
// the harvest, the bank or the bushes and back heaped, a bundle of firewood
// from the woods; and they work where you can see them (reaping, hoeing,
// drawing water, fishing, gathering).
import { buildCostGrid, findPath } from '../sim/path';
import { currentTarget } from '../sim/forest';
import { workSite } from '../sim/planner';
import { hashString } from '../sim/rng';
import { TERRAIN, TREE, type Building, type GameState, type Person } from '../sim/types';
import { ageOf } from '../sim/world';
import { dirOf, faceTo, facesRight, roleFor, type Dir } from './citizens';
import { rolesOf } from './figures';
import type { Item } from './items';
import { Obstacles } from './obstacles';
import { looksWet } from '../sim/shore';
import { decideFacing, doorstep, frontOf, placement } from './layout';
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
  /** The way they've actually been moving, smoothed (what they face while walking). */
  hx?: number;
  hy?: number;
  /** How far they've walked, in screen px at zoom 1: their steps follow it, so feet don't slide. */
  stride: number;
  /** Where they're going (to find a new way if they get stuck), and for how long they've been stuck. */
  goal?: { x: number; y: number; end?: { x: number; y: number } };
  stuck: number;
  /** Going indoors: the doorstep they step up to before they're gone. */
  doorstep?: { x: number; y: number };
  /** What this walk is for (water from a well), and what they're doing now they're there. */
  errand?: { kind: 'water'; well: number };
  task?: { kind: 'water'; well: number; start: number } | { kind: 'queue'; well: number } | { kind: 'fish'; fx: number; fy: number }
    // Leisure: a word with someone (stopped in the street, or standing about), a place at the fire
    // (crouched once they're there), a children's game.
    | { kind: 'chat'; with: number; until: number }
    | { kind: 'sit'; fx: number; fy: number; seated: boolean; crouch: boolean }
    | { kind: 'play'; game: number };
  /** When they last stopped for a word (so they don't stop for every passer-by). */
  lastChat?: number;
  /** Where a playing child is running to, and until when. */
  playTo?: { x: number; y: number; until: number };
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
/** A children's game: tag (one is it, the rest run) or a ring dance round a middle. */
export interface Game { id: number; kind: 'tag' | 'ring'; cx: number; cy: number; members: number[]; it: number; frozen: number; start: number }
/** Villagers whose bending art is still the rough placeholder: they stand at the fire. */
const ROUGH_STOOP = new Set(['leader', 'leader-man', 'merchant-woman', 'priest-man']);
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
  /** Children's games going on. */
  readonly games = new Map<number, Game>();
  private nextGame = 1;
  /** Things set down at doors (a basket of barley at the granary), until they're taken in. */
  readonly dropped: { item: Item; x: number; y: number; until: number }[] = [];
  /** What people walk around (buildings as drawn, trees, rocks, props). */
  readonly obstacles = new Obstacles();
  /** How often people got stuck and had to find another way, or gave up where they stood (for testing). */
  readonly stats = { replans: 0, gaveUp: 0, detours: 0 };

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

    // Who's where, so people can step around each other.
    // (Everyone who's out, walking or standing: people step round a group chatting too.)
    this.crowd.clear();
    for (const w of this.list.values()) {
      if (w.inside || w.alpha < 0.3) continue;
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
            w!.dir = faceTo(at.cx - w!.x, at.cy - w!.y, w!.dir);
          }
          this.stoop(w!, now, true, { drop: true });
          w!.waitUntil = now + STOOP_MS + 300;
          return;
        }
        const atHome = w!.next === 'work';
        w!.path = null;
        w!.inside = atHome;
        w!.doorstep = atHome ? this.stepFor(s, home) : undefined;
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
        if (w.task?.kind === 'fish') { w.dir = faceTo(w.task.fx - w.x, w.task.fy - w.y, w.dir); w.facing = facesRight(w.dir) ? 1 : -1; }
      }

      // Night falls (or they're unwell): head home, taking whatever they'd set down.
      if (stayIn && !w.inside && w.next !== 'work') {
        w.next = 'work';
        if (w.set) { w.load = w.set.item; w.set = undefined; }
        w.act = undefined; w.work = undefined; w.haul = undefined;
        if (!this.go(s, w, door, now)) arrive();
      }

      w.moving = false;
      // Stopped in the street for a word: they stand, facing each other, then walk on.
      if (w.task?.kind === 'chat' && w.path && w.seg < w.path.length) {
        const o = this.list.get(w.task.with);
        if (now < w.task.until && o && !o.inside && !stayIn) {
          w.vx = 0; w.vy = 0;
          w.dir = faceTo(o.x - w.x, o.y - w.y, w.dir);
          continue;
        }
        w.task = undefined;
        w.stuck = 0;
      }
      // Meeting someone they know on the way (both out for leisure or heading home, empty-handed):
      // now and then they stop for a word.
      if (w.path && w.seg < w.path.length && !stayIn && w.next !== 'social' && !w.load && !w.errand && age >= 12 && now - (w.lastChat ?? -1e9) > 45_000
        && s.buildings[s.map.occ[Math.floor(w.y) * s.map.w + Math.floor(w.x)] - 1]?.kind !== 'field') {
        const o = this.passerBy(s, w, now);
        if (o) {
          const until = now + 4000 + (hashString(`talk${w.id}:${o.id}`) % 6000);
          w.task = { kind: 'chat', with: o.id, until }; o.task = { kind: 'chat', with: w.id, until };
          w.lastChat = o.lastChat = now;
          continue;
        }
      }
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
      // Playing: running about in the game, until it's time to go.
      if (w.task?.kind === 'play') {
        const game = this.games.get(w.task.game);
        if (game && now < w.waitUntil && !stayIn && !w.inside) { this.play(s, w, game, speed, dt, now); continue; }
        this.leaveGame(w);
      }
      // Waiting a turn at the well.
      if (w.task?.kind === 'queue' && now >= w.waitUntil && !stayIn) {
        if (this.claimWell(s, w, w.task.well, now)) continue;
        w.task = undefined;
      }
      if (now < w.waitUntil || stayIn) continue;
      if (w.task?.kind === 'play') this.leaveGame(w);
      w.task = undefined;
      if (w.act?.kind === 'work') w.act = undefined;

      // Done here: pick up what they set down, filled by their work (or, in the woods, a bundle of
      // the sticks they've gathered); then take it where it's wanted.
      if (w.set) {
        if (w.set.item.kind === 'basket') {
          const fill = w.work === 'reap' ? 'basket-grain' : w.work === 'fish' ? 'basket-fish' : w.work === 'gather' ? 'basket-berries' : null;
          if (fill) w.set.item = { kind: fill, full: true };
        }
        w.dir = faceTo(w.set.x - w.x, w.set.y - w.y, w.dir);
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
    for (const id of [...this.list.keys()]) if (!seen.has(id)) { this.leaveGame(this.list.get(id)!); this.list.delete(id); }
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
    this.games.clear();
  }

  // -------------------------------------------------------------------------------------------
  // Free time

  /** Where the hearth's fire is (the middle of the hearth as it's drawn). */
  private fire(s: GameState): { x: number; y: number } {
    const hb = s.buildings.find((b) => b.kind === 'hearth' && !b.removed);
    if (!hb) return { x: s.hearth.x + 0.5, y: s.hearth.y + 0.5 };
    const p = placement(hb);
    return { x: p.cx, y: p.cy };
  }

  /** Someone walking toward them, close by, free for a word (and who'd stop for one, today). */
  private passerBy(s: GameState, w: Walker, now: number): Walker | null {
    const cx = Math.floor(w.x), cy = Math.floor(w.y);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      for (const o of this.crowd.get((cx + ox) * 4096 + cy + oy) ?? []) {
        if (o === w || !o.path || o.seg >= o.path.length || o.task || o.load || o.errand || o.next === 'social') continue;
        if (now - (o.lastChat ?? -1e9) < 45_000) continue;
        const dx = o.x - w.x, dy = o.y - w.y, d = Math.hypot(dx, dy);
        if (d > 0.75 || d < 0.2) continue;
        // Coming the other way, or at least not walking away.
        if (dx * w.vx + dy * w.vy <= 0) continue;
        const op = s.people[o.id];
        if (!op || ageOf(s, op) < 12) continue;
        if (hashString(`meet${Math.min(w.id, o.id)}:${Math.max(w.id, o.id)}:${Math.floor(now / 20_000)}`) % 100 >= 22) continue;
        return o;
      }
    }
    return null;
  }

  /** Free time by the fire: a place in the ring round it, facing it. False if it's not here. */
  private atFire(s: GameState, w: Walker, age: number): boolean {
    const f = this.fire(s);
    if (Math.hypot(w.x - f.x, w.y - f.y) > 3.4) return false;
    let n = 0;
    for (const o of this.list.values()) if (o.task?.kind === 'sit' && !o.inside) n++;
    if (n >= 22) return false;
    const h = hashString(`fire${w.id}:${s.day}`);
    const a = Math.atan2(w.y - f.y, w.x - f.x) + (((h % 100) / 100) - 0.5) * 0.6;
    for (let k = 0; k < 6; k++) {
      const r = 1.05 + ((n + k) % 3) * 0.3;
      const t = a + k * 0.5 * (k % 2 ? 1 : -1);
      const spot = this.obstacles.pushOut(f.x + Math.cos(t) * r, f.y + Math.sin(t) * r, BODY);
      if (!this.open(s, spot.x, spot.y, -1) || this.taken(w, spot)) continue;
      const role = roleFor(s.people[w.id], age, rolesOf(s));
      const crouch = !ROUGH_STOOP.has(role) && (h >>> 8) % 100 < (age >= 60 ? 75 : 45);
      w.task = { kind: 'sit', fx: f.x, fy: f.y, seated: false, crouch };
      w.path = [spot]; w.seg = 0; w.goal = { x: Math.floor(spot.x), y: Math.floor(spot.y) };
      w.inside = false;
      return true;
    }
    return false;
  }

  /** At a gathering place: join someone standing about, for a word. */
  private standAbout(w: Walker, now: number) {
    let best: Walker | null = null, bd = 1.7;
    const cx = Math.floor(w.x), cy = Math.floor(w.y);
    for (let ox = -2; ox <= 2; ox++) for (let oy = -2; oy <= 2; oy++) {
      for (const o of this.crowd.get((cx + ox) * 4096 + cy + oy) ?? []) {
        if (o === w || o.moving || o.inside || o.next !== 'home' || (o.task && o.task.kind !== 'chat')) continue;
        const d = Math.hypot(o.x - w.x, o.y - w.y);
        if (d < bd) { bd = d; best = o; }
      }
    }
    if (!best) return;
    const o = best;
    const ux = (w.x - o.x) / (bd || 1), uy = (w.y - o.y) / (bd || 1);
    const spot = this.obstacles.pushOut(o.x + ux * 0.5, o.y + uy * 0.5, BODY);
    w.task = { kind: 'chat', with: o.id, until: w.waitUntil };
    if (!o.task) { o.task = { kind: 'chat', with: w.id, until: o.waitUntil }; o.dir = faceTo(w.x - o.x, w.y - o.y, o.dir); }
    w.lastChat = o.lastChat = now;
    if (bd > 0.62) { w.path = [spot]; w.seg = 0; w.goal = { x: Math.floor(spot.x), y: Math.floor(spot.y) }; }
    else w.dir = faceTo(o.x - w.x, o.y - w.y, w.dir);
  }

  /** A child arrives to play: joins a game close by, or starts one. */
  private joinGame(s: GameState, w: Walker, now: number) {
    let game: Game | undefined;
    for (const g of this.games.values()) {
      if (g.members.length < (g.kind === 'ring' ? 6 : 5) && Math.hypot(g.cx - w.x, g.cy - w.y) < 3.5) { game = g; break; }
    }
    if (!game) {
      const c = this.obstacles.pushOut(w.x, w.y, BODY);
      // A ring needs a clear patch of ground; tag can be played anywhere.
      let clear = 0;
      for (let k = 0; k < 8; k++) {
        const x = c.x + Math.cos((k * Math.PI) / 4) * 0.9, y = c.y + Math.sin((k * Math.PI) / 4) * 0.9;
        if (this.open(s, x, y, -1) && !this.obstacles.blocked(x, y, BODY)) clear++;
      }
      const kind = clear === 8 && hashString(`game${w.id}:${s.day}`) % 3 === 0 ? 'ring' : 'tag';
      game = { id: this.nextGame++, kind, cx: c.x, cy: c.y, members: [], it: w.id, frozen: 0, start: now };
      this.games.set(game.id, game);
    }
    game.members.push(w.id);
    w.task = { kind: 'play', game: game.id };
    w.waitUntil = now + 24_000 + (hashString(`play${w.id}:${s.day}`) % 30_000);
  }

  private leaveGame(w: Walker) {
    if (w.task?.kind !== 'play') return;
    const game = this.games.get(w.task.game);
    w.task = undefined;
    w.playTo = undefined;
    if (!game) return;
    game.members = game.members.filter((id) => id !== w.id);
    if (!game.members.length) this.games.delete(game.id);
    else if (game.it === w.id) game.it = game.members[0];
  }

  /** A moment of a game: running after, running away, round in a ring, or looking for someone to play with. */
  private play(s: GameState, w: Walker, game: Game, speed: number, dt: number, now: number) {
    const others = game.members.map((id) => this.list.get(id)).filter((o): o is Walker => !!o && o !== w && !o.inside && o.task?.kind === 'play');
    let tx = w.x, ty = w.y, spd = speed;
    const wander = (pace: number) => {
      if (!w.playTo || now > w.playTo.until || Math.hypot(w.playTo.x - w.x, w.playTo.y - w.y) < 0.15) {
        const h = hashString(`run${w.id}:${Math.floor(now / 700)}`);
        const a = ((h % 360) * Math.PI) / 180, r = 0.4 + ((h >>> 9) % 100) / 100 * 1.4;
        const p = this.obstacles.pushOut(game.cx + Math.cos(a) * r, game.cy + Math.sin(a) * r, BODY);
        w.playTo = this.open(s, p.x, p.y, -1) ? { x: p.x, y: p.y, until: now + 2500 } : { x: game.cx, y: game.cy, until: now + 1500 };
      }
      tx = w.playTo.x; ty = w.playTo.y; spd = speed * pace;
    };
    if (game.kind === 'ring' && others.length) {
      // Holding hands round the middle, this way and that.
      const n = game.members.length, i = game.members.indexOf(w.id);
      const t = (now - game.start) / 1000;
      const a = 6 * Math.sin(t * 0.13) + (i * Math.PI * 2) / n;
      const r = 0.3 + 0.1 * n;
      tx = game.cx + Math.cos(a) * r; ty = game.cy + Math.sin(a) * r; spd = speed * 1.3;
    } else if (game.kind === 'tag' && others.length) {
      if (w.id === game.it) {
        let near = others[0], nd = Infinity;
        for (const o of others) { const d = Math.hypot(o.x - w.x, o.y - w.y); if (d < nd) { nd = d; near = o; } }
        if (now < game.frozen) {
          // Counting to three before giving chase.
          w.dir = faceTo(near.x - w.x, near.y - w.y, w.dir);
          w.vx = 0; w.vy = 0; w.moving = false;
          return;
        }
        tx = near.x; ty = near.y; spd = speed * 1.55;
        if (nd < 0.4) { game.it = near.id; game.frozen = now + 1400; }
      } else {
        const it = this.list.get(game.it);
        const d = it ? Math.hypot(it.x - w.x, it.y - w.y) : Infinity;
        if (it && d < 1.4 && now >= game.frozen) {
          // Running away, but not off out of the game.
          tx = w.x + ((w.x - it.x) / (d || 1)) * 1.1; ty = w.y + ((w.y - it.y) / (d || 1)) * 1.1;
          const e = Math.hypot(tx - game.cx, ty - game.cy);
          if (e > 2.3) { tx = game.cx + ((tx - game.cx) / e) * 2.3; ty = game.cy + ((ty - game.cy) / e) * 2.3; }
          spd = speed * 1.45;
        } else wander(0.9);
      }
    } else wander(0.55);
    this.steer(s, w, tx, ty, spd, dt);
  }

  /** Run toward a point, round things in the way (for games: no path, just the next few steps). */
  private steer(s: GameState, w: Walker, tx: number, ty: number, spd: number, dt: number) {
    const dx = tx - w.x, dy = ty - w.y, d = Math.hypot(dx, dy);
    const ease = Math.min(1, d / 0.4 + 0.15);
    let ux = d > 0.03 ? (dx / d) * spd * ease : 0, uy = d > 0.03 ? (dy / d) * spd * ease : 0;
    const around = this.obstacles.avoid(w.x, w.y, ux, uy, BODY);
    ux += around.x; uy += around.y;
    const turn = Math.min(1, dt * 8);
    w.vx += (ux - w.vx) * turn; w.vy += (uy - w.vy) * turn;
    let { x: nx, y: ny } = this.obstacles.pushOut(w.x + w.vx * dt, w.y + w.vy * dt, BODY);
    if (!this.open(s, nx, ny, -1)) { nx = w.x; ny = w.y; w.vx *= 0.3; w.vy *= 0.3; }
    const mx = nx - w.x, my = ny - w.y, moved = Math.hypot(mx, my);
    w.x = nx; w.y = ny;
    w.stride += Math.hypot((mx - my) * 32, (mx + my) * 16);
    w.moving = moved > spd * dt * 0.2;
    w.alpha = Math.min(1, w.alpha + dt * 3);
    if (dt > 0) {
      const k = Math.min(1, dt * 8);
      w.hx = (w.hx ?? 0) + (mx / dt - (w.hx ?? 0)) * k;
      w.hy = (w.hy ?? 0) + (my / dt - (w.hy ?? 0)) * k;
      if (Math.hypot(w.hx, w.hy) > spd * 0.25) w.dir = dirOf(w.hx, w.hy, w.dir);
      if (Math.abs(mx - my) > 1e-4) w.facing = mx - my > 0 ? 1 : -1;
    }
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
    // Exactly where they're going, if it matters (the well's step, the harvest line).
    w.path = this.route(s, w, tiles, to.end);
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
    decideFacing(s, b);
    const front = frontOf(b);
    // Open ground, with nothing standing in the middle of it (a neighbour's woodshed or rack).
    const free = (x: number, y: number) => x >= 0 && y >= 0 && x < s.map.w && y < s.map.h && isFinite(this.grid?.[y * s.map.w + x] ?? 1)
      && !this.obstacles.blocked(x + 0.5, y + 0.5, BODY * 0.5);
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

  /**
   * Where someone steps up to the building to go in (and comes out again): the doorstep in front,
   * or, when the front is built over (a crowded street), the side of the building facing the door
   * they use, never the gap between two buildings.
   */
  private stepFor(s: GameState, b: Building): { x: number; y: number } {
    const door = this.doorFor(s, b);
    const front = frontOf(b);
    if (door.x === front.x && door.y === front.y) return this.obstacles.pushOut(doorstep(b).x, doorstep(b).y, BODY);
    const p = placement(b);
    const m = BODY + 0.08;
    const x0 = p.cx - p.hx * 0.92 - m, x1 = p.cx + p.hx * 0.92 + m, y0 = p.cy - p.hy * 0.92 - m, y1 = p.cy + p.hy * 0.92 + m;
    let x = Math.max(x0, Math.min(x1, door.x + 0.5)), y = Math.max(y0, Math.min(y1, door.y + 0.5));
    // On the edge of the building (plus a body's width) nearest the door.
    if (x > x0 && x < x1 && y > y0 && y < y1) {
      const opts = [[x - x0, x0, y], [x1 - x, x1, y], [y - y0, x, y0], [y1 - y, x, y1]].sort((a, c) => a[0] - c[0]);
      [, x, y] = opts[0];
    }
    return this.obstacles.pushOut(x, y, BODY);
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
    // Got to their place at the fire: face it, and (if they like) crouch down by it, a while.
    if (w.task?.kind === 'sit' && !w.task.seated) {
      w.task.seated = true;
      w.dir = faceTo(w.task.fx - w.x, w.task.fy - w.y, w.dir);
      w.facing = facesRight(w.dir) ? 1 : -1;
      w.waitUntil = now + 18_000 + (hashString(`sit${w.id}:${s.day}`) % 26_000);
      return;
    }
    // Walked up to someone for a word: turn to them.
    if (w.task?.kind === 'chat') {
      const o = this.list.get(w.task.with);
      if (o) w.dir = faceTo(o.x - w.x, o.y - w.y, w.dir);
      return;
    }
    // Arrived somewhere to spend free time (children: their whole day is free time).
    const age = ageOf(s, p);
    if (!w.errand && w.task?.kind !== 'sit' && (w.next === 'home' || (p.job === 'child' && w.next === 'social'))) {
      if (age < 12) { this.joinGame(s, w, now); return; }
      if (this.atFire(s, w, age)) return;
      this.standAbout(w, now);
      return;
    }
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
        const toward = faceTo(fx - w.x, fy - w.y, w.dir);
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
    w.dir = faceTo(p.cx - w.x, p.cy - w.y, w.dir);
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
    w.path = this.route(s, w, tiles, to.end);
    w.seg = 0;
    return true;
  }

  /**
   * Turn a path of tiles into a walk: from where they stand, in straight lines at any angle,
   * taking a shortcut wherever it's clear of buildings and water and costs no more than the way
   * round (so worn paths and roads still draw people onto them), ending a little off the
   * destination's centre (everyone has their own spot).
   */
  private route(s: GameState, w: Walker, tiles: number[], end?: { x: number; y: number }): { x: number; y: number }[] {
    const mw = s.map.w;
    const goal = tiles[tiles.length - 1];
    const pts = tiles.map((ti, k) => {
      const cx = (ti % mw) + 0.5, cy = Math.floor(ti / mw) + 0.5;
      // Each walker keeps a little to one side of the way (where there's room).
      const lane = k === 0 ? null : { x: cx + w.offX * 0.7, y: cy + w.offY * 0.7 };
      const pt = lane && this.open(s, lane.x, lane.y, goal) && !this.obstacles.blocked(lane.x, lane.y, BODY) ? lane : { x: cx, y: cy };
      // A tile's middle may be a tree trunk, a woodshed or part of a building site: stand beside it.
      return this.obstacles.pushOut(pt.x, pt.y, BODY);
    });
    pts[0] = { x: w.x, y: w.y };
    if (end) pts[pts.length - 1] = this.obstacles.pushOut(end.x, end.y, BODY);
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
    // Where a straight stretch would still walk into something (a tree between two tiles, a
    // woodshed, the corner of a building), find a way round it on a finer grid.
    const fixed = [out[0]];
    let detours = 0;
    for (let k = 1; k < out.length; k++) {
      const a = fixed[fixed.length - 1], b = out[k];
      if (detours < 4 && !this.obstacles.clearLine(a.x, a.y, b.x, b.y, BODY * 0.9)) {
        const way = this.detour(s, a, b, goal);
        if (way) { fixed.push(...way); detours++; this.stats.detours++; continue; }
      }
      fixed.push(b);
    }
    return fixed.slice(1);
  }

  /**
   * A way from a to b round whatever stands between them: A* over a grid of quarter tiles round
   * the two (each square open if someone can stand in its middle), then pulled straight wherever a
   * straight line is clear. Null if there's no way within a tile and a half of them.
   */
  private detour(s: GameState, a: { x: number; y: number }, b: { x: number; y: number }, goal: number): { x: number; y: number }[] | null {
    const R = 4;
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - 1.5)), y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - 1.5));
    const x1 = Math.min(s.map.w, Math.ceil(Math.max(a.x, b.x) + 1.5)), y1 = Math.min(s.map.h, Math.ceil(Math.max(a.y, b.y) + 1.5));
    const W = (x1 - x0) * R, H = (y1 - y0) * R;
    if (W * H > 3600 || W <= 0 || H <= 0) return null;
    const cx = (i: number) => x0 + ((i % W) + 0.5) / R, cy = (i: number) => y0 + (Math.floor(i / W) + 0.5) / R;
    const cell = (p: { x: number; y: number }) => Math.max(0, Math.min(H - 1, Math.floor((p.y - y0) * R))) * W + Math.max(0, Math.min(W - 1, Math.floor((p.x - x0) * R)));
    const start = cell(a), end = cell(b);
    const free = new Int8Array(W * H).fill(-1);
    const isFree = (i: number) => {
      if (free[i] < 0) free[i] = i === start || i === end || (this.open(s, cx(i), cy(i), goal) && !this.obstacles.blocked(cx(i), cy(i), BODY)) ? 1 : 0;
      return free[i] === 1;
    };
    const g = new Float32Array(W * H).fill(Infinity);
    const from = new Int32Array(W * H).fill(-1);
    const heap: [number, number][] = [];
    const push = (f: number, i: number) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top;
    };
    const ex = end % W, ey = Math.floor(end / W);
    const h = (i: number) => { const dx = Math.abs((i % W) - ex), dy = Math.abs(Math.floor(i / W) - ey); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    g[start] = 0;
    push(h(start), start);
    let steps = 0;
    while (heap.length && steps++ < 4000) {
      const [, i] = pop();
      if (i === end) break;
      const ix = i % W, iy = Math.floor(i / W);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = ix + dx, ny = iy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!isFree(j)) continue;
        // No cutting a corner between two blocked squares.
        if (dx && dy && (!isFree(iy * W + nx) || !isFree(ny * W + ix))) continue;
        const cost = g[i] + (dx && dy ? 1.414 : 1);
        if (cost < g[j]) { g[j] = cost; from[j] = i; push(cost + h(j), j); }
      }
    }
    if (from[end] < 0 && start !== end) return null;
    const cells: number[] = [];
    for (let i = end; i !== start && i >= 0; i = from[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => ({ x: cx(i), y: cy(i) }));
    pts[pts.length - 1] = b;
    // Pulled straight: from each point, as far along as a straight line is clear.
    const out: { x: number; y: number }[] = [];
    let at = a;
    for (let k = 0; k < pts.length;) {
      let j = k;
      while (j + 1 < pts.length && this.obstacles.clearLine(at.x, at.y, pts[j + 1].x, pts[j + 1].y, BODY * 0.9)) j++;
      out.push(pts[j]);
      at = pts[j];
      k = j + 1;
    }
    return out;
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
    // Nearly there and someone's already standing on the spot: stop here, beside them.
    if (w.seg === path.length - 1 && d < 0.55 && this.taken(w, wp)) { w.seg = path.length; w.vx = 0; w.vy = 0; return true; }
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
      // Held up within a couple of steps of where they're going (a crowd at a door): that'll do.
      const last = path[path.length - 1];
      if (Math.hypot(last.x - w.x, last.y - w.y) < 1.1) { w.seg = path.length; return true; }
      this.stats.replans++;
      if (!w.goal || !this.replan(s, w)) { this.stats.gaveUp++; w.seg = path.length; return true; }
      return false;
    }
    const mx = nx - w.x, my = ny - w.y;
    w.x = nx; w.y = ny;
    // Steps follow the ground covered on screen (a stride is about 17 px at zoom 1).
    w.stride += Math.hypot((mx - my) * 32, (mx + my) * 16);
    if (Math.abs(mx - my) > 1e-4) w.facing = mx - my > 0 ? 1 : -1;
    // They face the way they're really going (smoothed, so a jostle doesn't spin them round),
    // not the way they're trying to go: someone held back by a crowd doesn't walk backwards.
    if (dt > 0) {
      const k = Math.min(1, dt * 8);
      w.hx = (w.hx ?? 0) + (mx / dt - (w.hx ?? 0)) * k;
      w.hy = (w.hy ?? 0) + (my / dt - (w.hy ?? 0)) * k;
      if (Math.hypot(w.hx, w.hy) > speed * 0.25) w.dir = dirOf(w.hx, w.hy, w.dir);
    }
    return false;
  }

  /** Whether someone else is standing (not walking) on or right by a spot. */
  private taken(w: Walker, p: { x: number; y: number }): boolean {
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      for (const o of this.crowd.get((cx + ox) * 4096 + cy + oy) ?? []) {
        if (o !== w && !o.moving && Math.hypot(o.x - p.x, o.y - p.y) < 0.22) return true;
      }
    }
    return false;
  }

  /** Whose work takes them outside whatever the weather. */
  private mustGoOut(p: Person): boolean {
    if (p.job === 'fisher') return !this.frozen;
    return p.job === 'woodcutter' || p.job === 'herder' || p.job === 'gatherer' || p.job === 'builder' || p.job === 'smith' || p.job === 'potter' || p.job === 'healer' || (p.job === 'farmer' && !this.fieldsAsleep);
  }

  private workTarget(s: GameState, p: Person, home: { x: number; y: number }): { x: number; y: number; end?: { x: number; y: number } } | null {
    const h = hashString(`${p.id}:${s.day}`);
    // Children play near home mostly (in the lane, the yard), sometimes by the fire.
    if (p.job === 'child') return (h % 5 < 1 ? this.near(s, s.hearth, 3, h) : null) ?? this.near(s, home, 4, h) ?? this.near(s, home, 2, h);
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
    // Children go on playing near home.
    if (ageOf(s, p) < 12 && roll < 15) {
      const home = p.home !== undefined ? s.buildings[p.home] : undefined;
      if (home) return this.near(s, home, 4, h);
    }
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

