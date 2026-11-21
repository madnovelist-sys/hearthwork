// Terrain generation: a meadow valley with a river, woods, rocky rises and
// marsh. Each seed has one whole world (WORLD tiles across); a settlement's map
// is a window onto the middle of it, which widens as the settlement grows, so
// the land beyond the old edge is always the same land.
import { log } from './chronicle';
import { makeRng, rand, int, range, type RngState } from './rng';
import { TERRAIN, TREE, type GameState, type MapData, type Stage } from './types';
import { ensureForest } from './forest';

export const WORLD = 256;
export const MAP_SIZE = 64;
/** How wide the map is at each stage. */
export const STAGE_MAP_SIZE: Record<Stage, number> = { settlement: 64, village: 64, town: 128, city: 192, metropolis: 256 };

function valueNoise(r: RngState, w: number, h: number, cell: number): (x: number, y: number) => number {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid: number[] = [];
  for (let i = 0; i < gw * gh; i++) grid.push(rand(r));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = smooth(gx - x0);
    const ty = smooth(gy - y0);
    const g = (ix: number, iy: number) => grid[iy * gw + ix];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * tx;
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}

function fractal(r: RngState, w: number, h: number): (x: number, y: number) => number {
  const n1 = valueNoise(r, w, h, 16);
  const n2 = valueNoise(r, w, h, 8);
  const n3 = valueNoise(r, w, h, 4);
  return (x, y) => n1(x, y) * 0.55 + n2(x, y) * 0.3 + n3(x, y) * 0.15;
}

/** A steady 0..1 roll for a world tile, so the same tile always gets the same tree. */
function tileRoll(seed: number, x: number, y: number, salt = 0): number {
  let h = (seed ^ 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (x + 0x9e37), 0x85ebca6b);
  h = Math.imul(h ^ (y + 0x7f4a + salt * 0x1337), 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

interface World {
  elevation: (x: number, y: number) => number;
  moisture: (x: number, y: number) => number;
  vertical: boolean;
  river: number[];
  riverWidth: number;
  pond: { x: number; y: number; rad: number } | null;
}

const worlds = new Map<number, World>();

function worldFor(seed: number): World {
  let w = worlds.get(seed);
  if (w) return w;
  const r = makeRng(seed ^ 0x77a1d);
  const elevation = fractal(r, WORLD, WORLD);
  const moisture = fractal(r, WORLD, WORLD);
  const vertical = rand(r) < 0.5;
  // The river crosses the first window near its middle, then wanders off in both directions.
  const o = (WORLD - MAP_SIZE) / 2;
  const river = new Array<number>(WORLD).fill(0);
  const mid = WORLD / 2;
  river[mid] = range(r, o + MAP_SIZE * 0.3, o + MAP_SIZE * 0.7);
  for (const dir of [1, -1]) {
    let pos = river[mid];
    let drift = 0;
    for (let t = mid + dir; t >= 0 && t < WORLD; t += dir) {
      drift = drift * 0.85 + range(r, -0.6, 0.6);
      const inFirst = t >= o && t < o + MAP_SIZE;
      const lo = inFirst ? o + 6 : 6;
      const hi = inFirst ? o + MAP_SIZE - 7 : WORLD - 7;
      pos = Math.max(lo, Math.min(hi, pos + drift));
      river[t] = pos;
    }
  }
  const riverWidth = range(r, 1.3, 2.2);
  const pond = rand(r) < 0.6 ? { x: o + int(r, 8, MAP_SIZE - 9), y: o + int(r, 8, MAP_SIZE - 9), rad: range(r, 2, 3.5) } : null;
  w = { elevation, moisture, vertical, river, riverWidth, pond };
  worlds.set(seed, w);
  return w;
}

/** Distance (in steps) from each tile to the nearest water, up to `cap`. */
function waterDistance(map: { w: number; h: number; terrain: number[] }, cap: number): Uint8Array {
  const { w, h, terrain } = map;
  const d = new Uint8Array(w * h).fill(cap);
  let frontier: number[] = [];
  for (let i = 0; i < w * h; i++) if (isWater(terrain[i])) { d[i] = 0; frontier.push(i); }
  for (let step = 1; step < cap && frontier.length; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && d[i - 1] > step) { d[i - 1] = step; next.push(i - 1); }
      if (x < w - 1 && d[i + 1] > step) { d[i + 1] = step; next.push(i + 1); }
      if (y > 0 && d[i - w] > step) { d[i - w] = step; next.push(i - w); }
      if (y < h - 1 && d[i + w] > step) { d[i + w] = step; next.push(i + w); }
    }
    frontier = next;
  }
  return d;
}

/**
 * Sand banks, soil and trees for the tiles where `mask` is set, once the water is known.
 * Wet, low land near water is the most fertile.
 */
