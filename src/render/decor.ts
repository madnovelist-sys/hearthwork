// Scenery that isn't part of the simulation: wildflowers in the meadows, reeds
// along the water, fallen logs and dead wood on the forest floor, logs stacked
// where trees were felled, and by people's doors what their work needs (a
// woodshed, a drying rack). It's worked out from the map once a day,
// so older villages get it too, and it disappears wherever people build or wear
// a path.
import { TERRAIN, TREE, type GameState } from '../sim/types';
import { isDwelling } from '../sim/world';

export const DECOR = { NONE: 0, FLOWERS: 1, REEDS: 2, LOG: 3, DEADWOOD: 4, LOGPILE: 5, WOODSHED: 6, RACK: 7 } as const;
export const DECOR_KEY = [
  '', 'nat_wildflowers_any_1x1', 'nat_reeds_any_1x1', 'nat_fallen-log_any_1x1', 'nat_deadwood_any_1x1', 'nat_log-pile_any_1x1',
  'prop_woodpile-shelter_bronze_1x1', 'prop_drying-rack_bronze_1x1',
];

export interface DecorItem { x: number; y: number; kind: number; dx: number; dy: number; flip: boolean; variant: number }

const hash = (x: number, y: number, k: number) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(k, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class Decor {
  private day = -1;
  private mapW = 0;
  /** What stands on each tile, or nothing. */
  private grid = new Uint8Array(0);
  items: DecorItem[] = [];

  /** Work it out again when the day turns (or the map grows). */
  update(s: GameState) {
    if (s.day === this.day && s.map.w === this.mapW && this.grid.length) return;
    this.day = s.day;
    this.mapW = s.map.w;
    const { map } = s;
    const { w, h } = map;
    const grid = new Uint8Array(w * h);
    const free = (i: number) => !map.occ[i] && map.trees[i] === TREE.NONE && map.wear[i] < 0.35 && !map.walls?.[i];
    const terr = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : map.terrain[y * w + x]);
    const grown = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const t = map.trees[y * w + x];
      return (t === TREE.BROADLEAF || t === TREE.PINE) && (map.growth?.[y * w + x] ?? 1) >= 1;
    };
    const stumpy = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && map.trees[y * w + x] === TREE.STUMP;
    const seed = s.seed | 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!free(i)) continue;
        const t = map.terrain[i];
        const r = hash(x, y, seed);
        if (t === TERRAIN.MARSH) { if (r < 0.45) grid[i] = DECOR.REEDS; continue; }
        if (t !== TERRAIN.GRASS && t !== TERRAIN.SAND) continue;
        // Reeds where the land meets shallow water.
        const shore = [terr(x - 1, y), terr(x + 1, y), terr(x, y - 1), terr(x, y + 1)];
        if (shore.includes(TERRAIN.WATER) || shore.includes(TERRAIN.MARSH)) { if (r < 0.3) grid[i] = DECOR.REEDS; continue; }
        if (t !== TERRAIN.GRASS) continue;
        // The forest floor: fallen trunks and broken dead wood under the trees; logs stacked where trees were felled.
        let trees = 0, stumps = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (grown(x + dx, y + dy)) trees++;
          if (stumpy(x + dx, y + dy)) stumps++;
        }
        if (trees >= 3) { if (r < 0.06) grid[i] = DECOR.LOG; else if (r < 0.1) grid[i] = DECOR.DEADWOOD; continue; }
        if (stumps >= 3 && r < 0.08) { grid[i] = DECOR.LOGPILE; continue; }
        // Wildflowers grow in patches, thickest in the richest meadows and away from the trees.
        const patch = hash(x >> 2, y >> 2, seed + 3) < 0.3 ? 0.3 : 0.03;
        if (trees === 0 && r < patch * (0.6 + map.fertility[i] * 0.8)) grid[i] = DECOR.FLOWERS;
      }
    }

    // By people's doors, what their work needs: a woodshed for a woodcutter, a rack for drying
    // fish (a fisher's) or herbs and greens (some gatherers'), on free tiles beside the house.
    const wants = new Map<number, Set<number>>();
    const want = (home: number, kind: number) => { let k = wants.get(home); if (!k) wants.set(home, (k = new Set())); k.add(kind); };
    for (const p of s.people) {
      if (!p.alive || p.home === undefined || p.away !== undefined || p.left) continue;
      if (p.job === 'woodcutter') want(p.home, DECOR.WOODSHED);
      else if (p.job === 'fisher' || (p.job === 'gatherer' && p.id % 2 === 0)) want(p.home, DECOR.RACK);
    }
    for (const b of s.buildings) {
      const kinds = wants.get(b.id);
      if (!kinds || b.removed || !b.built || b.burned || !isDwelling(b.kind)) continue;
      const spots = [[b.x + b.w, b.y + b.h - 1], [b.x + b.w - 1, b.y + b.h], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x - 1, b.y], [b.x, b.y - 1]];
      for (const kind of kinds) {
        for (const [x, y] of spots) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = y * w + x;
          if (map.terrain[i] !== TERRAIN.GRASS || map.occ[i] || map.trees[i] !== TREE.NONE || map.walls?.[i] || map.wear[i] > 1.2) continue;
          if (grid[i] === DECOR.WOODSHED || grid[i] === DECOR.RACK) continue; // a neighbour's already
          grid[i] = kind;
          break;
        }
      }
    }

    this.grid = grid;
    const items: DecorItem[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const kind = grid[y * w + x];
        if (!kind) continue;
        const a = hash(x, y, seed + 7), b = hash(x, y, seed + 13);
        // Off-centre a little, so they don't line up on the grid (less for the things by the doors).
        const byDoor = kind === DECOR.WOODSHED || kind === DECOR.RACK;
        const j = byDoor || kind === DECOR.LOGPILE ? 0.08 : 0.22;
        items.push({ x, y, kind, dx: (a - 0.5) * 2 * j, dy: (b - 0.5) * 2 * j, flip: a > 0.5, variant: Math.floor(b * 3) });
      }
    }
    this.items = items;
  }
}
