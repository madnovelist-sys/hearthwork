// Work you can watch, done with the art we have: drawing water at the well
// (the bucket goes down on its rope, comes up full, and is tipped into the
// waiting jar), fishing lines with a float that bobs and dips when a fish
// bites, and the harvest cut across a field a strip at a time.
import type { Sprite } from './sprites';

// ---------------------------------------------------------------------------
// The well

/**
 * Where the bucket and its rope are painted in the well art (bld_well_bronze_1x1_v01, in its own
 * 256 px pixels): the rope's top at the crossbar, the bucket's box, and the water line it sinks
 * below. Only this painting is animated; other well art is drawn as it is.
 */
const WELL = { w: 256, h: 256, ax: 128, ay: 228, ropeX: 120, ropeTop: 72, box: { x0: 104, y0: 90, x1: 144, y1: 147 }, water: 146, depth: 40 };

export interface WellArt { empty: HTMLCanvasElement; bucket: HTMLCanvasElement; ox: number; oy: number }
const wellArt = new WeakMap<Sprite, WellArt | null>();

/**
 * The well without its bucket (the gap filled from the stones and water either side), and the
 * bucket on its own, made once from the painting.
 */
export function wellParts(sp: Sprite): WellArt | null {
  if (wellArt.has(sp)) return wellArt.get(sp)!;
  let out: WellArt | null = null;
  // The game's copy is trimmed: find where the painting's own pixels sit in it.
  const ox = WELL.ax - sp.ax, oy = WELL.ay - sp.ay;
  const fits = sp.real && Math.abs(sp.tilePx - 256) < 2 && sp.w > 150 && sp.w < 230;
  if (fits) {
    const src = document.createElement('canvas');
    src.width = sp.w; src.height = sp.h;
    const g = src.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(sp.img, 0, 0);
    const img = g.getImageData(0, 0, sp.w, sp.h);
    const d = img.data;
    const { x0, y0, x1, y1 } = WELL.box;
    const bx0 = x0 - ox, bx1 = x1 - ox, by0 = y0 - oy, by1 = y1 - oy, rx = WELL.ropeX - ox, rt = WELL.ropeTop - oy;
    // The bucket (and the rope down to it) on its own canvas.
    const bucket = document.createElement('canvas');
    bucket.width = sp.w; bucket.height = sp.h;
    const bg = bucket.getContext('2d')!;
    bg.save();
    bg.beginPath(); bg.rect(bx0, by0, bx1 - bx0, by1 - by0); bg.clip();
    bg.drawImage(sp.img, 0, 0);
    bg.restore();
    // The gap: the rope above the bucket is cleared; behind the bucket, each row is blended from
    // the painting just left and right of it (stone wall, then water).
    for (let y = rt; y < by0; y++) for (let x = rx - 4; x <= rx + 6; x++) { const k = (y * sp.w + x) * 4; if (k >= 0 && k < d.length) d[k + 3] = 0; }
    for (let y = by0; y < by1; y++) {
      const L = ((y * sp.w + (bx0 - 2)) * 4), R = ((y * sp.w + (bx1 + 2)) * 4);
      for (let x = bx0; x < bx1; x++) {
        const t = (x - bx0) / (bx1 - bx0), k = (y * sp.w + x) * 4;
        const above = y < WELL.water - 14 - oy && d[L + 3] < 40 && d[R + 3] < 40;
        for (let c = 0; c < 4; c++) d[k + c] = above ? 0 : Math.round(d[L + c] * (1 - t) + d[R + c] * t);
      }
    }
    g.putImageData(img, 0, 0);
    out = { empty: src, bucket, ox, oy };
  }
  wellArt.set(sp, out);
  return out;
}

/** How a draw of water goes, by time since it began (ms). */
export const DRAW_MS = 6200;
export function bucketAt(t: number): { drop: number; tilt: number; full: boolean } {
  const ease = (v: number) => v * v * (3 - 2 * v);
  if (t < 1900) return { drop: ease(t / 1900), tilt: 0, full: false }; // down on the rope
  if (t < 2700) return { drop: 1, tilt: 0, full: true }; // filling
  if (t < 4700) return { drop: 1 - ease((t - 2700) / 2000), tilt: 0, full: true }; // hauled up
  if (t < 5900) return { drop: 0, tilt: Math.sin(((t - 4700) / 1200) * Math.PI), full: true }; // tipped into the jar
  return { drop: 0, tilt: 0, full: false };
}

/**
 * Draw the bucket and rope of a well whose bucketless art has just been drawn at (x, y) (the
 * art's anchor on screen) and scale, mid-draw at time t (or hanging still if t < 0).
 * `toward` is which way the one drawing water stands (+1 right, -1 left); `into`, the mouth of the
 * jar it's tipped into, on screen, if there is one.
 */
