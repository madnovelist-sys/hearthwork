// Art pipeline: turns ChatGPT images in art/ into game-ready sprites in
// public/art/, plus a manifest the game reads at startup. Ground textures in
// art/terrain/ (ter_<surface>.png), villagers' walk sheets in art/people/ and
// animals in art/animals/ are copied as they are.
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
// in the image's own pixels.
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

/** Villagers (art/people/<frame size>/<role>_walk.png): walk sheets, copied as they are. */
async function people(): Promise<Record<string, Record<string, string>>> {
  const dir = path.join(SRC, 'people');
  const out: Record<string, Record<string, string>> = {};
  if (!fs.existsSync(dir)) return out;
  for (const size of fs.readdirSync(dir).filter((d) => /^\d+$/.test(d)).sort()) {
    fs.mkdirSync(path.join(OUT, 'people', size), { recursive: true });
    for (const name of fs.readdirSync(path.join(dir, size)).sort()) {
      const m = name.match(/^([a-z-]+)_walk\.png$/);
      if (!m) continue;
      await sharp(path.join(dir, size, name)).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'people', size, name));
      (out[m[1]] ??= {})[size] = `people/${size}/${name}`;
    }
  }
  console.log(`✓ people: ${Object.keys(out).join(', ')}`);
  return out;
}

/** Animals (art/animals/<era>/ani_<kind>_<era>_<state>_<size>.png): copied as they are. */
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
      await sharp(path.join(dir, era, name)).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'animals', era, name));
      ((out[m[1]] ??= {})[m[3]] ??= {})[m[4]] = `animals/${era}/${name}`;
    }
  }
  console.log(`✓ animals: ${Object.keys(out).join(', ')}`);
  return out;
}

/**
 * Art cut out of a white background keeps a pale rim: edge pixels part-blended with white, and
 * a faint whitish haze. Take the white back out of the blended pixels, and clear pale, half-clear
 * haze within a few pixels of the outside (but not on winter art, where white edges are snow).
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
    if (dist[i] === 0 || dist[i] > 12) continue;
    const k = i * 4;
    const a = data[k + 3] / 255;
    let r = data[k], g = data[k + 1], b = data[k + 2];
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
    people?: Record<string, Record<string, string>>;
    animals?: Record<string, Record<string, Record<string, string>>>;
  } = { sprites: {} };
  const problems: string[] = [];
  if (CHECK) fs.mkdirSync(CHECK, { recursive: true });
  manifest.textures = await textures(problems);
  manifest.people = await people();
  manifest.animals = await animals();
  for (const file of walk(SRC).sort()) {
    const rel = path.relative(SRC, file);
    // Textures, villagers and animals are copied as they are (above); citizens/ holds the
    // single paintings scripts/make-walks.ts turns into walk sheets.
    if (['terrain', 'people', 'animals', 'citizens'].some((d) => rel.startsWith(`${d}${path.sep}`))) continue;
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
    }

    // Scale down to the game's resolution, then trim empty margins.
    const scale = Math.min(1, TARGET_TILE_PX / tilePx);
    const sw = Math.max(1, Math.round(W * scale));
    const sh = Math.max(1, Math.round(H * scale));
    const { data, info } = await sharp(raw.data, { raw: { width: W, height: H, channels: 4 } })
      .resize(sw, sh, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
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
