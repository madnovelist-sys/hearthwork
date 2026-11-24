// Art pipeline: turns ChatGPT images in art/ into game-ready sprites in
// public/art/, plus a manifest the game reads at startup. Ground textures in
// art/terrain/ (ter_<surface>.png) and animals in art/animals/ are copied as they
// are; villagers' sheets (art/people/) and carried things (art/items/) are cleaned.
//
//   npm run art                 build sprites
//   npm run art -- --check DIR  also write images showing the footprint each
//                               sprite was given, for checking by eye
//
// Images can be template-aligned (made against a footprint template) or not:
// if not, the footprint is found from the building's outline. Either way,
// keep the image at the size ChatGPT made it; this script scales and trims.
//
// Optional sidecar JSON next to an image (same name, .json) can override
// { "anchorPx": [x, y], "tilePx": n, "lights": [[x, y], ...], "smoke": [[x, y], ...] }
// in the image's own pixels, and ask for "clearPale": true (a pale grey shadow or ground
// painted round the thing is cleared).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { fitBase } from '../src/render/footprint';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'art');
const OUT = path.join(ROOT, 'public', 'art');
const TARGET_TILE_PX = 256;
const NAME = /^([a-z]+)_([a-z0-9-]+)_([a-z-]+)_(\d+)x(\d+)_v(\d\d)(?:_([a-z-]+))?$/;

const checkIdx = process.argv.indexOf('--check');
const CHECK = checkIdx > 0 ? path.resolve(process.argv[checkIdx + 1]) : null;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.toLowerCase().endsWith('.png')) out.push(p);
  }
  return out;
}

interface Entry { file: string; tilePx: number; anchor: number[]; footprint: number[]; lights: number[][]; smoke: number[][] }

/** Ground textures (art/terrain/ter_*.png): flat, seamless squares, copied as they are. */
async function textures(problems: string[]): Promise<Record<string, string>> {
  const dir = path.join(SRC, 'terrain');
  const out: Record<string, string> = {};
  if (!fs.existsSync(dir)) return out;
  fs.mkdirSync(path.join(OUT, 'terrain'), { recursive: true });
  for (const name of fs.readdirSync(dir).sort()) {
    const m = name.match(/^ter_([a-z0-9_-]+)\.png$/);
    if (!m) { if (name.endsWith('.png')) problems.push(`terrain/${name}: textures are named ter_<surface>.png`); continue; }
    const meta = await sharp(path.join(dir, name)).metadata();
    if (meta.width !== meta.height) problems.push(`terrain/${name}: textures should be square`);
    await sharp(path.join(dir, name)).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'terrain', name));
    out[m[1]] = `terrain/${name}`;
    console.log(`✓ terrain/${name}  ${meta.width}×${meta.height}px texture`);
  }
  return out;
}

/**
 * Villagers (art/people/96/<role>_<sheet>.png): walk, carry and stoop sheets (5 rows: S, SE, E,
 * NE, N) and work loops (2 rows: SE, NE), in 96 px frames. Each is cleaned (the white matte some
 * were cut out with, and slivers of neighbouring figures), then also made at 64 and 32 px.
 */
/** How far the build moved each carry row's second frame sideways (96 px frame), by role. */
const shifts: Record<string, number[]> = {};

