// The painted villagers (art/people): fifteen of them (each role as a woman and
// a man, a girl and a boy), each walking in four directions, four steps to a
// stride, in sheets of 32, 64 and 96 px frames.
// Skin is the person's own, not the role's: each sheet's skin (found from the
// face, and from where on the figure skin can be) is shifted to the person's
// tone, in the same warm painted light. Until the sheets load, or for a role
// with no sheet, the code-drawn figures stand in.
import { SKIN } from './figures';
import type { Roles } from './figures';
import type { Person } from '../sim/types';

export type Role =
  | 'farmer' | 'crafter' | 'merchant' | 'priest' | 'guard' | 'leader' | 'child' | 'elder'
  | 'farmer-woman' | 'crafter-man' | 'merchant-woman' | 'priest-man' | 'leader-man' | 'girl' | 'elder-woman';
/** Who stands in for a villager whose sheet hasn't loaded (the same role, the other sex). */
const STAND_IN: Partial<Record<Role, Role>> = {
  'farmer-woman': 'crafter', 'crafter-man': 'farmer', 'merchant-woman': 'merchant', 'priest-man': 'priest',
  'leader-man': 'leader', girl: 'child', 'elder-woman': 'elder',
};
export type Dir = 'down' | 'left' | 'right' | 'up';
const ROW: Record<Dir, number> = { down: 0, left: 1, right: 2, up: 3 };
const SIZES = [32, 64, 96] as const;
/** A grown-up's height as a share of the frame, and where the feet stand (from the art's notes). */
const FIGURE = 77 / 96;
const FOOT = 89.5 / 96;

interface Sheet { img: HTMLImageElement | HTMLCanvasElement; size: number }
const sheets = new Map<string, Sheet>();
const toned = new Map<string, HTMLCanvasElement>();
const skinOf = new Map<Role, { rgb: [number, number, number]; tone: number }>();

/** A walk sheet arrived (4 steps across, down/left/right/up from the top). */
export function addCitizenSheet(role: Role, size: number, img: HTMLImageElement) {
  sheets.set(`${role}:${size}`, { img, size });
  toned.clear();
  skinOf.delete(role);
}

export const citizensReady = () => sheets.has('farmer:64') && sheets.has('crafter:64');

/**
 * Which painted villager someone is: their standing first (the leader's cloak, a faith-founder's
 * hood, a stall-keeper's satchel), then their age (elders, children), then their work: potters
 * and smiths in the crafter's apron, everyone else as a farmer. Each in a woman's or a man's
 * version, a girl's or a boy's.
 */
export function roleFor(p: Person, age: number, roles: Roles): Role {
  const f = p.sex === 'f';
  if (age < 12) return f ? 'girl' : 'child';
  if (age >= 16) {
    if (roles.leader === p.id) return f ? 'leader' : 'leader-man';
    if (roles.priests.has(p.id)) return f ? 'priest' : 'priest-man';
    if (roles.merchants.has(p.id)) return f ? 'merchant-woman' : 'merchant';
  }
  if (age >= 60) return f ? 'elder-woman' : 'elder';
  if (p.job === 'potter' || p.job === 'smith') return f ? 'crafter' : 'crafter-man';
  return f ? 'farmer-woman' : 'farmer';
}

/**
 * Which way someone faces, from the way they're going on screen: away from you (any way up the
 * screen) shows their back; toward you, their front; across, and down at a slant, the three-
 * quarter views turned the way they go. A few degrees of give at each edge, so they don't flicker
 * between two views when walking right along one.
 */
export function dirOf(dx: number, dy: number, was: Dir): Dir {
  const sx = dx - dy, sy = (dx + dy) / 2;
  if (Math.hypot(sx, sy) < 1e-4) return was;
  const a = (Math.atan2(sy, sx) * 180) / Math.PI; // 0 = right, 90 = down the screen
  // The streets run at about ±27° and ±153° on screen; the edges between views are kept well
  // away from them, so walking along a street never flickers between two views.
  const sector = (deg: number): Dir => (deg >= -10 && deg < 60 ? 'right' : deg >= 60 && deg < 120 ? 'down' : deg >= 120 || deg < -170 ? 'left' : 'up');
  const now = sector(a);
  if (now === was) return was;
  // Only turn once well into the new view's range.
  return sector(a - 8) === now && sector(a + 8) === now ? now : was;
}

