// (Pure map arithmetic, no drawing: the planner uses it too, so nothing is built in painted water.)
// The curved edges of the ground: where water, sand, rock and marsh meet other
// ground, each edge tile spreads in a broad round patch, set back toward the
// middle of its stretch, so shores sweep instead of stepping. Shared by the
// painter (which draws the patches) and the walkers (who keep off any land the
// water has been painted over).
import { TERRAIN, type MapData } from './types';

const KIND_OF: Record<number, string> = {
  [TERRAIN.GRASS]: 'grass', [TERRAIN.SAND]: 'sand', [TERRAIN.ROCK]: 'rock', [TERRAIN.WATER]: 'shallow',
  [TERRAIN.DEEP]: 'deep', [TERRAIN.MARSH]: 'marsh', [TERRAIN.PLAZA]: 'plaza', [TERRAIN.BRIDGE]: 'shallow',
};
export const kindAt = (map: MapData, x: number, y: number) =>
  x < 0 || y < 0 || x >= map.w || y >= map.h ? undefined : KIND_OF[map.terrain[y * map.w + x]];
export const kindOf = (t: number) => KIND_OF[t] ?? 'grass';

/** How far from its centre each kind of ground reaches at its edge (half a tile is its own square). */
const BLOB: Record<string, number> = { shallow: 0.62, deep: 0.6, sand: 0.58, rock: 0.56, marsh: 0.58, plaza: 0.6 };
/** Deep water lies within the shallows: for the shallows' edge, both are the same water. */
const sameBody = (own: string, other: string) => other === own || (own === 'shallow' && other === 'deep');
const R = 1.35;

/** The round patch an edge tile at (x, y) spreads (centre and radius in map coordinates), if any. */
export function blobAt(map: MapData, x: number, y: number): { own: string; gx: number; gy: number; r: number } | null {
  const own = kindAt(map, x, y);
  if (!own) return null;
  const reach = BLOB[own];
  if (!reach) return null;
  let ix = 0, iy = 0, edge = false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const k = kindAt(map, x + dx, y + dy);
    if (k === undefined) continue;
    if (sameBody(own, k)) { ix += dx; iy += dy; } else edge = true;
  }
  if (!edge) return null;
  const len = Math.hypot(ix, iy);
  const r = len ? R : reach;
  const wander = Math.sin(x * 0.71 + y * 0.29) * 0.06 + Math.sin(x * 0.23 - y * 0.61 + 2) * 0.06;
  const back = len ? r - (reach + wander) : 0;
  return { own, gx: x + 0.5 + (len ? (ix / len) * back : 0), gy: y + 0.5 + (len ? (iy / len) * back : 0), r };
}

/**
 * Land the painted water has spread over (its middle lies inside a patch of water): it looks like
 * water, so nobody walks there.
 */
const wetCache = new WeakMap<number[], { w: number; sum: number; out: Uint8Array }>();
export function looksWet(map: MapData): Uint8Array {
  // (Remembered until the water itself changes: a bridge, a bigger map.)
  let sum = 0;
  for (let i = 0; i < map.terrain.length; i += 7) sum = (sum * 31 + map.terrain[i]) | 0;
  const hit = wetCache.get(map.terrain);
  if (hit && hit.w === map.w && hit.sum === sum) return hit.out;
  const out = new Uint8Array(map.w * map.h);
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const t = map.terrain[y * map.w + x];
    if (t !== TERRAIN.WATER && t !== TERRAIN.DEEP) continue;
    const b = blobAt(map, x, y);
    if (!b) continue;
    for (let yy = Math.floor(b.gy - b.r); yy <= Math.ceil(b.gy + b.r); yy++) for (let xx = Math.floor(b.gx - b.r); xx <= Math.ceil(b.gx + b.r); xx++) {
      if (xx < 0 || yy < 0 || xx >= map.w || yy >= map.h) continue;
      const i = yy * map.w + xx;
      const tt = map.terrain[i];
      if (tt === TERRAIN.WATER || tt === TERRAIN.DEEP || tt === TERRAIN.BRIDGE) continue;
      // Wet if the water reaches within a little of where someone would stand on it.
      if (Math.hypot(xx + 0.5 - b.gx, yy + 0.5 - b.gy) < b.r + 0.12) out[i] = 1;
    }
  }
  wetCache.set(map.terrain, { w: map.w, sum, out });
  return out;
}