async function people(problems: string[]): Promise<Record<string, Record<string, Record<string, string>>>> {
  const dir = path.join(SRC, 'people', '96');
  const out: Record<string, Record<string, Record<string, string>>> = {};
  if (!fs.existsSync(dir)) return out;
  for (const size of [96, 64, 32]) fs.mkdirSync(path.join(OUT, 'people', String(size)), { recursive: true });
  for (const name of fs.readdirSync(dir).sort()) {
    const m = name.match(/^([a-z-]+?)_([a-z-]+)\.png$/);
    if (!m) { if (name.endsWith('.png')) problems.push(`people/96/${name}: sheets are named <role>_<sheet>.png`); continue; }
    const raw = await sharp(path.join(dir, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: W, height: H } = raw.info;
    if (W % 96 || H % 96) { problems.push(`people/96/${name}: ${W}×${H} isn't a whole number of 96 px frames`); continue; }
    cleanSheet(raw.data, W, H, 96);
    outlinePass(raw.data, W, H);
    if (m[2] === 'walk' || m[2] === 'carry' || m[2] === 'stoop') {
      const moved = steadySheet(raw.data, W, H, 96, m[2] !== 'stoop');
      // Where the hands are is measured on the second frame of each carry row, as painted.
      if (m[2] === 'carry') shifts[m[1]] = moved.map((row) => row[1] ?? 0);
    }
    for (const size of [96, 64, 32]) {
      const file = `people/${size}/${name}`;
      let img = sharp(raw.data, { raw: { width: W, height: H, channels: 4 } });
      if (size !== 96) img = img.resize(Math.round(W * size / 96), Math.round(H * size / 96), { kernel: 'lanczos3' });
      await img.png({ compressionLevel: 9 }).toFile(path.join(OUT, file));
      ((out[m[1]] ??= {})[m[2]] ??= {})[size] = file;
    }
  }
  console.log(`✓ people: ${Object.entries(out).map(([role, sheets]) => `${role} (${Object.keys(sheets).join(', ')})`).join('; ')}`);
  return out;
}

/**
 * A sheet cut out of a bigger painting: in each frame, clear the white matte round the figure
 * (near-white, colourless pixels joined to the outside, up to 10 px deep), then, where there was
 * one, the pale speckle it leaves along the edge (colourless white within 2 px of the outside;
 * cream cloth is warmer than that and stays), and any small islands apart from the figure (bits
 * of the next figure along).
 */
function cleanSheet(data: Buffer, W: number, H: number, cell: number) {
  const matte = (i: number) => {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return data[i * 4 + 3] > 0 && mn >= 196 && mx - mn <= 30;
  };
  const dist = new Int16Array(W * H).fill(-1);
  const q: number[] = [];
  for (let i = 0; i < W * H; i++) if (data[i * 4 + 3] <= 20) { dist[i] = 0; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], d = dist[i];
    if (d >= 10) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (((nx / cell) | 0) !== ((x / cell) | 0) || ((ny / cell) | 0) !== ((y / cell) | 0)) continue;
      const j = ny * W + nx;
      if (dist[j] >= 0 || !matte(j)) continue;
      dist[j] = d + 1;
      data[j * 4 + 3] = 0;
      q.push(j);
    }
  }
  // (Only on sheets that had a matte: more than a couple of hundred pixels of it.)
  if (q.filter((i) => dist[i] > 0).length > 200) {
    for (let pass = 0; pass < 2; pass++) {
      const kill: number[] = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, a = data[i * 4 + 3];
        if (a <= 20) continue;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const nx = x + dx, ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < W && ny < H && data[(ny * W + nx) * 4 + 3] <= 20;
        });
        if (!edge) continue;
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
        if ((mn >= 180 && mx - mn <= 28) || (a < 200 && mn >= 160 && mx - mn <= 40)) kill.push(i);
      }
      for (const i of kill) data[i * 4 + 3] = 0;
    }
  }
  // Islands: keep each frame's biggest piece and anything at least an eighth its size.
  const label = new Int32Array(W * H);
  for (let cy = 0; cy < H; cy += cell) for (let cx = 0; cx < W; cx += cell) {
    const pieces: number[][] = [];
    for (let y = cy; y < cy + cell; y++) for (let x = cx; x < cx + cell; x++) {
      const i = y * W + x;
      if (data[i * 4 + 3] <= 20 || label[i]) continue;
      const piece: number[] = [i];
      label[i] = 1;
      for (let k = 0; k < piece.length; k++) {
        const px = piece[k] % W, py = (piece[k] / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx < cx || ny < cy || nx >= cx + cell || ny >= cy + cell) continue;
          const j = ny * W + nx;
          if (label[j] || data[j * 4 + 3] <= 20) continue;
          label[j] = 1;
          piece.push(j);
        }
      }
      pieces.push(piece);
    }
    const big = Math.max(0, ...pieces.map((p) => p.length));
    for (const p of pieces) if (p.length < big * 0.12) for (const i of p) data[i * 4 + 3] = 0;
  }
}