/**
 * Draw someone with their feet at (x, y), a grown-up `height` CSS px tall (children's bodies are
 * smaller on the sheet already). Returns false when there's no sheet for the role.
 */
export function drawCitizen(
  g: CanvasRenderingContext2D, x: number, y: number, height: number, dpr: number,
  role: Role, dir: Dir, frame: number, tone: number,
): boolean {
  if (!SIZES.some((s) => sheets.has(`${role}:${s}`)) && STAND_IN[role]) role = STAND_IN[role]!;
  // The smallest sheet that's still sharp at this size on screen.
  const want = (height * dpr) / FIGURE;
  let size = 0;
  for (const s of SIZES) if (sheets.has(`${role}:${s}`)) { size = s; if (s >= want * 0.9) break; }
  if (!size) return false;
  const img = tonedSheet(role, size, tone);
  const scale = height / (size * FIGURE);
  const box = size * scale;
  g.drawImage(img, frame * size, ROW[dir] * size, size, size, x - box / 2, y - FOOT * size * scale, box, box);
  return true;
}

// ---------------------------------------------------------------------------
// Skin

const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const SKIN_RGB = SKIN.map(hex);

function pixels(img: HTMLImageElement | HTMLCanvasElement) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const image = g.getImageData(0, 0, c.width, c.height);
  return { image, data: image.data, w: c.width, h: c.height };
}

/** The role's painted skin: the middle of the face in the first front frame (from the biggest sheet). */
function skinFor(role: Role) {
  let hit = skinOf.get(role);
  if (hit) return hit;
  const size = [...SIZES].reverse().find((s) => sheets.has(`${role}:${s}`))!;
  const { data, w } = pixels(sheets.get(`${role}:${size}`)!.img);
  let y0 = 1e9, y1 = -1, x0 = 1e9, x1 = -1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[(y * w + x) * 4 + 3] > 40) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const h = y1 - y0, cx = (x0 + x1) / 2, half = Math.max(1, size / 19);
  const samples: [number, number, number][] = [];
  for (let y = Math.round(y0 + h * 0.09); y <= y0 + h * 0.2; y++) for (let x = Math.round(cx - half); x <= cx + half; x++) {
    const k = (y * w + x) * 4;
    if (data[k + 3] < 200 || lum(data[k], data[k + 1], data[k + 2]) < 70) continue; // not hair or eyes
    samples.push([data[k], data[k + 1], data[k + 2]]);
  }
  samples.sort((a, b) => lum(...a) - lum(...b));
  const rgb = samples[Math.floor(samples.length / 2)] ?? [200, 140, 90];
  // The swatch it's nearest to in lightness: people of that tone keep the art as painted.
  const L = lum(...rgb);
  let tone = 0;
  SKIN_RGB.forEach((s, i) => { if (Math.abs(lum(...s) - L) < Math.abs(lum(...SKIN_RGB[tone]) - L)) tone = i; });
  hit = { rgb, tone };
  skinOf.set(role, hit);
  return hit;
}

/** The sheet with its skin moved to another tone (made once per role, size and tone). */
function tonedSheet(role: Role, size: number, tone: number): HTMLImageElement | HTMLCanvasElement {
  const sheet = sheets.get(`${role}:${size}`)!;
  const skin = skinFor(role);
  const t = ((tone % SKIN.length) + SKIN.length) % SKIN.length;
  if (t === skin.tone) return sheet.img;
  const key = `${role}:${size}:${t}`;
  const hit = toned.get(key);
  if (hit) return hit;
  // The move between the two swatches, applied to the painted skin (so it keeps its warm light),
  // half by colour and half by lightness, so lighter skin doesn't turn yellow.
  const from = SKIN_RGB[skin.tone], to = SKIN_RGB[t];
  const light = lum(...to) / lum(...from);
  const ratio = [0, 1, 2].map((c) => Math.sqrt((to[c] / from[c]) * light));
  const { image, data, w, h } = pixels(sheet.img);
  const weight = skinWeights(data, w, h, size, skin.rgb);
  for (let i = 0, p = 0; p < weight.length; i += 4, p++) {
    const k = weight[p];
    if (!k) continue;
    for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, data[i + c] * (1 + (ratio[c] - 1) * k));
  }
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d')!.putImageData(image, 0, 0);
  toned.set(key, out);
  return out;
}

