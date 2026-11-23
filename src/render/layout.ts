// Where each building actually stands, and how big it is. The sim gives every
// building a plot of whole tiles; on the map it stands inside that plot at its
// true size against the people (a kiln is a little taller than a man, not six
// times), a little off-centre and a little bigger or smaller than its
// neighbours, so streets don't line up like a chessboard. Walkers bump into
// the building as drawn, not its plot.
import { hashString } from '../sim/rng';
import type { Building, BuildingKind } from '../sim/types';
import { buildingSprite } from './sprites';

/** A grown-up's height on screen at zoom 1, in px (a tile is 64 px across). */
export const PERSON_PX = 26;

/** How tall each kind of building stands, in grown-ups (to the top of the roof, chimney or poles). */
const HEIGHT: Partial<Record<BuildingKind, number>> = {
  tent: 1.9, leanto: 1.6, hut: 2.6, house: 2.3, bighouse: 3.0, hall: 3.8, townhouse: 3.1,
  granary: 2.9, kiln: 2.2, furnace: 2.3, well: 1.6, stall: 1.6, alehouse: 2.9, healer: 2.3,
  scribes: 3.1, temple: 5, guildhall: 3.5, hearth: 1.5, shrine: 1.9, stones: 2.1, spring: 0.8,
  barrow: 1.5, cairn: 1.3, pyre: 1.4, skyplatform: 2.4, tomb: 1.8,
};
/** Things that fill their ground (enclosures, fields, the great tree, decks): drawn as made. */
const AS_MADE = new Set<BuildingKind>(['field', 'pen', 'graveyard', 'bridge', 'dock', 'landing', 'grove', 'bigtree', 'stone']);

export interface Placement {
  /** Scale to draw the art at (1 = as made for the plot). */
  scale: number;
  /** Centre of the building on the map (grid coordinates). */
  cx: number;
  cy: number;
  /** Half its width and depth on the ground, in tiles. */
  hx: number;
  hy: number;
}

const cache = new Map<string, Placement>();

/** Scale, centre and size on the ground of a building as it's drawn. */
export function placement(b: Building): Placement {
  const key = `${b.id}:${b.kind}:${b.x}:${b.y}:${b.era ?? ''}:${b.variant}`;
  let p = cache.get(key);
  if (p) return p;
  let scale = 1;
  const want = HEIGHT[b.kind];
  if (want && !AS_MADE.has(b.kind)) {
    // The art's height at the scale it was made for this plot (the summer version, so it doesn't
    // change size with the seasons).
    const sp = buildingSprite(b.kind, b.variant, false, b.era);
    const fit = sp.tiles && sp.tiles !== b.w ? b.w / sp.tiles : 1;
    const drawn = sp.h * (64 / sp.tilePx) * fit;
    const h = hashString(`size${b.id}`);
    const vary = 0.9 + ((h % 3) / 2) * 0.2; // neighbours differ a little (in three steps, for the image cache)
    scale = Math.min(1.1, (want * PERSON_PX * vary) / Math.max(1, drawn));
  }
  // Off-centre within whatever room the plot leaves (more for small buildings on big plots).
  const h = hashString(`spot${b.id}`);
  // (At least a little, even on a snug plot: eaves may reach a hand's breadth over its edge.)
  const roomX = Math.max(0.14, (1 - scale) * b.w / 2), roomY = Math.max(0.12, (1 - scale) * b.h / 2);
  const ox = (((h >>> 3) % 1000) / 1000 - 0.5) * roomX * 1.2;
  // Keep toward the front of the plot (where the door is), so people don't walk far to reach it.
  const oy = (((h >>> 13) % 1000) / 1000) * roomY * 0.7;
  p = {
    scale,
    cx: b.x + b.w / 2 + ox,
    cy: b.y + b.h / 2 + oy,
    hx: (b.w / 2) * Math.min(1, scale),
    hy: (b.h / 2) * Math.min(1, scale),
  };
  if (cache.size > 5000) cache.clear();
  cache.set(key, p);
  return p;
}

/** Forget cached placements (new art arrived). */
export const resetPlacements = () => cache.clear();

/** Where someone stands to go in: in front of the building as drawn, at the middle of its front. */
export function doorstep(b: Building): { x: number; y: number } {
  const p = placement(b);
  return { x: p.cx, y: p.cy + p.hy + 0.12 };
}

/** Homes that may keep a storage jar outside, and how many the granary keeps. */
const JAR_HOMES = new Set<BuildingKind>(['hut', 'house', 'bighouse', 'townhouse', 'leanto']);

/**
 * Where a building's big storage jars stand, against its front wall to one side of the door
 * (two at the granary; one outside some homes). Each has its own number, for whether it's full.
 */
export function jarsOf(b: Building): { x: number; y: number; n: number }[] {
  if (!b.built || b.removed) return [];
  const h = hashString(`jar${b.id}`);
  const count = b.kind === 'granary' ? 2 : JAR_HOMES.has(b.kind) && h % 100 < 40 ? 1 : 0;
  if (!count) return [];
  const p = placement(b);
  const side = h & 1 ? 1 : -1;
  const out: { x: number; y: number; n: number }[] = [];
  for (let i = 0; i < count; i++) {
    const s = i ? -side : side;
    out.push({ x: p.cx + s * p.hx * 0.66, y: p.cy + p.hy * 0.92 + 0.13, n: (h >>> 4) + i * 37 });
  }
  return out;
}

/** Where a tree stands within its patch of ground (trees aren't on a grid either). */
export function treeSpot(x: number, y: number): { x: number; y: number; h: number } {
  const h = hashString(`${x},${y}`);
  const ox = (((h >>> 4) % 100) / 100 - 0.5) * 0.5, oy = (((h >>> 11) % 100) / 100 - 0.5) * 0.5;
  return { x: x + 0.5 + ox, y: y + 0.5 + oy, h };
}
