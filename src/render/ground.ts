// Ground textures: the seamless squares in art/terrain, laid over the map as
// repeating patterns. They're pinned to the world (so they move with the
// ground when you pan), squashed to the view's 2:1 slant, and kept in smaller
// copies for zoomed-out views so the ground doesn't shimmer. Surfaces without a
// texture of their own (winter grass, marsh, ice, the hearth square) are
// recoloured from the nearest one.
import { C, mix } from './palette';

export type Surface =
  | 'grass_spring' | 'grass_summer' | 'grass_autumn' | 'grass_winter' | 'grass_snow'
  | 'dirt' | 'soil_plowed' | 'sand' | 'rock' | 'marsh' | 'plaza'
  | 'water_shallow' | 'water_deep' | 'ice_shallow' | 'ice_deep';

/** How many tiles across one repeat of a texture spans on screen. */
const TILES_PER_REPEAT = 2.5;
const LEVELS = 5;

/** Each surface, as a pyramid of ever-smaller copies (already squashed to 2:1). */
const pyramids = new Map<Surface, HTMLCanvasElement[]>();
const patterns = new Map<string, CanvasPattern>();

/** Surfaces made by recolouring another: [from, to colour]. */
const DERIVED: [Surface, Surface, string][] = [
  ['grass_winter', 'grass_summer', C.winterGrass],
  ['marsh', 'grass_summer', C.marsh],
  ['plaza', 'rock', mix(C.stone, C.sand, 0.45)],
  ['ice_shallow', 'water_shallow', '#D6E4EC'],
  ['ice_deep', 'water_deep', '#BFD3DE'],
];

let supported: boolean | null = null;
/** Patterns need setTransform (every current browser has it); otherwise the ground stays flat colour. */
function canTransform(g: CanvasRenderingContext2D): boolean {
  if (supported === null) {
    try {
      const p = g.createPattern(document.createElement('canvas'), 'repeat');
      supported = !!p && typeof p.setTransform === 'function' && typeof DOMMatrix === 'function';
    } catch { supported = false; }
  }
  return supported;
}

/** A texture arrived from art/terrain. */
export function addTexture(name: string, img: HTMLImageElement) {
  const base = toCanvas(img);
  pyramids.set(name as Surface, pyramid(base));
  for (const [to, from, colour] of DERIVED) {
    if (from === name) pyramids.set(to, pyramid(recolour(base, colour)));
  }
  patterns.clear();
}

/** Ready to draw textured ground (needs at least the grasses and water). */
export function groundReady(g: CanvasRenderingContext2D): boolean {
  return pyramids.has('grass_summer') && pyramids.has('water_shallow') && canTransform(g);
}

export const hasSurface = (s: Surface) => pyramids.has(s);

/**
 * The pattern for a surface at the current zoom. `tw` is the tile width in CSS px, `dpr` the
 * device pixel ratio, and (ox, oy) the screen position of the map's origin.
 */
export function surface(g: CanvasRenderingContext2D, name: Surface, tw: number, dpr: number, ox: number, oy: number): CanvasPattern | null {
  const pyr = pyramids.get(name);
  if (!pyr) return null;
  const size = pyr[0].width;
  const scale = (tw * TILES_PER_REPEAT) / size; // CSS px per texel at full size
  // The smallest copy that still has about a texel per device pixel.
  let level = 0;
  while (level < pyr.length - 1 && scale * dpr * 2 ** (level + 1) <= 1.5) level++;
  const key = `${name}:${level}`;
  let p = patterns.get(key);
  if (!p) {
    p = g.createPattern(pyr[level], 'repeat')!;
    patterns.set(key, p);
  }
  const k = scale * 2 ** level;
  p.setTransform(new DOMMatrix([k, 0, 0, k, ox, oy]));
  return p;
}

// ---------------------------------------------------------------------------

function toCanvas(img: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}

/** Box-filter a canvas down by (fx, fy); exact, so the copies still tile seamlessly. */
function shrink(src: HTMLCanvasElement, fx: number, fy: number): HTMLCanvasElement {
  const w = Math.max(1, src.width / fx), h = Math.max(1, src.height / fy);
  const s = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const out = g.createImageData(w, h);
  const n = fx * fy;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, gg = 0, b = 0, a = 0;
      for (let dy = 0; dy < fy; dy++) {
        for (let dx = 0; dx < fx; dx++) {
          const k = ((y * fy + dy) * src.width + (x * fx + dx)) * 4;
          r += s[k]; gg += s[k + 1]; b += s[k + 2]; a += s[k + 3];
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / n; out.data[o + 1] = gg / n; out.data[o + 2] = b / n; out.data[o + 3] = a / n;
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

/** The texture squashed to the view's slant (half height), then halved again and again. */
function pyramid(base: HTMLCanvasElement): HTMLCanvasElement[] {
  const out = [shrink(base, 1, 2)];
  while (out.length < LEVELS && out[out.length - 1].width >= 16) out.push(shrink(out[out.length - 1], 2, 2));
  return out;
}

/** The same texture in another colour: its light and shade, laid over the new colour. */
function recolour(src: HTMLCanvasElement, hex: string): HTMLCanvasElement {
  const g0 = src.getContext('2d')!;
  const img = g0.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  let total = 0;
  for (let i = 0; i < d.length; i += 4) total += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  const mean = total / (d.length / 4) || 1;
  const t = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    const f = 1 + (lum / mean - 1) * 0.8; // keep most of the texture's light and shade
    d[i] = Math.min(255, t[0] * f); d[i + 1] = Math.min(255, t[1] * f); d[i + 2] = Math.min(255, t[2] * f);
  }
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}