export function drawBucket(g: CanvasRenderingContext2D, parts: WellArt, sp: Sprite, x: number, y: number, scale: number, t: number, toward: number, into?: { x: number; y: number }) {
  const { drop, tilt, full } = t < 0 ? { drop: 0, tilt: 0, full: false } : bucketAt(t);
  const left = x - sp.ax * scale, top = y - sp.ay * scale;
  const px = (v: number) => left + (v - parts.ox) * scale, py = (v: number) => top + (v - parts.oy) * scale;
  const dy = drop * WELL.depth * scale;
  // The rope, from the crossbar to the bucket's handle.
  g.strokeStyle = '#B98A4A'; g.lineWidth = Math.max(1, 2.6 * scale); g.lineCap = 'round';
  g.beginPath(); g.moveTo(px(WELL.ropeX), py(WELL.ropeTop)); g.lineTo(px(WELL.ropeX + tilt * 6 * toward), py(WELL.box.y0) + dy); g.stroke();
  // The bucket, sinking out of sight below the water line.
  g.save();
  g.beginPath(); g.rect(left - 50, top - 50, sp.w * scale + 100, py(WELL.water) - top + 50); g.clip();
  const cx = px((WELL.box.x0 + WELL.box.x1) / 2), cy = py(WELL.box.y0) + dy;
  // Tipped in place, about the middle of the bucket, toward the one drawing the water.
  const my = py((WELL.box.y0 + WELL.box.y1) / 2) + dy;
  g.translate(cx, my);
  if (tilt) g.rotate(-tilt * 0.6 * toward);
  g.translate(-cx, -my);
  g.drawImage(parts.bucket, left, top + dy, sp.w * scale, sp.h * scale);
  g.restore();
  // Water: dripping from a full bucket on the way up, poured out when it's tipped.
  if (full && drop < 0.9 && drop > 0.05) {
    g.fillStyle = 'rgba(170,215,235,0.8)';
    for (let i = 0; i < 2; i++) g.fillRect(cx + (i ? 6 : -5) * scale, cy + (32 + ((t / 7 + i * 40) % 30)) * scale, 1.6 * scale + 0.4, 3 * scale + 0.6);
  }
  if (tilt > 0.3) {
    g.strokeStyle = 'rgba(160,210,235,0.85)'; g.lineWidth = Math.max(1, 3 * scale);
    g.beginPath();
    const lipX = cx + toward * 18 * scale, lipY = cy + 18 * scale;
    g.moveTo(lipX, lipY);
    if (into) {
      // An arc of water over the rim, into the jar's mouth, and a splash of light where it lands.
      g.quadraticCurveTo(lipX + (into.x - lipX) * 0.8, lipY, into.x, into.y);
      g.stroke();
      g.fillStyle = 'rgba(220,240,250,0.7)';
      g.beginPath(); g.ellipse(into.x, into.y, 2.2 * scale + 0.8, 0.9 * scale + 0.4, 0, 0, Math.PI * 2); g.fill();
    } else {
      g.quadraticCurveTo(cx + toward * 30 * scale, cy + 26 * scale, cx + toward * 34 * scale, cy + 58 * scale);
      g.stroke();
    }
  }
  g.lineCap = 'butt';
}

// ---------------------------------------------------------------------------
// Fishing

/**
 * A fishing line from someone's hands out to a float on the water, which bobs, and every so often
 * dips under as a fish takes it, with a splash and a silver flick as it's landed.
 */
export function drawLine(g: CanvasRenderingContext2D, hx: number, hy: number, fx: number, fy: number, k: number, t: number, seed: number) {
  const cycle = 9000 + (seed % 5) * 1300;
  const c = (t + seed * 977) % cycle;
  const bite = c > cycle - 1500;
  const bob = bite ? 3 * k * Math.sin(((c - (cycle - 1500)) / 1500) * Math.PI) : Math.sin(t / 420 + seed) * 0.8 * k;
  const tipX = hx + (fx - hx) * 0.35, tipY = hy - 10 * k - (bite ? 3 * k : 0);
  // The rod, then the line sagging to the float.
  g.strokeStyle = '#6B4A2C'; g.lineWidth = Math.max(0.8, 0.55 * k); g.lineCap = 'round';
  g.beginPath(); g.moveTo(hx, hy); g.lineTo(tipX, tipY); g.stroke();
  g.strokeStyle = 'rgba(235,235,225,0.6)'; g.lineWidth = Math.max(0.5, 0.25 * k);
  g.beginPath(); g.moveTo(tipX, tipY); g.quadraticCurveTo((tipX + fx) / 2, Math.max(tipY, fy) + 2 * k, fx, fy + bob); g.stroke();
  // Rings round the float, and the float itself.
  g.strokeStyle = `rgba(255,255,255,${(bite ? 0.55 : 0.22) * (1 - ((t / 900 + seed) % 1))})`; g.lineWidth = Math.max(0.5, 0.3 * k);
  const ring = ((t / 900 + seed) % 1);
  g.beginPath(); g.ellipse(fx, fy + 0.5 * k, (1 + ring * 3) * k, (0.5 + ring * 1.5) * k, 0, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#E8513C';
  g.beginPath(); g.arc(fx, fy + bob - 0.5 * k, Math.max(0.8, 0.55 * k), 0, Math.PI * 2); g.fill();
  if (bite && c > cycle - 600) {
    // Landed: a silver fish flicks up out of the water.
    const u = (c - (cycle - 600)) / 600;
    g.fillStyle = '#D7DEE3';
    g.beginPath(); g.ellipse(fx + (hx - fx) * u * 0.5, fy - Math.sin(u * Math.PI) * 7 * k, 1.4 * k, 0.55 * k, -0.6, 0, Math.PI * 2); g.fill();
  }
  g.lineCap = 'butt';
}