/**
 * For paintings whose sidecar asks for it ("clearPale": true): a pale grey shadow or ground
 * painted round the thing (the white it was painted on, greyed), cleared wherever it joins the
 * outside. Only where asked, as white bark and white flowers are pale too.
 */
function clearPale(data: Buffer, W: number, H: number) {
  const pale = (i: number) => {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return data[i * 4 + 3] > 8 && mx > 160 && (mx - mn) / mx < 0.24;
  };
  const q: number[] = [];
  const seen = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (data[i * 4 + 3] <= 8) { seen[i] = 1; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (seen[j] || !pale(j)) continue;
      seen[j] = 1;
      data[j * 4 + 3] = 0;
      q.push(j);
    }
  }
}

/**
 * Some figures were cut out with a thin cream outline round them, the same colours as cream
 * cloth. The outline is pale with darker paint just inside it; cloth is pale all the way in. So
 * an outline pixel is a pale one on the edge whose neighbours a couple of pixels further in are
 * much darker. Cleared in two passes (outlines are a pixel or two thick).
 */
function outlinePass(data: Buffer, W: number, H: number) {
  const lum = (i: number) => 0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2];
  const clear = (i: number) => data[i * 4 + 3] <= 20;
  for (let pass = 0; pass < 2; pass++) {
    const edge = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!clear(i) && (clear(i - 1) || clear(i + 1) || clear(i - W) || clear(i + W))) edge[i] = 1;
    }
    const kill: number[] = [];
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      if (!edge[i]) continue;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b), L = lum(i);
      if (L < 165 || mn < 140 || mx - mn > 70) continue;
      let sum = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const j = i + dy * W + dx;
        if (edge[j] || data[j * 4 + 3] < 200) continue;
        sum += lum(j); n++;
      }
      if (n >= 3 && sum / n < L - 50) kill.push(i);
    }
    for (const i of kill) data[i * 4 + 3] = 0;
  }
}

/**
 * A walk painted as a figure moving across its frames sways from side to side when it's played on
 * the spot. Hold the head and shoulders still: each frame is moved sideways (whole pixels) so the
 * top third of the figure sits where it does in the row's middle frame; the legs and arms still
 * swing beneath. The small rise and fall of a step is kept. Then the whole row is moved so the
 * feet are, on average, over the middle of the frame (where the game stands them), so nobody
 * jumps sideways turning round. Returns how far each frame moved, by row.
 */
function steadySheet(data: Buffer, W: number, H: number, cell: number, still = true): number[][] {
  const moved: number[][] = [];
  const shiftFrame = (cx: number, cy: number, shift: number) => {
    for (let y = cy; y < cy + cell; y++) {
      const row = Buffer.from(data.subarray((y * W + cx) * 4, (y * W + cx + cell) * 4));
      for (let x = 0; x < cell; x++) {
        const from = x - shift;
        const k = (y * W + cx + x) * 4;
        if (from < 0 || from >= cell) { data[k] = data[k + 1] = data[k + 2] = data[k + 3] = 0; continue; }
        row.copy(data, k, from * 4, from * 4 + 4);
      }
    }
  };
  for (let cy = 0; cy < H; cy += cell) {
    const rowMoved: number[] = [];
    moved.push(rowMoved);
    const heads: number[] = [];
    for (let cx = 0; cx < W; cx += cell) {
      let top = -1, bottom = -1;
      for (let y = cy; y < cy + cell && top < 0; y++) for (let x = cx; x < cx + cell; x++) if (data[(y * W + x) * 4 + 3] > 100) { top = y; break; }
      for (let y = cy + cell - 1; y >= cy && bottom < 0; y--) for (let x = cx; x < cx + cell; x++) if (data[(y * W + x) * 4 + 3] > 100) { bottom = y; break; }
      if (top < 0) { heads.push(NaN); continue; }
      let sum = 0, n = 0;
      for (let y = top; y < top + (bottom - top) * 0.3; y++) for (let x = cx; x < cx + cell; x++) if (data[(y * W + x) * 4 + 3] > 100) { sum += x - cx; n++; }
      heads.push(n ? sum / n : NaN);
    }
    const known = heads.filter((h) => !isNaN(h)).sort((a, b) => a - b);
    const mid = known[known.length >> 1];
    heads.forEach((h, f) => {
      const shift = !still || isNaN(h) || known.length < 2 ? 0 : Math.max(-14, Math.min(14, Math.round(mid - h)));
      rowMoved.push(shift);
      if (shift) shiftFrame(f * cell, cy, shift);
    });
    // The feet (the lowest few pixels of each frame), on average over the middle.
    let sum = 0, n = 0;
    for (let cx = 0; cx < W; cx += cell) {
      let bottom = -1;
      for (let y = cy + cell - 1; y >= cy && bottom < 0; y--) for (let x = cx; x < cx + cell; x++) if (data[(y * W + x) * 4 + 3] > 100) { bottom = y; break; }
      if (bottom < 0) continue;
      for (let y = bottom - 7; y <= bottom; y++) for (let x = cx; x < cx + cell; x++) if (data[(y * W + x) * 4 + 3] > 100) { sum += x - cx; n++; }
    }
    const centre = n ? Math.max(-10, Math.min(10, Math.round(cell / 2 - sum / n))) : 0;
    if (centre) for (let f = 0; f * cell < W; f++) { shiftFrame(f * cell, cy, centre); rowMoved[f] += centre; }
  }
  return moved;
}

