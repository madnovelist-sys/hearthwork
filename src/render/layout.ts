// Where each building actually stands, and how big it is. The sim gives every
// building a plot of whole tiles; on the map it stands inside that plot at its
// true size against the people (a kiln is a little taller than a man, not six
// times), a little off-centre and a little bigger or smaller than its
// neighbours, so streets don't line up like a chessboard. Walkers bump into
// the building as drawn, not its plot.
import { hashString } from '../sim/rng';
import { TERRAIN, type Building, type BuildingKind, type GameState } from '../sim/types';
import { buildingSprite } from './sprites';

/** A grown-up's height on screen at zoom 1, in px (a tile is 64 px across). */
export const PERSON_PX = 23;

/**
 * How tall each kind of building stands, in grown-ups (to the top of the roof, chimney or poles),
 * when its art has no door measured below. Homes and halls in this table are sized so that a
 * door painted at about a third of their height would let a grown-up through.
 */
const HEIGHT: Partial<Record<BuildingKind, number>> = {
  tent: 1.9, leanto: 1.6, hut: 3.9, house: 3.4, bighouse: 4.0, hall: 4.5, townhouse: 3.8,
  granary: 3.8, kiln: 2.2, furnace: 2.3, well: 1.6, stall: 1.6, alehouse: 3.6, healer: 3.2,
  scribes: 3.8, temple: 5.5, guildhall: 4.4, hearth: 1.5, shrine: 1.9, stones: 2.1, spring: 0.8,
  barrow: 1.5, cairn: 1.3, pyre: 1.4, skyplatform: 2.4, tomb: 1.8,
};
/**
 * How tall the doorway is in each painting, as a share of the painting's height (measured from
 * the threshold to the underside of the lintel). Buildings with a door are sized by it.
 */
const DOOR: Record<string, number> = {
  'bld_home_bronze_1x1_v01': 0.3, 'bld_home_bronze_1x1_v02': 0.33, 'bld_home_bronze_1x1_v03': 0.33,
  'bld_round-hut_bronze_1x1_v01': 0.28, 'bld_round-hut_bronze_1x1_v02': 0.29, 'bld_round-hut_bronze_1x1_v03': 0.26,
  'bld_house-large_bronze_2x2_v01': 0.26, 'bld_house-large_bronze_2x2_v02': 0.29,
  'bld_longhouse_bronze_3x3_v01': 0.245,
  // (The granary's door is up on its stilts, reached by a ladder, so it's sized by its height.)
};
/** How tall a door is, in grown-ups: they walk through with a little room over their heads. */
const DOOR_FIT = 1.12;
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

/**
 * Which way each building faces. As painted, every door faces south-west (down and to the left on
 * screen); a mirrored building faces south-east, its door on the east wall. Mirroring about half
 * of them breaks up the rows a town is built in. Things whose drawing depends on the painting's
 * own layout (the well's bucket, the hearth's fire) and things with no front are never mirrored.
 */
const MIRRORS = new Set<BuildingKind>(['tent', 'leanto', 'hut', 'house', 'bighouse', 'hall', 'townhouse', 'granary', 'kiln', 'furnace', 'stall', 'alehouse', 'healer', 'scribes', 'temple', 'guildhall', 'shrine']);
const facing = new Map<number, boolean>();

/**
 * Decide (once) which way a building faces: toward open ground. If only one of its south and
 * east sides has room in front, it faces that way; if both do, it's chance.
 */
export function decideFacing(s: GameState, b: Building): boolean {
  let east = facing.get(b.id);
  if (east !== undefined) return east;
  // (Decided when it's finished: scaffolding has no front.)
  if (!b.built) return false;
  east = false;
  if (MIRRORS.has(b.kind)) {
    const { map } = s;
    const open = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
      const i = y * map.w + x;
      return !map.occ[i] && map.terrain[i] !== TERRAIN.WATER && map.terrain[i] !== TERRAIN.DEEP;
    };
    let south = false, eastOpen = false;
    for (let x = b.x; x < b.x + b.w; x++) south ||= open(x, b.y + b.h);
    for (let y = b.y; y < b.y + b.h; y++) eastOpen ||= open(b.x + b.w, y);
    east = eastOpen && (!south || (hashString(`face${b.id}`) & 1) === 1);
  }
  facing.set(b.id, east);
  return east;
}
/** Whether a building is drawn mirrored, facing east (once decided; see decideFacing). */
export const facesEast = (b: Building) => facing.get(b.id) ?? false;

/** Scale, centre and size on the ground of a building as it's drawn. */
export function placement(b: Building): Placement {
  const east = facesEast(b);
  const key = `${b.id}:${b.kind}:${b.x}:${b.y}:${b.era ?? ''}:${b.variant}:${east ? 'e' : ''}`;
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
    const door = sp.key ? DOOR[sp.key] : undefined;
    // Neighbours differ a little (in three steps, for the image cache); less where the door
    // sets the size, so every door still fits.
    const vary = door ? 1 + ((h % 3) - 1) * 0.04 : 0.9 + ((h % 3) / 2) * 0.2;
    const tall = door ? (DOOR_FIT / door) * (1 + 0.04) : want;
    scale = Math.min(1.15, (tall * PERSON_PX * vary) / Math.max(1, drawn));
  }
  // Off-centre within whatever room the plot leaves (more for small buildings on big plots).
  const h = hashString(`spot${b.id}`);
  // (At least a little, even on a snug plot: eaves may reach a hand's breadth over its edge.)
  const roomX = Math.max(0.14, (1 - scale) * b.w / 2), roomY = Math.max(0.12, (1 - scale) * b.h / 2);
  const across = (((h >>> 3) % 1000) / 1000 - 0.5) * 1.2, forward = (((h >>> 13) % 1000) / 1000) * 0.7;
  // Keep toward the front of the plot (where the door is), so people don't walk far to reach it.
  const ox = east ? forward * roomX : across * roomX;
  const oy = east ? across * roomY : forward * roomY;
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

/** Forget cached placements (new art arrived). Which way buildings face is kept. */
export const resetPlacements = () => cache.clear();

/** Where someone stands to go in: in front of the building as drawn, at the middle of its front. */
export function doorstep(b: Building): { x: number; y: number } {
  const p = placement(b);
  return facesEast(b) ? { x: p.cx + p.hx + 0.12, y: p.cy } : { x: p.cx, y: p.cy + p.hy + 0.12 };
}

/** The tile in front of a building's door (south of it, or east of it if it faces east). */
export function frontOf(b: Building): { x: number; y: number } {
  return facesEast(b) ? { x: b.x + b.w, y: b.y + Math.floor(b.h / 2) } : { x: b.x + Math.floor(b.w / 2), y: b.y + b.h };
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
  const east = facesEast(b);
  for (let i = 0; i < count; i++) {
    const s = i ? -side : side;
    const n = (h >>> 4) + i * 37;
    out.push(east ? { x: p.cx + p.hx * 0.92 + 0.13, y: p.cy + s * p.hy * 0.66, n } : { x: p.cx + s * p.hx * 0.66, y: p.cy + p.hy * 0.92 + 0.13, n });
  }
  return out;
}

/** Where a tree stands within its patch of ground (trees aren't on a grid either). */
export function treeSpot(x: number, y: number): { x: number; y: number; h: number } {
  const h = hashString(`${x},${y}`);
  const ox = (((h >>> 4) % 100) / 100 - 0.5) * 0.5, oy = (((h >>> 11) % 100) / 100 - 0.5) * 0.5;
  return { x: x + 0.5 + ox, y: y + 0.5 + oy, h };
}
