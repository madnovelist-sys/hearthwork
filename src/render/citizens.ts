// The painted villagers (art/people): fifteen of them (each role as a woman and
// a man, a girl and a boy). Each has sheets of four frames across, in 96, 64
// and 32 px frames:
//   walk, carry (hands held out in front, for whatever they're carrying) and
//   stoop (bending to the ground): five rows, S, SE, E, NE and N, facing right;
//   work loops (reap, hoe, draw-water): two rows, SE and NE.
// Facing left is the right-facing row mirrored, so there are eight ways to face.
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
/** Who stands in for a villager whose sheets haven't loaded (the same role, the other sex). */
const STAND_IN: Partial<Record<Role, Role>> = {
  'farmer-woman': 'crafter', 'crafter-man': 'farmer', 'merchant-woman': 'merchant', 'priest-man': 'priest',
  'leader-man': 'leader', girl: 'child', 'elder-woman': 'elder',
};
/** Which way someone faces: the eight points of the compass as seen on screen (S is toward you). */
export type Dir = 's' | 'se' | 'e' | 'ne' | 'n' | 'nw' | 'w' | 'sw';
export type SheetKind = 'walk' | 'carry' | 'stoop' | 'reap' | 'hoe' | 'draw-water';
/** The row each way of facing is painted in, and whether it's mirrored (the art faces right). */
const ROW5: Record<Dir, [number, boolean]> = { s: [0, false], se: [1, false], e: [2, false], ne: [3, false], n: [4, false], nw: [3, true], w: [2, true], sw: [1, true] };
/** Work loops have only the two diagonals: toward you (SE) and away (NE). */
const ROW2: Record<Dir, [number, boolean]> = { s: [0, false], se: [0, false], e: [0, false], ne: [1, false], n: [1, false], nw: [1, true], w: [0, true], sw: [0, true] };
const SIZES = [32, 64, 96] as const;
/** A grown-up's height as a share of the frame, and where the feet stand. */
const FIGURE = 77 / 96;
const FOOT = 89.5 / 96;

interface Sheet { img: HTMLImageElement | HTMLCanvasElement; size: number; rows: number }
const sheets = new Map<string, Sheet>();
const skinOf = new Map<Role, { rgb: [number, number, number]; tone: number }>();

/** A sheet arrived. */
export function addCitizenSheet(role: Role, kind: string, size: number, img: HTMLImageElement) {
  sheets.set(`${role}:${kind}:${size}`, { img, size, rows: Math.round(img.height / size) });
  toned.clear();
  tonedPx = 0;
  skinOf.delete(role);
}

export const citizensReady = () => sheets.has('farmer:walk:64') && sheets.has('farmer-woman:walk:64');

const hasAny = (role: Role, kind: SheetKind) => SIZES.some((s) => sheets.has(`${role}:${kind}:${s}`));
/** The role whose art is drawn for this one (its own, or a stand-in until it loads). */
const drawnAs = (role: Role): Role => (hasAny(role, 'walk') || !STAND_IN[role] ? role : STAND_IN[role]!);
/** Whether this villager has a painted sheet of this kind. */
export const hasSheet = (role: Role, kind: SheetKind) => hasAny(drawnAs(role), kind);

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
 * Which way someone faces, from the way they're going on the ground: straight down the screen
 * shows their front, straight up their back, straight across their side; anything between, the
 * three-quarter views. The streets run at about ±27° and ±153° on screen, well inside the three-
 * quarter views, so walking along one never flickers between two. A few degrees of give at each
 * edge, so they don't flicker anywhere else either.
 */
export function dirOf(dx: number, dy: number, was: Dir): Dir {
  const sx = dx - dy, sy = (dx + dy) / 2;
  if (Math.hypot(sx, sy) < 1e-4) return was;
  const a = (Math.atan2(sy, sx) * 180) / Math.PI; // 0 = right, 90 = down the screen
  const now = sector(a);
  if (now === was) return was;
  // Only turn once well into the new view's range.
  return sector(a - 6) === now && sector(a + 6) === now ? now : was;
}
function sector(deg: number): Dir {
  const d = ((deg + 540) % 360) - 180;
  if (d >= -12 && d < 12) return 'e';
  if (d >= 12 && d < 68) return 'se';
  if (d >= 68 && d < 112) return 's';
  if (d >= 112 && d < 168) return 'sw';
  if (d >= 168 || d < -168) return 'w';
  if (d >= -168 && d < -112) return 'nw';
  if (d >= -112 && d < -68) return 'n';
  return 'ne';
}
/** Whether someone facing this way is turned to the right on screen. */
export const facesRight = (dir: Dir) => dir === 'se' || dir === 'e' || dir === 'ne' || dir === 's';
/** Whether we see their front (so what they hold in front of them is in front of them on screen). */
export const facesUs = (dir: Dir) => dir === 's' || dir === 'se' || dir === 'sw' || dir === 'e' || dir === 'w';