/**
 * Things people carry and set down (art/items/<era>/prop_<thing>_<era>[_full|_empty].png): single
 * objects on 64 px canvases standing at y = 58, cleaned of their white rim and trimmed.
 */
async function items(): Promise<Record<string, { file: string; ax: number; ay: number; h: number }>> {
  const dir = path.join(SRC, 'items');
  const out: Record<string, { file: string; ax: number; ay: number; h: number }> = {};
  if (!fs.existsSync(dir)) return out;
  for (const era of fs.readdirSync(dir).sort()) {
    if (!fs.statSync(path.join(dir, era)).isDirectory()) continue;
    fs.mkdirSync(path.join(OUT, 'items', era), { recursive: true });
    for (const name of fs.readdirSync(path.join(dir, era)).sort()) {
      const m = name.match(/^prop_([a-z-]+)_([a-z]+)(?:_(full|empty))?\.png$/);
      if (!m) continue;
      const raw = await sharp(path.join(dir, era, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width: W, height: H } = raw.info;
      defringe(raw.data, W, H, false);
      outlinePass(raw.data, W, H);
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (raw.data[(y * W + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (x1 < 0) continue;
      const file = `items/${era}/${name}`;
      await sharp(raw.data, { raw: { width: W, height: H, channels: 4 } }).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png({ compressionLevel: 9 }).toFile(path.join(OUT, file));
      // Where it stands (the middle of its foot), and how tall it is, in its own pixels.
      out[`${m[1]}${m[3] ? `:${m[3]}` : ''}`] = { file, ax: W / 2 - x0, ay: Math.min(y1, 58) - y0 + 1, h: y1 - y0 + 1 };
    }
  }
  console.log(`✓ items: ${Object.keys(out).join(', ')}`);
  return out;
}

/** Animals (art/animals/<era>/ani_<kind>_<era>_<state>_<size>.png): cleaned of their white. */
async function animals(): Promise<Record<string, Record<string, Record<string, string>>>> {
  const dir = path.join(SRC, 'animals');
  const out: Record<string, Record<string, Record<string, string>>> = {};
  if (!fs.existsSync(dir)) return out;
  for (const era of fs.readdirSync(dir).sort()) {
    if (!fs.statSync(path.join(dir, era)).isDirectory()) continue;
    fs.mkdirSync(path.join(OUT, 'animals', era), { recursive: true });
    for (const name of fs.readdirSync(path.join(dir, era)).sort()) {
      const m = name.match(/^ani_([a-z-]+)_([a-z-]+)_([a-z-]+)_(\d+)\.png$/);
      if (!m) continue;
      // Cleaned like the villagers: the white they were cut out of, its outline, and stray bits.
      const raw = await sharp(path.join(dir, era, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width: W, height: H } = raw.info;
      const cell = Number(m[4]);
      if (W % cell === 0 && H % cell === 0) { cleanSheet(raw.data, W, H, cell); outlinePass(raw.data, W, H); }
      await sharp(raw.data, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'animals', era, name));
      ((out[m[1]] ??= {})[m[3]] ??= {})[m[4]] = `animals/${era}/${name}`;
    }
  }
  console.log(`✓ animals: ${Object.keys(out).join(', ')}`);
  return out;
}

/**
 * Art cut out of a white background keeps a pale rim: edge pixels part-blended with white, and
 * a faint whitish haze. Take the white back out of the blended pixels, and clear pale, half-clear
 * haze within a few pixels of the outside, and leftover pale, half-clear background anywhere
 * inside (but not on winter art, where white edges are snow).
 */
function defringe(data: Buffer, W: number, H: number, winter: boolean) {
  // Distance (in px, up to 12) from the outside, for every pixel.
  const dist = new Uint8Array(W * H).fill(255);
  const q: number[] = [];
  for (let i = 0; i < W * H; i++) if (data[i * 4 + 3] < 8) { dist[i] = 0; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], d = dist[i];
    if (d >= 12) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (dist[j] > d + 1) { dist[j] = d + 1; q.push(j); }
    }
  }
  for (let i = 0; i < W * H; i++) {
    if (dist[i] === 0) continue;
    const k = i * 4;
    const a = data[k + 3] / 255;
    let r = data[k], g = data[k + 1], b = data[k + 2];
    // Deeper in, leftover background between the leaves or twigs: a pale grey, part see-through.
    if (dist[i] > 12) {
      const omx = Math.max(r, g, b), omn = Math.min(r, g, b);
      if (!winter && a < 0.88 && omx > 165 && (omx - omn) / omx < 0.22) data[k + 3] = 0;
      continue;
    }
    // Whitish haze, as painted (before taking the white out): gone.
    const omx = Math.max(r, g, b), omn = Math.min(r, g, b);
    if (!winter && a < 0.9 && omx > 195 && (omx - omn) / omx < 0.18) { data[k + 3] = 0; continue; }
    // Un-blend from white: c = a·fg + (1 − a)·255.
    if (a < 0.98) {
      r = Math.max(0, Math.min(255, (r - (1 - a) * 255) / a));
      g = Math.max(0, Math.min(255, (g - (1 - a) * 255) / a));
      b = Math.max(0, Math.min(255, (b - (1 - a) * 255) / a));
    }
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const pale = mx > 175 && (mx - mn) / Math.max(1, mx) < 0.2;
    if (!winter && pale && a < 0.97) { data[k + 3] = 0; continue; }
    data[k] = r; data[k + 1] = g; data[k + 2] = b;
    // A soft, see-through fade at the edge becomes a crisp one, a little inside it.
    const hard = Math.max(0, Math.min(1, (a - 0.42) / 0.4));
    data[k + 3] = Math.round(hard * 255);
  }
}

async function build() {
  if (!fs.existsSync(SRC)) { console.log('No art/ folder yet.'); return; }
  const manifest: {
    sprites: Record<string, Entry>;
    textures?: Record<string, string>;
    people?: Record<string, Record<string, Record<string, string>>>;
    animals?: Record<string, Record<string, Record<string, string>>>;
    items?: Record<string, { file: string; ax: number; ay: number; h: number }>;
    carryShift?: Record<string, number[]>;
  } = { sprites: {} };
  const problems: string[] = [];
  if (CHECK) fs.mkdirSync(CHECK, { recursive: true });
  // Clear out what earlier builds made of the villagers (old layouts would linger otherwise).
  fs.rmSync(path.join(OUT, 'people'), { recursive: true, force: true });
  manifest.textures = await textures(problems);
  manifest.people = await people(problems);
  manifest.carryShift = shifts;
  manifest.animals = await animals();
  manifest.items = await items();
  for (const file of walk(SRC).sort()) {
    const rel = path.relative(SRC, file);
    // Textures, villagers, animals and carried things are handled above; citizens/ holds the
    // single standing paintings the first walk sheets were made from (kept for reference).
    if (['terrain', 'people', 'animals', 'citizens', 'items'].some((d) => rel.startsWith(`${d}${path.sep}`))) continue;
    const base = path.basename(file, '.png');
    const m = base.match(NAME);
    if (!m) { problems.push(`${rel}: name doesn't follow kind_subject_era_WxH_vNN[_state].png`); continue; }
    const tw = Number(m[4]);
    const th = Number(m[5]);
    const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = raw.info.width;
    const H = raw.info.height;
    // Matted art (plants, rocks, props, places) loses the pale rim of its white background.
    if (/^(nature|props|landmarks)[\\/]/.test(rel)) defringe(raw.data, W, H, /_winter/.test(base));
    const alpha = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) alpha[i] = raw.data[i * 4 + 3];
    if (alpha[0] === 255 && alpha[W * H - 1] === 255) problems.push(`${rel}: no transparent background`);

    const fit = fitBase(alpha, W, H, tw, th);
    let anchor = [fit.ax, fit.ay];
    let tilePx = fit.tilePx;
    let lights: number[][] = [];
    let smoke: number[][] = [];
    const sidecar = file.replace(/\.png$/i, '.json');
    if (fs.existsSync(sidecar)) {
      const extra = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
      if (extra.anchorPx) anchor = extra.anchorPx;
      if (extra.tilePx) tilePx = extra.tilePx;
      lights = extra.lights ?? [];
      smoke = extra.smoke ?? [];
      if (extra.clearPale && !/_winter/.test(base)) clearPale(raw.data, W, H);
    }

    // Scale down to the game's resolution, then trim empty margins.
    const scale = Math.min(1, TARGET_TILE_PX / tilePx);
    const sw = Math.max(1, Math.round(W * scale));
    const sh = Math.max(1, Math.round(H * scale));
    const { data, info } = await sharp(raw.data, { raw: { width: W, height: H, channels: 4 } })
      .resize(sw, sh, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
    // At the game's size, the pale specks left along grass and bark edges (not on snow).
    if (/^(nature|props|landmarks)[\\/]/.test(rel) && !/_winter/.test(base)) outlinePass(data, info.width, info.height);
    let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * 4 + 3] > 2) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) { problems.push(`${rel}: image is empty`); continue; }
    const pad = 2;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(info.width - 1, x1 + pad); y1 = Math.min(info.height - 1, y1 + pad);
    const outRel = rel.split(path.sep).join('/');
    const outFile = path.join(OUT, outRel);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
      .png({ compressionLevel: 9 })
      .toFile(outFile);
    const tr = ([x, y]: number[]) => [Math.round((x * scale - x0) * 10) / 10, Math.round((y * scale - y0) * 10) / 10];
    manifest.sprites[base] = {
      file: outRel,
      tilePx: Math.round(tilePx * scale * 100) / 100,
      anchor: tr(anchor),
      footprint: [tw, th],
      lights: lights.map(tr),
      smoke: smoke.map(tr),
    };
    console.log(`✓ ${outRel}  ${x1 - x0 + 1}×${y1 - y0 + 1}px, footprint ${tw}×${th} found by ${fs.existsSync(sidecar) && JSON.parse(fs.readFileSync(sidecar, 'utf8')).anchorPx ? 'sidecar' : fit.method}`);

    if (CHECK) {
      // The footprint diamond drawn over the original, for checking by eye.
      const [ax, ay] = anchor;
      const T = tilePx;
      const pt = (gx: number, gy: number) => `${ax + (gx - gy - (tw - th)) * T / 2},${ay + (gx + gy - (tw + th)) * T / 4}`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
        <polygon points="${pt(0, 0)} ${pt(tw, 0)} ${pt(tw, th)} ${pt(0, th)}" fill="none" stroke="#ff2a6d" stroke-width="${Math.max(2, W / 300)}"/>
        <circle cx="${ax}" cy="${ay}" r="${W / 120}" fill="#2a7dff"/></svg>`;
      const full = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 150, g: 175, b: 110, alpha: 1 } } })
        .composite([{ input: file }, { input: Buffer.from(svg) }])
        .png()
        .toBuffer();
      await sharp(full).resize(Math.round(W / 2)).toFile(path.join(CHECK, `${base}.png`));
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const p of problems) console.warn(`! ${p}`);
  console.log(`${Object.keys(manifest.sprites).length} sprites and ${Object.keys(manifest.textures ?? {}).length} textures in public/art/manifest.json`);
}

build().catch((e) => { console.error(e); process.exit(1); });
