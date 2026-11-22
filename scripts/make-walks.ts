// Walk sheets for villagers who so far have only a single front-facing painting
// (art/citizens/<era>/chr_<role>_<era>_idle_v01_96.png). Like the first painted
// villagers' sheets, the steps are made by moving the painting's legs, not by
// repainting them:
//
//   down   the painting, its legs taking turns to step toward you
//   left,  the painting narrowed to a three-quarter view (mirrored for left),
//   right  its legs swinging forward and back
//   up     the back view of the nearest painted villager (there's no painting
//          of this one from behind yet)
//
// Writes art/people/{96,64,32}/<role>_walk.png in the same layout as the others:
// four steps across, down/left/right/up from the top, feet at the bottom centre.
//
//   npx vite-node scripts/make-walks.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = 96;
const FOOT = 90; // where the feet stand in a 96 px frame
const ADULT = 77; // a grown-up's height in a 96 px frame, as on the first sheets
const CHILD = 62;

/** Each new villager: whose back view they borrow, and whether they're a child. */
const ROLES: Record<string, { back: string; child?: boolean }> = {
  'farmer-woman': { back: 'crafter' },
  'crafter-man': { back: 'farmer' },
  'elder-woman': { back: 'elder' },
  girl: { back: 'child', child: true },
  'leader-man': { back: 'leader' },
  'priest-man': { back: 'priest' },
  'merchant-woman': { back: 'merchant' },
};

interface Img { data: Buffer; w: number; h: number }

async function load(file: string): Promise<Img> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function bounds(img: Img) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.data[(y * img.w + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return { x0, y0, x1, y1 };
}

/** The figure, cropped and scaled to the sheets' size (and, for the side views, narrowed). */
async function figure(file: string, height: number, narrow = 1): Promise<Img> {
  const src = await load(file);
  const b = bounds(src);
  const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
  const scale = height / h;
  const { data, info } = await sharp(src.data, { raw: { width: src.w, height: src.h, channels: 4 } })
    .extract({ left: b.x0, top: b.y0, width: w, height: h })
    .resize(Math.max(1, Math.round(w * scale * narrow)), Math.round(h * scale), { kernel: 'lanczos3', fit: 'fill' })
    .raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

const sample = (img: Img, x: number, y: number) => {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= img.w || yi >= img.h) return null;
  const k = (yi * img.w + xi) * 4;
  return img.data.subarray(k, k + 4);
};

/**
 * One step: the figure placed in a 96 px cell, feet on the line. The body rises a little on the
 * passing steps; below the hem, each leg is stretched or shortened (down: toward or away from
 * you) or slid (sides: forward or back).
 */
function step(fig: Img, frame: number, side: boolean): Buffer {
  const out = Buffer.alloc(F * F * 4);
  const swing = frame === 0 ? 1 : frame === 2 ? -1 : 0;
  const rise = frame === 1 || frame === 3 ? 1 : 0;
  const legTop = Math.round(fig.h * 0.84);
  const left = Math.round((F - fig.w) / 2);
  const top = FOOT - fig.h + 1;
  const mid = fig.w / 2;
  for (let y = 0; y < F; y++) {
    for (let x = 0; x < F; x++) {
      const fx = x - left;
      let fy = y - top + rise;
      if (fy >= legTop) {
        // Legs, from the hem (which rises with the body) to the feet (which stay on the line):
        // the near (left) leg and the far (right) leg move in turn. Down: the stepping leg reaches
        // 2 px lower and the other draws up 1 px. Sides: the feet swing forward and back.
        const leg = fx < mid ? 1 : -1;
        const move = swing * leg;
        const reach = side ? 0 : move > 0 ? 2 : move < 0 ? -1 : 0;
        const span = fig.h - 1 - legTop;
        const dy = y - top - (legTop - rise);
        const destSpan = span + rise + reach;
        if (dy > destSpan) continue;
        const t = dy / Math.max(1, destSpan);
        const p = sample(fig, side ? fx - move * 1.5 * t : fx, legTop + t * span);
        if (p && p[3]) p.copy(out, (y * F + x) * 4);
        continue;
      }
      const p = sample(fig, fx, fy);
      if (p && p[3]) p.copy(out, (y * F + x) * 4);
    }
  }
  return out;
}

const mirror = (cell: Buffer) => {
  const out = Buffer.alloc(cell.length);
  for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) cell.copy(out, (y * F + (F - 1 - x)) * 4, (y * F + x) * 4, (y * F + x) * 4 + 4);
  return out;
};

async function make(role: string, spec: { back: string; child?: boolean }) {
  const file = path.join(ROOT, 'art/citizens/bronze', `chr_${role}_bronze_idle_v01_96.png`);
  if (!fs.existsSync(file)) { console.log(`- ${role}: no painting yet`); return; }
  const height = spec.child ? CHILD : ADULT;
  // An old woman stoops a little lower than the others stand.
  const front = await figure(file, role === 'elder-woman' ? ADULT - 5 : height);
  const sideFig = await figure(file, role === 'elder-woman' ? ADULT - 5 : height, 0.82);
  const backSheet = await load(path.join(ROOT, 'art/people/96', `${spec.back}_walk.png`));
  const sheet = Buffer.alloc(F * 4 * F * 4 * 4);
  const put = (cell: Buffer, col: number, row: number) => {
    for (let y = 0; y < F; y++) cell.copy(sheet, ((row * F + y) * F * 4 + col * F) * 4, y * F * 4, (y + 1) * F * 4);
  };
  for (let f = 0; f < 4; f++) {
    put(step(front, f, false), f, 0);
    const right = step(sideFig, f, true);
    put(mirror(right), f, 1);
    put(right, f, 2);
    // The back view, borrowed.
    const cell = Buffer.alloc(F * F * 4);
    for (let y = 0; y < F; y++) backSheet.data.copy(cell, y * F * 4, ((3 * F + y) * backSheet.w + f * F) * 4, ((3 * F + y) * backSheet.w + f * F + F) * 4);
    put(cell, f, 3);
  }
  const img = sharp(sheet, { raw: { width: F * 4, height: F * 4, channels: 4 } });
  const png = await img.png().toBuffer();
  for (const size of [96, 64, 32]) {
    const dir = path.join(ROOT, 'art/people', String(size));
    fs.mkdirSync(dir, { recursive: true });
    await sharp(png).resize(size * 4, size * 4, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(path.join(dir, `${role}_walk.png`));
  }
  console.log(`✓ ${role} (back view from ${spec.back})`);
}

for (const [role, spec] of Object.entries(ROLES)) await make(role, spec);