/**
 * Draw someone with their feet at (x, y), a grown-up `height` CSS px tall (children's bodies are
 * smaller on the sheet already), from one of their sheets. `dip` (0..1) crouches them a little,
 * for those with no painted stoop. Returns false when there's no sheet for the role.
 */
export function drawCitizen(
  g: CanvasRenderingContext2D, x: number, y: number, height: number, dpr: number,
  role: Role, dir: Dir, frame: number, tone: number, kind: SheetKind = 'walk', dip = 0,
): boolean {
  role = drawnAs(role);
  if (!hasAny(role, kind)) return false;
  // The smallest sheet that's still sharp at this size on screen.
  const want = (height * dpr) / FIGURE;
  let size = 0;
  for (const s of SIZES) if (sheets.has(`${role}:${kind}:${s}`)) { size = s; if (s >= want * 0.9) break; }
  const sheet = sheets.get(`${role}:${kind}:${size}`)!;
  const [row, flip] = (sheet.rows >= 5 ? ROW5 : ROW2)[dir];
  const img = tonedSheet(role, kind, size, tone, flip);
  const scale = height / (size * FIGURE);
  const box = size * scale;
  const tall = box * (1 - dip * 0.16);
  g.drawImage(img, (frame % 4) * size, row * size, size, size, x - box / 2, y - FOOT * size * scale * (tall / box), box, tall);
  return true;
}

// ---------------------------------------------------------------------------
// Hands: where something carried is held, and where it's set down

/** Where the hands are in the carry sheets (96 px frame, rows S, SE, E, NE), as painted. */
const CARRY: Partial<Record<Role, [number, number][]>> = {
  farmer: [[50, 53], [52, 54], [72, 55], [75, 53]],
  'farmer-woman': [[51, 55], [47, 56], [56, 56], [69, 54]],
  leader: [[53, 50], [58, 51], [63, 51], [65, 50]],
  merchant: [[49, 52], [55, 51], [65, 51], [62, 52]],
};
/** The carry sheets with forearms added to the walk: the hands are lower, at the belt. */
const CARRY_ADDED: [number, number][] = [[48, 61], [48, 61], [70, 64], [62, 64]];
/** Where the hands reach the ground when stooping (rows S, SE, E, NE, N). */
const GROUND: [number, number][] = [[48, 86], [53, 86], [62, 86], [69, 87], [48, 84]];

/**
 * Where someone's hands are, in px of a 96 px frame from their feet (+x to the right on screen,
 * +y down): holding something in front of them, or (when stooping, `reach` 0..1) partway down
 * to the ground in front of them.
 */