function finishLand(seed: number, map: MapData, origin: number, mask: (i: number) => boolean) {
  const world = worldFor(seed);
  const dist = waterDistance(map, 14);
  const { w, h, terrain, trees, fertility } = map;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask(i)) continue;
      const wx = x + origin;
      const wy = y + origin;
      const e = world.elevation(wx, wy);
      const m = world.moisture(wx, wy);
      const d = dist[i];
      if (terrain[i] === TERRAIN.GRASS && d <= 1 && m > 0.45) terrain[i] = TERRAIN.SAND;
      fertility[i] = Math.max(0, Math.min(1, 0.35 + Math.max(0, 1 - d / 14) * 0.4 + (m - 0.5) * 0.5 - Math.max(0, e - 0.6)));
      trees[i] = TREE.NONE;
      // Trees: woods where it's moist, pines up high, bushes scattered.
      const roll = tileRoll(seed, wx, wy);
      if (terrain[i] === TERRAIN.GRASS) {
        if (e > 0.6 && roll < 0.55) trees[i] = TREE.PINE;
        else if (m > 0.56 && roll < 0.75) trees[i] = roll < 0.06 ? TREE.FRUIT : TREE.BROADLEAF;
        else if (roll < 0.035) trees[i] = TREE.BUSH;
        else if (roll < 0.045) trees[i] = TREE.BROADLEAF;
      } else if (terrain[i] === TERRAIN.ROCK && roll < 0.18) {
        trees[i] = TREE.BOULDER;
      }
    }
  }
}

/** The window of `size` tiles at the middle of a seed's world. */
function cutWindow(seed: number, size: number, withRiver: boolean): MapData {
  const world = worldFor(seed);
  const origin = (WORLD - size) >> 1;
  const n = size * size;
  const map: MapData = {
    w: size, h: size,
    terrain: new Array<number>(n).fill(TERRAIN.GRASS),
    trees: new Array<number>(n).fill(TREE.NONE),
    wear: new Array<number>(n).fill(0),
    occ: new Array<number>(n).fill(0),
    fertility: new Array<number>(n).fill(0),
    growth: [], wood: [],
    gen: 2,
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const wx = x + origin;
      const wy = y + origin;
      const e = world.elevation(wx, wy);
      const m = world.moisture(wx, wy);
      let t: number = TERRAIN.GRASS;
      if (m > 0.68 && e < 0.42) t = TERRAIN.MARSH;
      else if (e > 0.7) t = TERRAIN.ROCK;
      if (withRiver) {
        const dr = Math.abs((world.vertical ? wx : wy) - world.river[world.vertical ? wy : wx]);
        const p = world.pond;
        const dp = p ? Math.hypot(wx - p.x, wy - p.y) : 99;
        if (dr < world.riverWidth * 0.55) t = TERRAIN.DEEP;
        else if (dr < world.riverWidth) t = TERRAIN.WATER;
        else if (p && dp < p.rad) t = dp < p.rad - 1.2 ? TERRAIN.DEEP : TERRAIN.WATER;
      }
      map.terrain[i] = t;
    }
  }
  finishLand(seed, map, origin, () => true);
  return map;
}

export interface GeneratedMap {
  map: MapData;
  hearth: { x: number; y: number };
}

export function generateMap(seed: number, size = MAP_SIZE): GeneratedMap {
  const r = makeRng(seed ^ 0x5eed);
  const map = cutWindow(seed, size, true);
  const { w, h, terrain, trees } = map;
  const dist = waterDistance(map, 20);

  // The hearth: open grass close (but not too close) to the river, near the middle.
  let best = { x: Math.floor(w / 2), y: Math.floor(h / 2), score: -Infinity };
  for (let y = 10; y < h - 10; y++) {
    for (let x = 10; x < w - 10; x++) {
      const i = y * w + x;
      if (terrain[i] !== TERRAIN.GRASS) continue;
      const dr = dist[i];
      if (dr < 4) continue;
      let open = 0;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const j = (y + dy) * w + (x + dx);
          if (terrain[j] === TERRAIN.GRASS) open += trees[j] ? 0.4 : 1;
        }
      }
      const center = -Math.hypot(x - w / 2, y - h / 2) * 0.8;
      const score = open + center - Math.abs(dr - 7) * 2 + rand(r) * 3;
      if (score > best.score) best = { x, y, score };
    }
  }
  // Clear a little meadow around the fire.
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const i = (best.y + dy) * w + (best.x + dx);
      if (Math.hypot(dx, dy) <= 3.2 && terrain[i] === TERRAIN.GRASS) trees[i] = TREE.NONE;
    }
  }
  ensureForest(map);
  return { map, hearth: { x: best.x, y: best.y } };
}

/**
 * Older maps weren't cut from a world, so their river is carried on past the old edge:
 * every run of water touching an edge flows on outward, wandering a little.
 */