/**
 * How surely each pixel is skin, 0..1. In the face (the top fifth of the figure), anything in the
 * skin's hue and saturation, whatever the light, except hair, cream cloth and white beards. Below
 * it, only pixels very close to the skin's own colour (the clothes are painted in the same warm
 * hues): hands, arms and legs. Then lone specks are dropped and pixels surrounded by skin filled
 * in, so a face or an arm changes colour evenly, not in spots.
 */
function skinWeights(data: Uint8ClampedArray, w: number, h: number, size: number, ref: [number, number, number]): Float32Array {
  const out = new Float32Array(w * h);
  const rl = lum(...ref);
  const rsum = ref[0] + ref[1] + ref[2] + 1;
  const [rh, rs] = hsv(...ref);
  const cell = new Float32Array(size * size);
  for (let cy = 0; cy < h; cy += size) {
    for (let cx = 0; cx < w; cx += size) {
      let fy0 = 1e9, fy1 = -1;
      for (let y = cy; y < cy + size; y++) for (let x = cx; x < cx + size; x++) if (data[(y * w + x) * 4 + 3] > 40) { fy0 = Math.min(fy0, y); fy1 = Math.max(fy1, y); }
      if (fy1 < 0) continue;
      const fh = Math.max(1, fy1 - fy0);
      cell.fill(0);
      for (let y = cy; y < cy + size; y++) {
        const at = (y - fy0) / fh;
        const tol = at > 0.8 ? 0.032 : 0.02;
        for (let x = cx; x < cx + size; x++) {
          const i = (y * w + x) * 4;
          if (data[i + 3] < 30) continue;
          const L = lum(data[i], data[i + 1], data[i + 2]) / rl;
          let k = 0;
          if (at < 0.22) {
            const [hh, ss] = hsv(data[i], data[i + 1], data[i + 2]);
            let dh = Math.abs(hh - rh);
            if (dh > 180) dh = 360 - dh;
            if (L >= 0.5 && L <= 1.9 && ss >= 0.22) k = clamp01((16 - dh) / 8) * clamp01((0.35 - Math.abs(ss - rs)) / 0.1) * clamp01((L - 0.5) / 0.2);
          } else if (L >= 0.45 && L <= 1.4) {
            const s = data[i] + data[i + 1] + data[i + 2] + 1;
            const d = Math.hypot(data[i] / s - ref[0] / rsum, data[i + 1] / s - ref[1] / rsum, data[i + 2] / s - ref[2] / rsum);
            k = clamp01((tol - d) / (tol * 0.45)) * clamp01((L - 0.45) / 0.25);
          }
          cell[(y - cy) * size + (x - cx)] = k;
        }
      }
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const own = cell[y * size + x];
          const p = (cy + y) * w + cx + x;
          if (y === 0 || x === 0 || y === size - 1 || x === size - 1 || data[p * 4 + 3] < 30) { out[p] = own; continue; }
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) sum += cell[(y + dy) * size + x + dx];
          const avg = sum / 8;
          const L = lum(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]) / rl;
          out[p] = avg < 0.2 ? own * (avg / 0.2) : L > 0.55 ? Math.max(own, Math.min(1, avg * 1.2)) : own;
        }
      }
    }
  }
  return out;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function hsv(r: number, g: number, b: number): [number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hue = 0;
  if (d) {
    hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return [hue, mx ? d / mx : 0];
}