export function handsOf(role: Role, dir: Dir, reach = 0): { x: number; y: number } {
  role = drawnAs(role);
  const [row, flip] = ROW5[dir];
  const held = row === 4 ? [48, 58] : (CARRY[role] ?? CARRY_ADDED)[row];
  const low = GROUND[row];
  const hx = held[0] + (low[0] - held[0]) * reach, hy = held[1] + (low[1] - held[1]) * reach;
  return { x: (flip ? 96 - hx : hx) - 48, y: hy - 89.5 };
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

/** The role's painted skin: the middle of the face in the first front frame (from the biggest walk sheet). */
function skinFor(role: Role) {
  let hit = skinOf.get(role);
  if (hit) return hit;
  const size = [...SIZES].reverse().find((s) => sheets.has(`${role}:walk:${s}`)) ?? 0;
  if (!size) return { rgb: [200, 140, 90] as [number, number, number], tone: -1 };
  const { data, w } = pixels(sheets.get(`${role}:walk:${size}`)!.img);
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

/**
 * Recoloured and mirrored sheets, made as they're needed and kept while they're in use: the least
 * recently drawn go first once they'd take more than about 80 MB.
 */
const toned = new Map<string, HTMLImageElement | HTMLCanvasElement>();
let tonedPx = 0;
const TONED_BUDGET = 20_000_000;
function keep(key: string, img: HTMLImageElement | HTMLCanvasElement) {
  toned.set(key, img);
  if (img instanceof HTMLCanvasElement) tonedPx += img.width * img.height;
  for (const [k, v] of toned) {
    if (tonedPx <= TONED_BUDGET || toned.size <= 1) break;
    toned.delete(k);
    if (v instanceof HTMLCanvasElement) tonedPx -= v.width * v.height;
  }
  return img;
}

/** The sheet with its skin moved to another tone, and mirrored to face left if asked. */
function tonedSheet(role: Role, kind: SheetKind, size: number, tone: number, flip: boolean): HTMLImageElement | HTMLCanvasElement {
  const sheet = sheets.get(`${role}:${kind}:${size}`)!;
  const skin = skinFor(role);
  const t = ((tone % SKIN.length) + SKIN.length) % SKIN.length;
  const key = `${role}:${kind}:${size}:${t === skin.tone || skin.tone < 0 ? '' : t}:${flip ? 'm' : ''}`;
  const hit = toned.get(key);
  if (hit) {
    // Most recently used goes to the back of the queue.
    toned.delete(key); toned.set(key, hit);
    return hit;
  }
  if (flip) {
    // Each frame mirrored where it stands (the frames stay in order).
    const src = tonedSheet(role, kind, size, tone, false);
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const g = out.getContext('2d')!;
    for (let fx = 0; fx < src.width; fx += size) {
      g.setTransform(-1, 0, 0, 1, fx * 2 + size, 0);
      g.drawImage(src, fx, 0, size, src.height, fx, 0, size, src.height);
    }
    return keep(key, out);
  }
  if (t === skin.tone || skin.tone < 0) return keep(key, sheet.img);
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
  return keep(key, out);
}

/**
 * How surely each pixel is skin, 0..1. In the face (the top fifth of a figure standing upright),
 * anything in the skin's hue and saturation, whatever the light, except hair, cream cloth and
 * white beards. Elsewhere (and in frames where they bend, when the top of the figure may be their
 * back), only pixels very close to the skin's own colour (the clothes are painted in the same warm
 * hues): hands, arms and legs. Then lone specks are dropped and pixels surrounded by skin filled
 * in, so a face or an arm changes colour evenly, not in spots.
 */
function skinWeights(data: Uint8ClampedArray, w: number, h: number, size: number, ref: [number, number, number]): Float32Array {
  const out = new Float32Array(w * h);
  const rl = lum(...ref);
  const rsum = ref[0] + ref[1] + ref[2] + 1;
  const [rh, rs] = hsv(...ref);
  const cell = new Float32Array(size * size);
  // How tall the figure stands in each frame: those well short of the tallest are bending.
  const span = (cx: number, cy: number) => {
    let y0 = 1e9, y1 = -1;
    for (let y = cy; y < cy + size; y++) for (let x = cx; x < cx + size; x++) if (data[(y * w + x) * 4 + 3] > 40) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return [y0, y1];
  };
  let tallest = 0;
  for (let cy = 0; cy < h; cy += size) for (let cx = 0; cx < w; cx += size) { const [y0, y1] = span(cx, cy); tallest = Math.max(tallest, y1 - y0); }
  for (let cy = 0; cy < h; cy += size) {
    for (let cx = 0; cx < w; cx += size) {
      const [fy0, fy1] = span(cx, cy);
      if (fy1 < 0) continue;
      const fh = Math.max(1, fy1 - fy0);
      const upright = fh >= tallest * 0.9;
      cell.fill(0);
      for (let y = cy; y < cy + size; y++) {
        const at = (y - fy0) / fh;
        const tol = at > 0.8 ? 0.032 : 0.02;
        for (let x = cx; x < cx + size; x++) {
          const i = (y * w + x) * 4;
          if (data[i + 3] < 30) continue;
          const L = lum(data[i], data[i + 1], data[i + 2]) / rl;
          let k = 0;
          if (at < 0.22 && upright) {
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
