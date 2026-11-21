// Art pipeline: turns ChatGPT images in art/ into game-ready sprites in
// public/art/, plus a manifest the game reads at startup. Ground textures in
// art/terrain/ (ter_<surface>.png) are copied as they are.
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

async function build() {
  if (!fs.existsSync(SRC)) { console.log('No art/ folder yet.'); return; }
  const manifest: { sprites: Record<string, Entry>; textures?: Record<string, string> } = { sprites: {} };
  const problems: string[] = [];
  if (CHECK) fs.mkdirSync(CHECK, { recursive: true });
  manifest.textures = await textures(problems);
  for (const file of walk(SRC).sort()) {
    const rel = path.relative(SRC, file);
    if (rel.startsWith(`terrain${path.sep}`)) continue;
    const base = path.basename(file, '.png');
    const m = base.match(NAME);
    if (!m) { problems.push(`${rel}: name doesn't follow kind_subject_era_WxH_vNN[_state].png`); continue; }
    const tw = Number(m[4]);
    const th = Number(m[5]);
    const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = raw.info.width;
    const H = raw.info.height;
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