function carveRivers(seed: number, map: MapData, old: MapData, d: number) {
  const r = makeRng(seed ^ 0xc0a5e);
  const { w } = map;
  const set = (x: number, y: number, t: number) => {
    if (x < 0 || y < 0 || x >= w || y >= map.h) return;
    if (x >= d && y >= d && x < d + old.w && y < d + old.h) return; // never touch the old land
    map.terrain[y * w + x] = t;
  };
  const edges = [
    { len: old.w, at: (k: number) => [k, 0], out: [0, -1] },
    { len: old.w, at: (k: number) => [k, old.h - 1], out: [0, 1] },
    { len: old.h, at: (k: number) => [0, k], out: [-1, 0] },
    { len: old.h, at: (k: number) => [old.w - 1, k], out: [1, 0] },
  ];
  for (const e of edges) {
    let start = -1;
    for (let k = 0; k <= e.len; k++) {
      const [x, y] = k < e.len ? e.at(k) : [-1, -1];
      const wet = k < e.len && isWater(old.terrain[y * old.w + x]);
      if (wet && start < 0) start = k;
      if (!wet && start >= 0) {
        const run = k - start;
        if (run >= 2) {
          // Carry this run of water on to the new edge.
          let c = (start + k - 1) / 2;
          const half = run / 2;
          let drift = 0;
          for (let step = 1; step <= d + 1; step++) {
            drift = drift * 0.85 + range(r, -0.6, 0.6);
            c += drift;
            for (let off = -Math.ceil(half) - 1; off <= Math.ceil(half) + 1; off++) {
              const dist = Math.abs(off - (c - Math.round(c)));
              const t = dist < half * 0.55 ? TERRAIN.DEEP : dist < half + 0.2 ? TERRAIN.WATER : -1;
              if (t < 0) continue;
              const along = Math.round(c) + off;
              const [ex, ey] = e.out[0] !== 0
                ? [(e.out[0] < 0 ? -step : old.w - 1 + step) + d, along + d]
                : [along + d, (e.out[1] < 0 ? -step : old.h - 1 + step) + d];
              set(ex, ey, t);
            }
          }
        }
        start = -1;
      }
    }
  }
}

/**
 * Widen the map to `size` tiles, keeping everything already there in the middle.
 * Returns how far everything moved (in tiles), 0 if the map was already that big.
 */
export function expandMap(s: GameState, size: number): number {
  const old = s.map;
  if (size <= old.w) return 0;
  const d = (size - old.w) >> 1;
  const continueOwnRiver = old.gen !== 2;
  const map = cutWindow(s.seed, size, !continueOwnRiver);
  const inOld = (x: number, y: number) => x >= d && y >= d && x < d + old.w && y < d + old.h;
  if (continueOwnRiver) {
    carveRivers(s.seed, map, old, d);
    finishLand(s.seed, map, (WORLD - size) >> 1, (i) => !inOld(i % size, Math.floor(i / size)));
  }
  map.growth = new Array<number>(size * size).fill(0);
  map.wood = new Array<number>(size * size).fill(0);
  ensureForest(map);
  for (let y = 0; y < old.h; y++) {
    for (let x = 0; x < old.w; x++) {
      const i = y * old.w + x;
      const j = (y + d) * size + (x + d);
      map.terrain[j] = old.terrain[i];
      map.trees[j] = old.trees[i];
      map.wear[j] = old.wear[i];
      map.occ[j] = old.occ[i];
      map.fertility[j] = old.fertility[i];
      map.growth[j] = old.growth[i];
      map.wood[j] = old.wood[i];
    }
  }
  if (old.walls) {
    map.walls = new Array<number>(size * size).fill(0);
    for (let y = 0; y < old.h; y++) for (let x = 0; x < old.w; x++) map.walls[(y + d) * size + x + d] = old.walls[y * old.w + x];
    map.wallsUp = old.wallsUp;
  }
  if (s.walls) { s.walls.cx += d; s.walls.cy += d; }
  if (continueOwnRiver) delete map.gen; // keep carrying its own river at the next widening
  s.map = map;
  s.hearth = { x: s.hearth.x + d, y: s.hearth.y + d };
  for (const b of s.buildings) { b.x += d; b.y += d; }
  for (const g of s.graves) { g.x += d; g.y += d; }
  return d;
}

/** Widen the map if the settlement has outgrown it. */
export function growMap(s: GameState, quiet = false): number {
  const want = STAGE_MAP_SIZE[s.stage];
  if (s.map.w >= want) return 0;
  const d = expandMap(s, want);
  if (d && !quiet) {
    log(s, 'season', `Hunters and herders walked farther than anyone had before, and came back with news of the land beyond: more woods, more meadow, and the river running on.`, [], 4);
  }
  return d;
}

export function isWater(t: number): boolean {
  return t === TERRAIN.WATER || t === TERRAIN.DEEP;
}

export function isBuildable(t: number): boolean {
  return t === TERRAIN.GRASS || t === TERRAIN.SAND;
}
