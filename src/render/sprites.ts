// Every drawable thing is a Sprite: an image plus where its anchor (the lowest
// corner of its footprint) sits and how many pixels one tile spans. Real art
// from ChatGPT and the code-drawn placeholders work the same way, so art can
// replace a placeholder one asset at a time.
import { C, mix, shade } from './palette';
import type { BuildingKind, Era } from '../sim/types';
import { addTexture } from './ground';
import { addCitizenSheet, setCarryShift, type Role } from './citizens';
import { addAnimalArt } from './animal-art';
import { addItemArt } from './items';

export interface Sprite {
  img: CanvasImageSource;
  w: number;
  h: number;
  ax: number;
  ay: number;
  /** Image pixels per tile width. */
  tilePx: number;
  /** Footprint width in tiles the image was made for. */
  tiles?: number;
  /** Window and door glow points at night, in image pixels. */
  lights: [number, number][];
  /** Chimney points, in image pixels. */
  smoke: [number, number][];
  real?: boolean;
  /** The painting's name (real art only), e.g. bld_home_bronze_1x1_v02. */
  key?: string;
}

/** Asset names from the art document, minus variant and state. */
export const ART_KEY: Partial<Record<BuildingKind, string>> = {
  tent: 'bld_hide-tent_bronze_1x1',
  leanto: 'bld_lean-to_bronze_1x1',
  hut: 'bld_round-hut_bronze_1x1',
  house: 'bld_home_bronze_1x1',
  bighouse: 'bld_house-large_bronze_2x2',
  hall: 'bld_longhouse_bronze_3x3',
  granary: 'bld_granary_bronze_2x2',
  kiln: 'bld_kiln_bronze_2x2',
  furnace: 'bld_furnace_bronze_1x1',
  shrine: 'bld_shrine_bronze_2x2',
  well: 'bld_well_bronze_1x1',
  dock: 'bld_dock_bronze_1x1',
  stall: 'bld_stall_bronze_1x1',
  graveyard: 'bld_burial_bronze_3x3',
  pen: 'bld_pen_bronze_2x2',
  townhouse: 'bld_townhouse_bronze_1x1',
  alehouse: 'bld_alehouse_bronze_2x2',
  healer: 'bld_healer-hut_bronze_1x1',
  scribes: 'bld_scribe-house_bronze_2x2',
  temple: 'bld_temple_bronze_3x3',
  guildhall: 'bld_guildhall_bronze_2x2',
  hearth: 'lmk_hearth_bronze_1x1',
  stones: 'lmk_standing-stones_any_2x2',
  grove: 'lmk_sacred-grove_any_2x2',
  spring: 'lmk_spring_any_1x1',
  barrow: 'lmk_barrow_any_2x2',
  cairn: 'lmk_cairn_any_1x1',
  bigtree: 'lmk_great-tree_any_1x1',
  pyre: 'lmk_pyre-ground_bronze_2x2',
  skyplatform: 'lmk_sky-platform_bronze_2x2',
  tomb: 'lmk_tomb_bronze_2x2',
  landing: 'lmk_river-landing_bronze_1x1',
};

export const TREE_KEY = ['', 'nat_broadleaf_any_1x1', 'nat_pine_any_1x1', 'nat_fruit-tree_any_1x1', 'nat_berry-bush_any_1x1', 'nat_rock_any_1x1', 'nat_stump_any_1x1'];

// ---------------------------------------------------------------------------
// Real art

export interface ManifestEntry {
  file: string;
  tilePx: number;
  anchor: [number, number];
  footprint?: [number, number];
  lights?: [number, number][];
  smoke?: [number, number][];
}

const realArt = new Map<string, Sprite>();
const listeners = new Set<() => void>();
export const onArtChange = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const artChanged = () => { for (const fn of listeners) fn(); };

export async function loadManifest(base = './art/'): Promise<void> {
  let manifest: {
    sprites: Record<string, ManifestEntry>;
    textures?: Record<string, string>;
    people?: Record<string, Record<string, Record<string, string>>>;
    animals?: Record<string, Record<string, Record<string, string>>>;
    items?: Record<string, { file: string; ax: number; ay: number; h: number }>;
    carryShift?: Record<string, number[]>;
  };
  try {
    const res = await fetch(`${base}manifest.json`);
    if (!res.ok) return;
    manifest = await res.json();
  } catch {
    return;
  }
  for (const [role, shifts] of Object.entries(manifest.carryShift ?? {})) setCarryShift(role, shifts);
  await Promise.all([...Object.entries(manifest.sprites).map(async ([key, e]) => {
    try {
      const img = await loadImage(base + e.file);
      realArt.set(key, withDefaultLights(key, {
        img, w: img.naturalWidth, h: img.naturalHeight, ax: e.anchor[0], ay: e.anchor[1], tilePx: e.tilePx,
        tiles: e.footprint?.[0], lights: e.lights ?? [], smoke: e.smoke ?? [], real: true, key,
      }));
    } catch { /* missing file: keep the placeholder */ }
  }), ...Object.entries(manifest.textures ?? {}).map(async ([name, file]) => {
    try { addTexture(name, await loadImage(base + file)); } catch { /* the ground stays flat colour */ }
  }), ...Object.entries(manifest.people ?? {}).flatMap(([role, kinds]) => Object.entries(kinds).flatMap(([kind, sizes]) => Object.entries(sizes).map(async ([size, file]) => {
    try { addCitizenSheet(role as Role, kind, Number(size), await loadImage(base + file)); } catch { /* drawn in code instead */ }
  }))), ...Object.entries(manifest.items ?? {}).map(async ([key, e]) => {
    try { addItemArt(key, await loadImage(base + e.file), e.ax, e.ay, e.h); } catch { /* not drawn */ }
  }), ...Object.entries(manifest.animals ?? {}).flatMap(([kind, states]) => Object.entries(states).flatMap(([state, sizes]) => Object.entries(sizes).map(async ([size, file]) => {
    try { addAnimalArt(kind, state, Number(size), await loadImage(base + file)); } catch { /* drawn in code instead */ }
  })))]);
  artChanged();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Art dropped into the in-game test scene overrides files from disk. */
export function setOverride(key: string, sprite: Sprite | null) {
  if (sprite) realArt.set(key, withDefaultLights(key, sprite));
  else realArt.delete(key);
  artChanged();
}

export function hasRealArt(key: string) {
  return [...realArt.keys()].some((k) => k.startsWith(key));
}

const variantCache = new Map<string, string[]>();
onArtChange(() => variantCache.clear());

/** The variant tags (v01, v02, …) that exist for an asset. */
function variantsOf(base: string): string[] {
  let list = variantCache.get(base);
  if (!list) {
    const tags = new Set<string>();
    const re = new RegExp(`^${base.replace(/[-]/g, '\\-')}_(v\\d\\d)(?:_|$)`);
    for (const k of realArt.keys()) { const m = k.match(re); if (m) tags.add(m[1]); }
    list = [...tags].sort();
    variantCache.set(base, list);
  }
  return list;
}

export function realSprite(base: string, variant: number, state?: string): Sprite | undefined {
  const variants = variantsOf(base);
  if (!variants.length) return undefined;
  const v = variants[variant % variants.length];
  const tries = state ? [`${base}_${v}_${state}`, `${base}_${variants[0]}_${state}`] : [];
  tries.push(`${base}_${v}`, `${base}_${variants[0]}`);
  for (const k of tries) {
    const s = realArt.get(k);
    if (s) return s;
  }
  return undefined;
}

/** Homes without marked windows still glow at the door at night. */
function withDefaultLights(key: string, s: Sprite): Sprite {
  if (s.lights.length || !/^bld_(home|hut|round-hut|house|hide-tent|tent|lean-to|townhouse)/.test(key)) return s;
  const t = s.tilePx;
  return { ...s, lights: [[s.ax - t * 0.24, s.ay - t * 0.12 - t * 0.28]] };
}

// ---------------------------------------------------------------------------
// Placeholders, drawn in code at 128 px per tile

const T = 128;
const PAD = 24;
const cache = new Map<string, Sprite>();

type Pt = { x: number; y: number };

class Canvas {
  cv: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  ax: number;
  ay: number;
  constructor(public fw: number, public fh: number, public height: number) {
    this.cv = document.createElement('canvas');
    this.cv.width = Math.ceil(((fw + fh) * T) / 2 + PAD * 2);
    this.cv.height = Math.ceil(((fw + fh) * T) / 4 + height + PAD * 2);
    this.g = this.cv.getContext('2d')!;
    this.ax = (fw * T) / 2 + PAD;
    this.ay = this.cv.height - PAD;
  }
  /** Ground point at grid coordinates (gx, gy) inside the footprint, lifted by z pixels. */
  pt(gx: number, gy: number, z = 0): Pt {
    return { x: (gx - gy - (this.fw - this.fh)) * (T / 2) + this.ax, y: (gx + gy - (this.fw + this.fh)) * (T / 4) + this.ay - z };
  }
  poly(points: Pt[], fill: string, stroke?: string, lw = 1.5) {
    const g = this.g;
    g.beginPath();
    points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke(); }
  }
  sprite(lights: Pt[] = [], smoke: Pt[] = []): Sprite {
    return {
      img: this.cv, w: this.cv.width, h: this.cv.height, ax: this.ax, ay: this.ay, tilePx: T, tiles: this.fw,
      lights: lights.map((p) => [p.x, p.y]), smoke: smoke.map((p) => [p.x, p.y]),
    };
  }
}

const edge = (c: string) => shade(c, -0.35);

/** A walled box on an inset footprint. Returns the corners of its top. */
function box(c: Canvas, inset: number, height: number, wall: string, opts: { base?: string; baseH?: number; top?: string } = {}) {
  const { fw, fh } = c;
  const L = (z: number) => c.pt(inset, fh - inset, z);
  const B = (z: number) => c.pt(fw - inset, fh - inset, z);
  const R = (z: number) => c.pt(fw - inset, inset, z);
  const Tp = (z: number) => c.pt(inset, inset, z);
  // Soft contact shadow.
  c.poly([c.pt(inset - 0.06, fh - inset + 0.06), c.pt(fw - inset + 0.06, fh - inset + 0.06), c.pt(fw - inset + 0.06, inset - 0.06), c.pt(inset - 0.06, inset - 0.06)], 'rgba(62,58,79,0.25)');
  c.poly([L(0), B(0), B(height), L(height)], shade(wall, 0.08), edge(wall));
  c.poly([B(0), R(0), R(height), B(height)], shade(wall, -0.1), edge(wall));
  if (opts.base) {
    const bh = opts.baseH ?? 10;
    c.poly([L(0), B(0), B(bh), L(bh)], shade(opts.base, 0.05));
    c.poly([B(0), R(0), R(bh), B(bh)], shade(opts.base, -0.12));
    // zigzag band, like the painted homes
    const g = c.g;
    g.strokeStyle = 'rgba(242,230,204,0.75)';
    g.lineWidth = 1.6;
    g.beginPath();
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = c.pt(inset + (fw - 2 * inset) * t, fh - inset, bh + (i % 2 ? 6 : 1));
      i ? g.lineTo(a.x, a.y) : g.moveTo(a.x, a.y);
    }
    g.stroke();
  }
  if (opts.top) c.poly([L(height), B(height), R(height), Tp(height)], opts.top, edge(opts.top));
  return { L: L(height), B: B(height), R: R(height), T: Tp(height) };
}

function pyramidRoof(c: Canvas, inset: number, base: number, rise: number, color: string) {
  const { fw, fh } = c;
  const L = c.pt(inset, fh - inset, base);
  const B = c.pt(fw - inset, fh - inset, base);
  const R = c.pt(fw - inset, inset, base);
  const apex = c.pt(fw / 2, fh / 2, base + rise);
  c.poly([L, B, apex], shade(color, 0.12), edge(color));
  c.poly([B, R, apex], shade(color, -0.08), edge(color));
  // thatch strokes
  const g = c.g;
  g.strokeStyle = 'rgba(110,79,51,0.25)';
  g.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const a = { x: L.x + (B.x - L.x) * t, y: L.y + (B.y - L.y) * t };
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(apex.x + (a.x - apex.x) * 0.1, apex.y + (a.y - apex.y) * 0.1); g.stroke();
  }
  return apex;
}

function door(c: Canvas, at: number, inset: number, w = 0.16, h = 26) {
  const { fh } = c;
  const a = c.pt(at - w / 2, fh - inset, 0);
  const b = c.pt(at + w / 2, fh - inset, 0);
  c.poly([a, b, { x: b.x, y: b.y - h }, { x: a.x, y: a.y - h }], '#4A3326', '#2E2018');
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - h / 2 };
}

function rightWindow(c: Canvas, at: number, inset: number, z: number, size = 0.1) {
  const { fw } = c;
  const a = c.pt(fw - inset, at - size / 2, z);
  const b = c.pt(fw - inset, at + size / 2, z);
  c.poly([a, b, { x: b.x, y: b.y - 9 }, { x: a.x, y: a.y - 9 }], '#3A2A20');
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 4 };
}

function cylinder(c: Canvas, cx: number, cy: number, rx: number, h: number, color: string, base?: string) {
  const g = c.g;
  const ry = rx / 2;
  g.fillStyle = 'rgba(62,58,79,0.22)';
  g.beginPath(); g.ellipse(cx + 3, cy + 2, rx * 1.08, ry * 1.08, 0, 0, Math.PI * 2); g.fill();
  const grad = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
  grad.addColorStop(0, shade(color, 0.12));
  grad.addColorStop(1, shade(color, -0.14));
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(cx - rx, cy - h);
  g.lineTo(cx - rx, cy);
  g.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);
  g.lineTo(cx + rx, cy - h);
  g.closePath();
  g.fill();
  g.strokeStyle = edge(color); g.lineWidth = 1.4; g.stroke();
  if (base) {
    g.fillStyle = shade(base, -0.02);
    g.beginPath();
    g.moveTo(cx - rx, cy - 10);
    g.lineTo(cx - rx, cy);
    g.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);
    g.lineTo(cx + rx, cy - 10);
    g.ellipse(cx, cy - 10, rx, ry, 0, 0, Math.PI, false);
    g.fill();
  }
}

function placeholderBuilding(kind: BuildingKind, variant: number): Sprite {
  const v = variant % 3;
  switch (kind) {
    case 'leanto': {
      // A sloped thatch roof on four posts, open at the front, with a woodpile under it.
      const c = new Canvas(1, 1, 70);
      c.poly([c.pt(0.12, 0.88), c.pt(0.88, 0.88), c.pt(0.88, 0.12), c.pt(0.12, 0.12)], 'rgba(62,58,79,0.22)');
      const g = c.g;
      const post = (gx: number, gy: number, h: number) => {
        const a = c.pt(gx, gy), b = c.pt(gx, gy, h);
        g.strokeStyle = C.timber; g.lineWidth = 4; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      };
      post(0.2, 0.2, 58); post(0.8, 0.2, 58);
      // the wattle back wall
      c.poly([c.pt(0.2, 0.2), c.pt(0.8, 0.2), c.pt(0.8, 0.2, 56), c.pt(0.2, 0.2, 56)], shade(C.thatch, -0.25), edge(C.thatch));
      for (let i = 0; i < 3; i++) {
        const a = c.pt(0.3 + i * 0.13, 0.62, 6), b = c.pt(0.3 + i * 0.13, 0.32, 6);
        g.strokeStyle = shade(C.timber, 0.1); g.lineWidth = 7; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      post(0.2, 0.8, 34); post(0.8, 0.8, 34);
      c.poly([c.pt(0.12, 0.88, 32), c.pt(0.88, 0.88, 32), c.pt(0.88, 0.12, 62), c.pt(0.12, 0.12, 62)], C.thatch, edge(C.thatch));
      return c.sprite([c.pt(0.5, 0.6, 10)]);
    }
    case 'tent': {
      const c = new Canvas(1, 1, 90);
      const hide = [C.hide, '#A98C6A', '#C2A784'][v];
      const L = c.pt(0.2, 0.8), B = c.pt(0.8, 0.8), R = c.pt(0.8, 0.2);
      const apex = c.pt(0.5, 0.5, 72);
      c.poly([c.pt(0.15, 0.85), c.pt(0.85, 0.85), c.pt(0.85, 0.15), c.pt(0.15, 0.15)], 'rgba(62,58,79,0.22)');
      c.poly([L, B, apex], shade(hide, 0.1), edge(hide));
      c.poly([B, R, apex], shade(hide, -0.12), edge(hide));
      const fl = c.pt(0.42, 0.8), fr = c.pt(0.58, 0.8);
      c.poly([fl, fr, { x: (fl.x + fr.x) / 2 + 2, y: apex.y + 34 }], '#4A3326');
      const g = c.g;
      g.strokeStyle = C.timber; g.lineWidth = 3;
      g.beginPath(); g.moveTo(apex.x, apex.y); g.lineTo(apex.x - 8, apex.y - 14); g.moveTo(apex.x, apex.y); g.lineTo(apex.x + 9, apex.y - 12); g.stroke();
      return c.sprite([{ x: (fl.x + fr.x) / 2, y: fl.y - 8 }]);
    }
    case 'hut': {
      const c = new Canvas(1, 1, 130);
      const ctr = c.pt(0.5, 0.5);
      const rx = T * 0.31;
      cylinder(c, ctr.x, ctr.y + 6, rx, 34, C.mudbrick, C.redClay);
      // door
      c.poly([{ x: ctr.x - 18, y: ctr.y + 18 }, { x: ctr.x - 4, y: ctr.y + 21 }, { x: ctr.x - 4, y: ctr.y - 4 }, { x: ctr.x - 18, y: ctr.y - 7 }], '#4A3326');
      // cone roof
      const g = c.g;
      const top = ctr.y + 6 - 34;
      const apexY = top - [62, 56, 68][v];
      const rr = rx * 1.22;
      const grad = g.createLinearGradient(ctr.x - rr, 0, ctr.x + rr, 0);
      grad.addColorStop(0, shade(C.thatch, 0.18));
      grad.addColorStop(1, shade(C.thatch, -0.12));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(ctr.x, apexY);
      g.lineTo(ctr.x - rr, top + 4);
      g.ellipse(ctr.x, top + 4, rr, rr / 2, 0, Math.PI, 0, true);
      g.closePath();
      g.fill();
      g.strokeStyle = edge(C.thatch); g.lineWidth = 1.4; g.stroke();
      g.strokeStyle = 'rgba(110,79,51,0.25)'; g.lineWidth = 1;
      for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(ctr.x + (i * rr) / 3.5, top + 4 + Math.abs(i) * -1 + 8); g.lineTo(ctr.x + i * 2, apexY + 8); g.stroke(); }
      g.fillStyle = C.timber;
      g.fillRect(ctr.x - 5, apexY - 8, 10, 10);
      return c.sprite([{ x: ctr.x - 11, y: ctr.y + 8 }], v === 1 ? [{ x: ctr.x + 4, y: apexY }] : []);
    }
    case 'house': {
      const c = new Canvas(1, 1, 120);
      const inset = 0.1;
      const h = [44, 40, 48][v];
      box(c, inset, h, C.mudbrick, { base: C.redClay, baseH: 12 });
      const d = door(c, 0.35, inset);
      const w1 = rightWindow(c, 0.5, inset, h * 0.62);
      const w2 = rightWindow(c, 0.25, inset, h * 0.62);
      const roof = [C.thatch, shade(C.thatch, 0.06), shade(C.thatch, -0.04)][v];
      const apex = pyramidRoof(c, inset - 0.08, h - 4, 44, roof);
      return c.sprite([d, w1, w2], v === 2 ? [{ x: apex.x + 10, y: apex.y + 14 }] : []);
    }
    case 'pyre': {
      // A ring of blackened stones around a bed of ash and charred logs, a stack of wood waiting.
      const c = new Canvas(2, 2, 60);
      const g = c.g;
      const ctr = c.pt(1, 1);
      g.fillStyle = 'rgba(62,58,79,0.2)'; g.beginPath(); g.ellipse(ctr.x, ctr.y, 92, 40, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#6B625C'; g.beginPath(); g.ellipse(ctr.x, ctr.y - 4, 62, 26, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#3A3330'; g.beginPath(); g.ellipse(ctr.x, ctr.y - 6, 40, 16, 0, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.fillStyle = shade(C.stone, (i % 3) * 0.05 - 0.15);
        g.beginPath(); g.ellipse(ctr.x + Math.cos(a) * 64, ctr.y + Math.sin(a) * 27 - 6, 10, 7, 0, 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = '#2A221E'; g.lineWidth = 5;
      for (const [dx, dy] of [[-18, 0], [6, -4], [-4, 6]]) { g.beginPath(); g.moveTo(ctr.x + dx - 16, ctr.y + dy - 8); g.lineTo(ctr.x + dx + 16, ctr.y + dy - 4); g.stroke(); }
      const w = c.pt(1.75, 0.35);
      for (let i = 0; i < 4; i++) { g.fillStyle = shade(C.timber, (i % 2) * 0.1); g.fillRect(w.x - 22, w.y - 8 - i * 7, 44, 6); }
      return c.sprite();
    }
    case 'skyplatform': {
      // A high platform of poles on the hill, open to the sky.
      const c = new Canvas(2, 2, 190);
      const g = c.g;
      g.strokeStyle = shade(C.timber, -0.1); g.lineWidth = 5;
      const legs = [[0.5, 1.5], [1.5, 1.5], [1.5, 0.5], [0.5, 0.5]];
      for (const [x, y] of legs) { const a = c.pt(x, y), b = c.pt(x, y, 120); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      c.poly([c.pt(0.4, 1.6, 120), c.pt(1.6, 1.6, 120), c.pt(1.6, 0.4, 120), c.pt(0.4, 0.4, 120)], shade(C.timber, 0.15), edge(C.timber));
      g.strokeStyle = C.timber; g.lineWidth = 2;
      for (const [x, y] of legs) { const a = c.pt(x, y, 120), b = c.pt(x, y, 145); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      // a wrapped shape on top, and a bird
      const top = c.pt(1, 1, 128);
      g.fillStyle = '#C8B89A'; g.beginPath(); g.ellipse(top.x, top.y, 24, 8, -0.4, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#3B2F2A'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(top.x + 20, top.y - 34); g.quadraticCurveTo(top.x + 26, top.y - 40, top.x + 31, top.y - 34); g.quadraticCurveTo(top.x + 36, top.y - 40, top.x + 42, top.y - 34); g.stroke();
      return c.sprite();
    }
    case 'tomb': {
      // A chamber of great stones under a grassy mound, with a lintel over the door.
      const c = new Canvas(2, 2, 100);
      const g = c.g;
      const ctr = c.pt(1, 1);
      g.fillStyle = 'rgba(62,58,79,0.22)'; g.beginPath(); g.ellipse(ctr.x + 4, ctr.y + 4, 90, 38, 0, 0, Math.PI * 2); g.fill();
      const grad = g.createLinearGradient(0, ctr.y - 60, 0, ctr.y + 20);
      grad.addColorStop(0, '#A3B874'); grad.addColorStop(1, '#6E8A48');
      g.fillStyle = grad;
      g.beginPath(); g.ellipse(ctr.x, ctr.y - 8, 80, 52, 0, Math.PI, 0); g.ellipse(ctr.x, ctr.y - 8, 80, 22, 0, 0, Math.PI); g.fill();
      const d = c.pt(1.2, 1.9);
      c.poly([{ x: d.x - 26, y: d.y }, { x: d.x - 26, y: d.y - 40 }, { x: d.x + 26, y: d.y - 40 }, { x: d.x + 26, y: d.y }], shade(C.stone, 0.05), edge(C.stone));
      g.fillStyle = '#2E2620'; g.fillRect(d.x - 14, d.y - 32, 28, 32);
      c.poly([{ x: d.x - 34, y: d.y - 38 }, { x: d.x + 34, y: d.y - 38 }, { x: d.x + 34, y: d.y - 48 }, { x: d.x - 34, y: d.y - 48 }], shade(C.stone, -0.05), edge(C.stone));
      return c.sprite();
    }
    case 'landing': {
      // Flat stones stepping down into the water, where the rafts are pushed off.
      const c = new Canvas(1, 1, 40);
      const g = c.g;
      for (let i = 0; i < 4; i++) {
        const p = c.pt(0.5 - i * 0.05, 0.75 - i * 0.18, 8 - i * 2);
        g.fillStyle = shade(C.stone, 0.08 - i * 0.05);
        g.beginPath(); g.ellipse(p.x, p.y, 30 - i * 3, 12, -0.45, 0, Math.PI * 2); g.fill();
        g.strokeStyle = edge(C.stone); g.lineWidth = 1; g.stroke();
      }
      const f = c.pt(0.3, 0.3, 6);
      g.fillStyle = '#E3C16F'; g.beginPath(); g.arc(f.x, f.y - 4, 3, 0, Math.PI * 2); g.fill();
      return c.sprite();
    }
    case 'stones': {
      // A ring of weathered standing stones, some leaning, one fallen.
      const c = new Canvas(2, 2, 90);
      c.poly([c.pt(0.1, 1.9), c.pt(1.9, 1.9), c.pt(1.9, 0.1), c.pt(0.1, 0.1)], 'rgba(120,140,90,0.25)');
      const n = 9;
      const stones: [number, number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + v * 0.3;
        stones.push([1 + Math.cos(a) * 0.72, 1 + Math.sin(a) * 0.72, i === 4 ? 0 : 26 + ((i * 7 + v) % 4) * 7]);
      }
      stones.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
      const g = c.g;
      for (const [x, y, hgt] of stones) {
        const p = c.pt(x, y);
        if (!hgt) { g.fillStyle = shade(C.stone, -0.1); g.beginPath(); g.ellipse(p.x, p.y - 3, 12, 5, -0.4, 0, Math.PI * 2); g.fill(); continue; }
        const grad = g.createLinearGradient(p.x - 7, 0, p.x + 7, 0);
        grad.addColorStop(0, shade(C.stone, 0.18)); grad.addColorStop(1, shade(C.stone, -0.25));
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(p.x - 7, p.y); g.lineTo(p.x - 6, p.y - hgt); g.quadraticCurveTo(p.x, p.y - hgt - 6, p.x + 6, p.y - hgt + 2); g.lineTo(p.x + 7, p.y);
        g.closePath(); g.fill();
        g.strokeStyle = edge(C.stone); g.lineWidth = 1.1; g.stroke();
        g.fillStyle = 'rgba(122,150,74,0.6)'; g.fillRect(p.x - 5, p.y - hgt * 0.4, 4, 3);
      }
      return c.sprite();
    }
    case 'grove': {
      // A ring of old trees around a clearing, ribbons on the branches.
      const c = new Canvas(2, 2, 170);
      const g = c.g;
      c.poly([c.pt(0.2, 1.8), c.pt(1.8, 1.8), c.pt(1.8, 0.2), c.pt(0.2, 0.2)], 'rgba(90,110,60,0.3)');
      const trees: [number, number][] = [[0.45, 0.45], [1.55, 0.45], [0.4, 1.5], [1.5, 1.55], [1, 0.3]];
      trees.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
      for (const [x, y] of trees) {
        const p = c.pt(x, y);
        g.fillStyle = shade(C.timber, -0.1); g.fillRect(p.x - 5, p.y - 46, 10, 46);
        g.fillStyle = shade('#4E6B3A', ((x + y) % 0.5) - 0.2);
        g.beginPath(); g.ellipse(p.x, p.y - 74, 34, 30, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = shade('#4E6B3A', 0.12);
        g.beginPath(); g.ellipse(p.x - 8, p.y - 84, 18, 14, 0, 0, Math.PI * 2); g.fill();
        for (let i = 0; i < 3; i++) { g.fillStyle = ['#C9483A', '#E8D9A8', '#5B7FB0'][i]; g.fillRect(p.x - 14 + i * 10, p.y - 52 + (i % 2) * 4, 2, 9); }
      }
      return c.sprite();
    }
    case 'spring': {
      const c = new Canvas(1, 1, 40);
      const g = c.g;
      const ctr = c.pt(0.5, 0.5);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.fillStyle = shade(C.stone, (i % 3) * 0.06 - 0.06);
        g.beginPath(); g.ellipse(ctr.x + Math.cos(a) * 30, ctr.y + Math.sin(a) * 15 - 2, 8, 5, 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#6FA8C9'; g.beginPath(); g.ellipse(ctr.x, ctr.y - 2, 24, 11, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.ellipse(ctr.x - 6, ctr.y - 5, 8, 3, 0, 0, Math.PI * 2); g.fill();
      return c.sprite();
    }
    case 'barrow': {
      // A long grassy mound with a stone doorway.
      const c = new Canvas(2, 2, 80);
      const g = c.g;
      const ctr = c.pt(1, 1);
      g.fillStyle = 'rgba(62,58,79,0.22)'; g.beginPath(); g.ellipse(ctr.x + 4, ctr.y + 4, 98, 42, 0, 0, Math.PI * 2); g.fill();
      const grad = g.createLinearGradient(0, ctr.y - 50, 0, ctr.y + 20);
      grad.addColorStop(0, '#9DB86A'); grad.addColorStop(1, '#6E8A48');
      g.fillStyle = grad;
      g.beginPath(); g.ellipse(ctr.x, ctr.y, 94, 40, 0, Math.PI, 0); g.ellipse(ctr.x, ctr.y, 94, 18, 0, 0, Math.PI); g.fill();
      g.beginPath(); g.ellipse(ctr.x, ctr.y - 6, 80, 46, 0, Math.PI, 0); g.fill();
      const d = c.pt(1.25, 1.85);
      g.fillStyle = shade(C.stone, 0.05); g.fillRect(d.x - 14, d.y - 30, 28, 30);
      g.fillStyle = '#2E2620'; g.fillRect(d.x - 8, d.y - 24, 16, 24);
      return c.sprite();
    }
    case 'cairn': {
      const c = new Canvas(1, 1, 70);
      const g = c.g;
      const ctr = c.pt(0.5, 0.5);
      const rows = [[5, 0], [4, 12], [3, 23], [2, 33], [1, 42]];
      for (const [n, z] of rows) {
        for (let i = 0; i < n; i++) {
          const x = ctr.x + (i - (n - 1) / 2) * 13;
          g.fillStyle = shade(C.stone, ((i + z) % 3) * 0.07 - 0.08);
          g.beginPath(); g.ellipse(x, ctr.y - z - 4, 9, 7, 0, 0, Math.PI * 2); g.fill();
          g.strokeStyle = edge(C.stone); g.lineWidth = 0.8; g.stroke();
        }
      }
      return c.sprite();
    }
    case 'bigtree': {
      // One vast old oak.
      const c = new Canvas(1, 1, 200);
      const g = c.g;
      const p = c.pt(0.5, 0.5);
      g.fillStyle = 'rgba(62,58,79,0.25)'; g.beginPath(); g.ellipse(p.x + 6, p.y, 52, 20, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = shade(C.timber, -0.15);
      g.beginPath(); g.moveTo(p.x - 16, p.y); g.quadraticCurveTo(p.x - 8, p.y - 50, p.x - 12, p.y - 90); g.lineTo(p.x + 12, p.y - 90); g.quadraticCurveTo(p.x + 8, p.y - 50, p.x + 18, p.y); g.closePath(); g.fill();
      for (const [dx, dy, r, t] of [[-34, -110, 34, -0.1], [30, -112, 36, -0.15], [0, -140, 44, 0.05], [-14, -168, 28, 0.15], [20, -160, 26, 0.1]] as const) {
        g.fillStyle = shade('#567A3C', t); g.beginPath(); g.ellipse(p.x + dx, p.y + dy, r, r * 0.85, 0, 0, Math.PI * 2); g.fill();
      }
      return c.sprite();
    }
    case 'townhouse': {
      // Two storeys of mudbrick, a ladder up the side, and a flat roof with a parapet and awning.
      const c = new Canvas(1, 1, 150);
      const inset = 0.1;
      const h = [78, 84, 74][v];
      box(c, inset, h, C.mudbrick, { base: C.redClay, baseH: 12, top: shade(C.mudbrick, 0.14) });
      // a band between the floors
      c.poly([c.pt(inset, 1 - inset, h * 0.5), c.pt(1 - inset, 1 - inset, h * 0.5), c.pt(1 - inset, 1 - inset, h * 0.5 + 4), c.pt(inset, 1 - inset, h * 0.5 + 4)], shade(C.timber, 0.1));
      const d = door(c, 0.35, inset);
      const w1 = rightWindow(c, 0.3, inset, h * 0.35);
      const w2 = rightWindow(c, 0.3, inset, h * 0.8);
      const w3 = rightWindow(c, 0.65, inset, h * 0.8);
      // parapet
      const P2 = (gx: number, gy: number) => c.pt(gx, gy, h + 6);
      c.poly([c.pt(inset, 1 - inset, h), c.pt(1 - inset, 1 - inset, h), P2(1 - inset, 1 - inset), P2(inset, 1 - inset)], shade(C.mudbrick, 0.02), edge(C.mudbrick));
      c.poly([c.pt(1 - inset, 1 - inset, h), c.pt(1 - inset, inset, h), P2(1 - inset, inset), P2(1 - inset, 1 - inset)], shade(C.mudbrick, -0.12), edge(C.mudbrick));
      // a reed awning on the roof
      const g = c.g;
      g.strokeStyle = C.timber; g.lineWidth = 2.5;
      for (const [x, y] of [[0.3, 0.55], [0.6, 0.55]]) { const a = c.pt(x, y, h), b = c.pt(x, y, h + 22); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      c.poly([c.pt(0.2, 0.62, h + 22), c.pt(0.7, 0.62, h + 22), c.pt(0.7, 0.3, h + 26), c.pt(0.2, 0.3, h + 26)], [C.thatch, C.redClay, '#C98B3A'][v], edge(C.thatch));
      return c.sprite([d, w1, w2, w3]);
    }
    case 'alehouse': {
      const c = new Canvas(2, 2, 150);
      box(c, 0.2, 50, C.mudbrick, { base: C.redClay, baseH: 12 });
      const d = door(c, 0.75, 0.2, 0.26, 30);
      const w1 = rightWindow(c, 1.2, 0.2, 30, 0.16);
      const w2 = rightWindow(c, 0.6, 0.2, 30, 0.16);
      pyramidRoof(c, 0.08, 46, 56, shade(C.thatch, -0.05));
      const g = c.g;
      // a sign hanging from a bracket by the door
      const s1 = c.pt(1.2, 1.85, 44), s2 = c.pt(1.5, 1.85, 44);
      g.strokeStyle = C.timber; g.lineWidth = 3; g.beginPath(); g.moveTo(s1.x, s1.y); g.lineTo(s2.x, s2.y); g.stroke();
      c.poly([{ x: s2.x - 4, y: s2.y + 2 }, { x: s2.x + 8, y: s2.y + 8 }, { x: s2.x + 8, y: s2.y + 24 }, { x: s2.x - 4, y: s2.y + 18 }], C.bronze, edge(C.bronze));
      // benches and a barrel out front
      for (const x of [0.35, 1.45]) c.poly([c.pt(x, 1.92, 8), c.pt(x + 0.35, 1.92, 8), c.pt(x + 0.35, 2.05, 8), c.pt(x, 2.05, 8)], shade(C.timber, 0.2), edge(C.timber));
      const bar = c.pt(1.85, 1.95);
      g.fillStyle = shade(C.timber, 0.05); g.beginPath(); g.ellipse(bar.x, bar.y - 8, 7, 10, 0, 0, Math.PI * 2); g.fill();
      return c.sprite([d, w1, w2], [c.pt(1.3, 0.7, 120)]);
    }
    case 'healer': {
      // A small round hut with a garden of herbs out front.
      const c = new Canvas(1, 1, 110);
      const g = c.g;
      for (let i = 0; i < 6; i++) {
        const p = c.pt(0.15 + (i % 3) * 0.12, 0.82 + Math.floor(i / 3) * 0.08);
        g.fillStyle = ['#6E9A4A', '#8AAE5A', '#A07AB0'][i % 3];
        g.beginPath(); g.ellipse(p.x, p.y - 3, 5, 3.5, 0, 0, Math.PI * 2); g.fill();
      }
      const ctr = c.pt(0.58, 0.42);
      cylinder(c, ctr.x, ctr.y, T * 0.26, 30, shade(C.mudbrick, 0.08), C.redClay);
      g.fillStyle = '#4A3326'; g.fillRect(ctr.x - 6, ctr.y - 4 - 18 + 16, 12, 18);
      // a conical thatch roof
      g.fillStyle = C.thatch;
      g.beginPath(); g.moveTo(ctr.x - T * 0.32, ctr.y - 28); g.lineTo(ctr.x, ctr.y - 78); g.lineTo(ctr.x + T * 0.32, ctr.y - 28); g.closePath(); g.fill();
      g.strokeStyle = edge(C.thatch); g.lineWidth = 1.2; g.stroke();
      // a bundle of herbs drying under the eaves
      g.fillStyle = '#7A9A4A'; g.beginPath(); g.ellipse(ctr.x + 18, ctr.y - 22, 3, 7, 0, 0, Math.PI * 2); g.fill();
      return c.sprite([{ x: ctr.x, y: ctr.y - 6 }]);
    }
    case 'scribes': {
      // Long and many-windowed, with a small tower for the tablets.
      const c = new Canvas(2, 2, 170);
      box(c, 0.2, 46, shade(C.mudbrick, 0.06), { base: C.redClay, baseH: 10, top: shade(C.mudbrick, 0.16) });
      const d = door(c, 0.6, 0.2, 0.22, 28);
      const ws = [0.45, 0.8, 1.15, 1.5].map((at) => rightWindow(c, at, 0.2, 26, 0.09));
      const L = (z: number) => c.pt(1.05, 1.15, z), B = (z: number) => c.pt(1.55, 1.15, z), R = (z: number) => c.pt(1.55, 0.65, z), Tp = (z: number) => c.pt(1.05, 0.65, z);
      c.poly([L(46), B(46), B(96), L(96)], shade(C.mudbrick, 0.1), edge(C.mudbrick));
      c.poly([B(46), R(46), R(96), B(96)], shade(C.mudbrick, -0.08), edge(C.mudbrick));
      c.poly([L(96), B(96), R(96), Tp(96)], shade(C.mudbrick, 0.2), edge(C.mudbrick));
      const tw1 = rightWindow(c, 0.9, 0.45, 82, 0.08);
      return c.sprite([d, ...ws, tw1]);
    }
    case 'temple': {
      // A stepped mound of earth and brick with a shrine on top.
      const c = new Canvas(3, 3, 230);
      const tiers: [number, number, string][] = [[0.15, 34, shade(C.mudbrick, -0.05)], [0.55, 30, C.mudbrick], [0.95, 28, shade(C.mudbrick, 0.08)]];
      let z = 0;
      for (const [inset, hgt, col] of tiers) {
        const L = (q: number) => c.pt(inset, 3 - inset, q), B = (q: number) => c.pt(3 - inset, 3 - inset, q), R = (q: number) => c.pt(3 - inset, inset, q), Tp = (q: number) => c.pt(inset, inset, q);
        c.poly([L(z), B(z), B(z + hgt), L(z + hgt)], shade(col, 0.06), edge(col));
        c.poly([B(z), R(z), R(z + hgt), B(z + hgt)], shade(col, -0.12), edge(col));
        c.poly([L(z + hgt), B(z + hgt), R(z + hgt), Tp(z + hgt)], shade(col, 0.15), edge(col));
        z += hgt;
      }
      // the stair up the front
      c.poly([c.pt(1.3, 2.85, 0), c.pt(1.7, 2.85, 0), c.pt(1.7, 2.05, z), c.pt(1.3, 2.05, z)], shade(C.redClay, 0.05), edge(C.redClay));
      const L = (q: number) => c.pt(1.2, 1.8, q), B = (q: number) => c.pt(1.8, 1.8, q), R = (q: number) => c.pt(1.8, 1.2, q);
      c.poly([L(z), B(z), B(z + 34), L(z + 34)], shade(C.redClay, 0.08), edge(C.redClay));
      c.poly([B(z), R(z), R(z + 34), B(z + 34)], shade(C.redClay, -0.1), edge(C.redClay));
      pyramidRoof(c, 1.12, z + 32, 30, C.thatch);
      const fire = c.pt(1.5, 1.95, z + 8);
      return c.sprite([fire], [c.pt(1.5, 1.5, z + 70)]);
    }
    case 'guildhall': {
      const c = new Canvas(2, 2, 170);
      box(c, 0.18, 62, shade(C.timber, 0.4), { base: C.redClay, baseH: 14 });
      const d = door(c, 0.8, 0.18, 0.3, 38);
      const w1 = rightWindow(c, 0.5, 0.18, 40, 0.14);
      const w2 = rightWindow(c, 1.0, 0.18, 40, 0.14);
      const w3 = rightWindow(c, 1.5, 0.18, 40, 0.14);
      pyramidRoof(c, 0.06, 58, 64, shade(C.thatch, 0.05));
      // banners either side of the door
      for (const x of [0.4, 1.25]) {
        const b1 = c.pt(x, 1.82, 58), b2 = c.pt(x + 0.18, 1.82, 58);
        c.poly([b1, b2, { x: b2.x, y: b2.y + 36 }, { x: (b1.x + b2.x) / 2, y: b1.y + 44 }, { x: b1.x, y: b1.y + 36 }], [C.bronze, '#2C5A8C', C.redClay][v], edge(C.bronze));
      }
      return c.sprite([d, w1, w2, w3]);
    }
    case 'bighouse': {
      const c = new Canvas(2, 2, 160);
      box(c, 0.15, 56, C.mudbrick, { base: C.redClay, baseH: 14 });
      const d = door(c, 0.8, 0.15, 0.22, 32);
      const w1 = rightWindow(c, 1.3, 0.15, 36);
      const w2 = rightWindow(c, 0.6, 0.15, 36);
      pyramidRoof(c, 0.05, 52, 62, C.thatch);
      return c.sprite([d, w1, w2]);
    }
    case 'hall': {
      const c = new Canvas(3, 3, 210);
      box(c, 0.25, 70, shade(C.timber, 0.35), { base: C.redClay, baseH: 16 });
      const d = door(c, 1.5, 0.25, 0.4, 44);
      // a red banner beside the door
      const b1 = c.pt(2.05, 2.75, 66), b2 = c.pt(2.3, 2.75, 66);
      c.poly([b1, b2, { x: b2.x, y: b2.y + 40 }, { x: (b1.x + b2.x) / 2, y: b1.y + 48 }, { x: b1.x, y: b1.y + 40 }], C.redClay, edge(C.redClay));
      const w1 = rightWindow(c, 1, 0.25, 44, 0.15);
      const w2 = rightWindow(c, 2, 0.25, 44, 0.15);
      pyramidRoof(c, 0.1, 66, 86, C.thatch);
      return c.sprite([d, w1, w2], [{ x: c.pt(1.5, 1.5, 150).x, y: c.pt(1.5, 1.5, 150).y }]);
    }
    case 'granary': {
      const c = new Canvas(1, 1, 120);
      const g = c.g;
      g.strokeStyle = C.timber; g.lineWidth = 5;
      for (const [x, y] of [[0.25, 0.75], [0.75, 0.75], [0.75, 0.25]]) {
        const a = c.pt(x, y), b = c.pt(x, y, 22);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      const L = c.pt(0.2, 0.8, 22), B = c.pt(0.8, 0.8, 22), R = c.pt(0.8, 0.2, 22);
      c.poly([L, B, { x: B.x, y: B.y - 30 }, { x: L.x, y: L.y - 30 }], shade('#C8A86A', 0.08), edge('#C8A86A'));
      c.poly([B, R, { x: R.x, y: R.y - 30 }, { x: B.x, y: B.y - 30 }], shade('#C8A86A', -0.1), edge('#C8A86A'));
      pyramidRoof(c, 0.12, 50, 38, C.thatch);
      return c.sprite();
    }
    case 'kiln': {
      const c = new Canvas(1, 1, 120);
      const ctr = c.pt(0.5, 0.5);
      const g = c.g;
      const rx = T * 0.28;
      g.fillStyle = 'rgba(62,58,79,0.22)';
      g.beginPath(); g.ellipse(ctr.x + 3, ctr.y + 6, rx * 1.1, rx * 0.55, 0, 0, Math.PI * 2); g.fill();
      const grad = g.createLinearGradient(ctr.x - rx, 0, ctr.x + rx, 0);
      grad.addColorStop(0, shade(C.mudbrick, 0.15)); grad.addColorStop(1, shade(C.mudbrick, -0.15));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(ctr.x - rx, ctr.y + 4);
      g.quadraticCurveTo(ctr.x - rx * 0.9, ctr.y - 70, ctr.x - 10, ctr.y - 80);
      g.lineTo(ctr.x + 10, ctr.y - 80);
      g.quadraticCurveTo(ctr.x + rx * 0.9, ctr.y - 70, ctr.x + rx, ctr.y + 4);
      g.ellipse(ctr.x, ctr.y + 4, rx, rx / 2, 0, 0, Math.PI, false);
      g.fill();
      g.strokeStyle = edge(C.mudbrick); g.lineWidth = 1.4; g.stroke();
      g.fillStyle = C.redClay; g.fillRect(ctr.x - 10, ctr.y - 84, 20, 6);
      g.fillStyle = '#3A2018';
      g.beginPath(); g.ellipse(ctr.x - 8, ctr.y + 2, 13, 15, 0, Math.PI, 0); g.fill();
      g.fillStyle = C.fire;
      g.beginPath(); g.ellipse(ctr.x - 8, ctr.y + 2, 8, 9, 0, Math.PI, 0); g.fill();
      return c.sprite([{ x: ctr.x - 8, y: ctr.y - 4 }], [{ x: ctr.x, y: ctr.y - 84 }]);
    }
    case 'furnace': {
      const c = new Canvas(1, 1, 130);
      box(c, 0.22, 36, shade(C.redClay, 0.15), {});
      const top = c.pt(0.5, 0.5, 36);
      const g = c.g;
      g.fillStyle = shade(C.redClay, -0.1);
      g.fillRect(top.x - 8, top.y - 52, 16, 52);
      g.strokeStyle = edge(C.redClay); g.strokeRect(top.x - 8, top.y - 52, 16, 52);
      const m = c.pt(0.45, 0.78, 6);
      g.fillStyle = C.fire; g.fillRect(m.x - 7, m.y - 12, 14, 12);
      return c.sprite([{ x: m.x, y: m.y - 6 }], [{ x: top.x, y: top.y - 52 }]);
    }
    case 'shrine': {
      const c = new Canvas(2, 2, 120);
      c.poly([c.pt(0.2, 1.8), c.pt(1.8, 1.8), c.pt(1.8, 0.2), c.pt(0.2, 0.2)], 'rgba(166,124,82,0.35)');
      const stones: [number, number, number][] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        stones.push([1 + Math.cos(a) * 0.72, 1 + Math.sin(a) * 0.72, 30 + ((i * 7) % 3) * 8]);
      }
      stones.push([1, 1, 58]);
      stones.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
      for (const [x, y, hgt] of stones) {
        const p = c.pt(x, y);
        const w = hgt > 50 ? 16 : 10;
        const g = c.g;
        const grad = g.createLinearGradient(p.x - w, 0, p.x + w, 0);
        grad.addColorStop(0, shade(C.stone, 0.15)); grad.addColorStop(1, shade(C.stone, -0.2));
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(p.x - w, p.y);
        g.quadraticCurveTo(p.x - w - 2, p.y - hgt, p.x, p.y - hgt - 4);
        g.quadraticCurveTo(p.x + w + 2, p.y - hgt, p.x + w, p.y);
        g.closePath();
        g.fill();
        g.strokeStyle = edge(C.stone); g.lineWidth = 1.2; g.stroke();
      }
      return c.sprite();
    }
    case 'well': {
      const c = new Canvas(1, 1, 100);
      const ctr = c.pt(0.5, 0.5);
      cylinder(c, ctr.x, ctr.y + 4, T * 0.2, 16, C.stone);
      const g = c.g;
      g.fillStyle = '#2F4F5F';
      g.beginPath(); g.ellipse(ctr.x, ctr.y - 12, T * 0.15, T * 0.075, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = C.timber; g.lineWidth = 4;
      g.beginPath(); g.moveTo(ctr.x - 24, ctr.y - 6); g.lineTo(ctr.x - 24, ctr.y - 50); g.moveTo(ctr.x + 24, ctr.y - 6); g.lineTo(ctr.x + 24, ctr.y - 50); g.moveTo(ctr.x - 28, ctr.y - 48); g.lineTo(ctr.x + 28, ctr.y - 48); g.stroke();
      c.poly([{ x: ctr.x - 34, y: ctr.y - 46 }, { x: ctr.x, y: ctr.y - 70 }, { x: ctr.x + 34, y: ctr.y - 46 }], C.thatch, edge(C.thatch));
      return c.sprite();
    }
    case 'dock': {
      const c = new Canvas(1, 1, 60);
      const g = c.g;
      const z = 8;
      c.poly([c.pt(0.1, 0.9, z), c.pt(0.9, 0.9, z), c.pt(0.9, 0.1, z), c.pt(0.1, 0.1, z)], shade(C.timber, 0.25), edge(C.timber));
      g.strokeStyle = 'rgba(46,32,24,0.4)'; g.lineWidth = 1;
      for (let i = 1; i < 6; i++) { const a = c.pt(0.1 + i * 0.133, 0.9, z), b = c.pt(0.1 + i * 0.133, 0.1, z); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      g.strokeStyle = C.timber; g.lineWidth = 5;
      for (const [x, y] of [[0.1, 0.9], [0.9, 0.9], [0.9, 0.1]]) { const a = c.pt(x, y, -6), b = c.pt(x, y, z + 12); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      // a dugout canoe tied alongside
      const k = c.pt(0.95, 0.55, 2);
      g.fillStyle = shade(C.timber, 0.05);
      g.beginPath(); g.ellipse(k.x + 10, k.y + 8, 30, 8, -0.46, 0, Math.PI * 2); g.fill();
      g.strokeStyle = edge(C.timber); g.lineWidth = 1.2; g.stroke();
      return c.sprite();
    }
    case 'stall': {
      const c = new Canvas(1, 1, 90);
      box(c, 0.25, 14, C.timber, { top: shade(C.timber, 0.2) });
      const g = c.g;
      const pts = [c.pt(0.18, 0.82), c.pt(0.82, 0.82), c.pt(0.82, 0.18)];
      g.strokeStyle = C.timber; g.lineWidth = 3;
      for (const p of pts) { g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x, p.y - 46); g.stroke(); }
      const aw = [c.pt(0.12, 0.88, 46), c.pt(0.88, 0.88, 46), c.pt(0.88, 0.12, 46), c.pt(0.12, 0.12, 46)];
      c.poly(aw, [C.redClay, '#C98B3A', '#8F6A9A'][v], edge(C.redClay));
      for (let i = 0; i < 3; i++) {
        const p = c.pt(0.35 + i * 0.15, 0.6, 14);
        g.fillStyle = shade(C.redClay, (i - 1) * 0.1);
        g.beginPath(); g.ellipse(p.x, p.y - 6, 6, 8, 0, 0, Math.PI * 2); g.fill();
      }
      return c.sprite();
    }
    case 'pen': {
      const c = new Canvas(2, 2, 40);
      const g = c.g;
      c.poly([c.pt(0, 2), c.pt(2, 2), c.pt(2, 0), c.pt(0, 0)], 'rgba(166,124,82,0.45)');
      g.fillStyle = 'rgba(201,165,92,0.8)';
      g.beginPath(); g.ellipse(c.pt(0.5, 0.6).x, c.pt(0.5, 0.6).y, 12, 6, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = shade(C.timber, 0.05); g.lineWidth = 2.5;
      const ring = [c.pt(0, 2), c.pt(2, 2), c.pt(2, 0), c.pt(0, 0)];
      for (let i = 0; i <= 8; i++) for (const [a, b] of [[ring[0], ring[1]], [ring[1], ring[2]], [ring[3], ring[0]], [ring[2], ring[3]]]) {
        const p = { x: a.x + (b.x - a.x) * (i / 8), y: a.y + (b.y - a.y) * (i / 8) };
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x, p.y - 14); g.stroke();
      }
      g.lineWidth = 2;
      for (const [a, b] of [[ring[0], ring[1]], [ring[1], ring[2]], [ring[3], ring[0]], [ring[2], ring[3]]]) {
        for (const h of [6, 11]) { g.beginPath(); g.moveTo(a.x, a.y - h); g.lineTo(b.x, b.y - h); g.stroke(); }
      }
      return c.sprite();
    }
    case 'graveyard': {
      const c = new Canvas(3, 3, 40);
      const g = c.g;
      const ring = [c.pt(0, 3), c.pt(3, 3), c.pt(3, 0), c.pt(0, 0)];
      c.poly(ring, 'rgba(111,138,90,0.35)');
      g.strokeStyle = shade(C.timber, -0.1); g.lineWidth = 2.5;
      const posts: Pt[] = [];
      for (let i = 0; i <= 6; i++) posts.push(c.pt(i * 0.5, 3), c.pt(3, 3 - i * 0.5), c.pt(0, 3 - i * 0.5), c.pt(i * 0.5, 0));
      for (const p of posts) { g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x, p.y - 14); g.stroke(); }
      g.lineWidth = 1.6;
      for (const [a, b] of [[ring[0], ring[1]], [ring[1], ring[2]], [ring[3], ring[0]], [ring[2], ring[3]]]) {
        g.beginPath(); g.moveTo(a.x, a.y - 10); g.lineTo(b.x, b.y - 10); g.stroke();
      }
      return c.sprite();
    }
    case 'hearth': {
      const c = new Canvas(1, 1, 40);
      const ctr = c.pt(0.5, 0.5);
      const g = c.g;
      g.fillStyle = 'rgba(70,50,40,0.5)';
      g.beginPath(); g.ellipse(ctr.x, ctr.y, 36, 18, 0, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const x = ctr.x + Math.cos(a) * 34;
        const y = ctr.y + Math.sin(a) * 17;
        g.fillStyle = shade(C.stone, Math.sin(a) * 0.15);
        g.beginPath(); g.ellipse(x, y - 3, 8, 6, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = edge(C.stone); g.lineWidth = 1; g.stroke();
      }
      g.strokeStyle = C.timber; g.lineWidth = 5;
      g.beginPath(); g.moveTo(ctr.x - 14, ctr.y + 4); g.lineTo(ctr.x + 12, ctr.y - 6); g.moveTo(ctr.x - 12, ctr.y - 6); g.lineTo(ctr.x + 14, ctr.y + 4); g.stroke();
      return c.sprite([{ x: ctr.x, y: ctr.y - 6 }]);
    }
    case 'stone': {
      const c = new Canvas(1, 1, 120);
      const p = c.pt(0.5, 0.5);
      const g = c.g;
      g.fillStyle = 'rgba(62,58,79,0.25)';
      g.beginPath(); g.ellipse(p.x + 6, p.y + 2, 26, 12, 0, 0, Math.PI * 2); g.fill();
      const grad = g.createLinearGradient(p.x - 20, 0, p.x + 20, 0);
      grad.addColorStop(0, shade(C.stone, 0.18)); grad.addColorStop(1, shade(C.stone, -0.22));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(p.x - 20, p.y);
      g.quadraticCurveTo(p.x - 24, p.y - 80, p.x - 2, p.y - 96);
      g.quadraticCurveTo(p.x + 22, p.y - 84, p.x + 18, p.y);
      g.closePath();
      g.fill();
      g.strokeStyle = edge(C.stone); g.lineWidth = 1.4; g.stroke();
      // the spiral, faintly hearth-gold: the player's mark
      g.strokeStyle = 'rgba(255,179,71,0.55)'; g.lineWidth = 2;
      g.beginPath();
      for (let a = 0; a < Math.PI * 5; a += 0.2) {
        const r = 1 + a * 1.4;
        const x = p.x + Math.cos(a) * r * 0.8;
        const y = p.y - 52 + Math.sin(a) * r;
        a ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      g.fillStyle = 'rgba(111,138,90,0.6)';
      g.beginPath(); g.ellipse(p.x - 10, p.y - 18, 7, 4, 0.5, 0, Math.PI * 2); g.fill();
      return c.sprite([{ x: p.x, y: p.y - 52 }]);
    }
    default: {
      const c = new Canvas(1, 1, 60);
      box(c, 0.2, 30, C.mudbrick);
      return c.sprite();
    }
  }
}

/** Whether a kind of building has real art (rather than a placeholder). */
export function hasBuildingArt(kind: BuildingKind) {
  const key = ART_KEY[kind];
  return !!key && realSprite(key, 0) !== undefined;
}

const ERA_ORDER: Era[] = ['bronze', 'iron', 'stone-timber', 'sail-dome', 'steam', 'electric', 'glass'];

/**
 * A building's look: art for the era it was built in, or else the nearest earlier era that has
 * art (so a city doesn't change look until there's art for its new era), or else a placeholder.
 */
export function buildingSprite(kind: BuildingKind, variant: number, winter: boolean, era: Era = 'bronze'): Sprite {
  const key = ART_KEY[kind];
  if (key) {
    for (let e = Math.max(0, ERA_ORDER.indexOf(era)); e >= 0; e--) {
      const k = e === 0 ? key : key.replace('_bronze_', `_${ERA_ORDER[e]}_`);
      const real = realSprite(k, variant, winter ? 'winter' : undefined);
      if (real) return real;
    }
  }
  const ck = `b:${kind}:${variant % 3}`;
  let s = cache.get(ck);
  if (!s) { s = placeholderBuilding(kind, variant); cache.set(ck, s); }
  return s;
}

/** Scaffolding for something being built, by footprint and progress (0..1). */
export function scaffoldSprite(w: number, h: number, progress: number): Sprite {
  const step = Math.min(4, Math.floor(progress * 5));
  const ck = `s:${w}:${h}:${step}`;
  let s = cache.get(ck);
  if (s) return s;
  const c = new Canvas(w, h, 120);
  c.poly([c.pt(0.05, h - 0.05), c.pt(w - 0.05, h - 0.05), c.pt(w - 0.05, 0.05), c.pt(0.05, 0.05)], 'rgba(166,124,82,0.55)');
  const wallH = 8 + step * 9;
  if (step > 0) {
    const L = c.pt(0.15, h - 0.15), B = c.pt(w - 0.15, h - 0.15), R = c.pt(w - 0.15, 0.15);
    c.poly([L, B, { x: B.x, y: B.y - wallH }, { x: L.x, y: L.y - wallH }], 'rgba(201,162,122,0.9)', edge(C.mudbrick));
    c.poly([B, R, { x: R.x, y: R.y - wallH }, { x: B.x, y: B.y - wallH }], 'rgba(176,140,104,0.9)', edge(C.mudbrick));
  }
  const g = c.g;
  g.strokeStyle = shade(C.timber, 0.1); g.lineWidth = 3;
  const poles = [c.pt(0.08, h - 0.08), c.pt(w - 0.08, h - 0.08), c.pt(w - 0.08, 0.08)];
  for (const p of poles) { g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x, p.y - 62); g.stroke(); }
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(poles[0].x, poles[0].y - 44); g.lineTo(poles[1].x, poles[1].y - 44); g.lineTo(poles[2].x, poles[2].y - 44); g.stroke();
  s = c.sprite();
  cache.set(ck, s);
  return s;
}

// ---------------------------------------------------------------------------
// Trees and rocks

const CROWN = [
  ['#A6CF6A', '#B9DB7C'], // spring
  ['#5E8E44', '#6FA052'], // summer
  ['#D2873A', '#C9A04A'], // autumn
  ['', ''], // winter: bare
];

function placeholderTree(type: number, season: number, v: number): Sprite {
  const c = new Canvas(1, 1, 150);
  const p = c.pt(0.5, 0.5);
  const g = c.g;
  const scale = [1, 0.88, 1.1][v];
  g.fillStyle = 'rgba(62,58,79,0.22)';
  g.beginPath(); g.ellipse(p.x + 6, p.y + 2, 30 * scale, 13 * scale, 0, 0, Math.PI * 2); g.fill();
  if (type === 6) { // stump
    g.fillStyle = shade(C.timber, -0.1);
    g.beginPath(); g.ellipse(p.x, p.y - 2, 11 * scale, 5.5 * scale, 0, 0, Math.PI); g.lineTo(p.x - 11 * scale, p.y - 12 * scale); g.ellipse(p.x, p.y - 12 * scale, 11 * scale, 5.5 * scale, 0, Math.PI, 0, true); g.closePath(); g.fill();
    g.fillStyle = season === 3 ? C.snow : '#D8B98A';
    g.beginPath(); g.ellipse(p.x, p.y - 12 * scale, 10 * scale, 5 * scale, 0, 0, Math.PI * 2); g.fill();
    if (season !== 3) { g.strokeStyle = 'rgba(110,79,51,0.6)'; g.lineWidth = 1; g.beginPath(); g.ellipse(p.x, p.y - 12 * scale, 5 * scale, 2.4 * scale, 0, 0, Math.PI * 2); g.stroke(); }
    return c.sprite();
  }
  if (type === 5) { // boulder
    const r = 26 * scale;
    const grad = g.createLinearGradient(p.x - r, 0, p.x + r, 0);
    grad.addColorStop(0, shade(C.stone, 0.15)); grad.addColorStop(1, shade(C.stone, -0.25));
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(p.x - r, p.y); g.quadraticCurveTo(p.x - r, p.y - r * 1.2, p.x, p.y - r * 1.1); g.quadraticCurveTo(p.x + r, p.y - r, p.x + r, p.y); g.closePath(); g.fill();
    g.strokeStyle = edge(C.stone); g.lineWidth = 1.2; g.stroke();
    if (season === 3) { g.fillStyle = C.snow; g.beginPath(); g.ellipse(p.x - 2, p.y - r * 1.02, r * 0.6, r * 0.2, 0, 0, Math.PI * 2); g.fill(); }
    return c.sprite();
  }
  if (type === 2) { // pine
    g.fillStyle = C.timber; g.fillRect(p.x - 4, p.y - 18, 8, 18);
    const green = '#3F6B4A';
    for (let i = 0; i < 3; i++) {
      const y = p.y - 14 - i * 26 * scale;
      const w = (36 - i * 8) * scale;
      c.poly([{ x: p.x - w, y }, { x: p.x, y: y - 44 * scale }, { x: p.x + w, y }], shade(green, 0.1 - i * 0.04), edge(green));
      c.poly([{ x: p.x, y }, { x: p.x, y: y - 44 * scale }, { x: p.x + w, y }], 'rgba(62,58,79,0.18)');
      if (season === 3) c.poly([{ x: p.x - w * 0.45, y: y - 26 * scale }, { x: p.x, y: y - 44 * scale }, { x: p.x + w * 0.45, y: y - 26 * scale }], C.snow);
    }
    return c.sprite();
  }
  if (type === 4) { // bush
    const col = season === 3 ? '#8A7A62' : CROWN[season][v % 2];
    for (const [dx, dy, r] of [[-10, -10, 14], [8, -12, 13], [0, -20, 14]]) {
      g.fillStyle = shade(col, dx < 0 ? 0.08 : -0.08);
      g.beginPath(); g.arc(p.x + dx * scale, p.y + dy * scale, r * scale, 0, Math.PI * 2); g.fill();
    }
    if (season === 3) { g.fillStyle = C.snow; g.beginPath(); g.ellipse(p.x, p.y - 30 * scale, 14, 5, 0, 0, Math.PI * 2); g.fill(); }
    return c.sprite();
  }
  // broadleaf and fruit trees
  g.fillStyle = shade(C.timber, -0.05);
  g.beginPath(); g.moveTo(p.x - 6, p.y); g.lineTo(p.x - 3, p.y - 46 * scale); g.lineTo(p.x + 3, p.y - 46 * scale); g.lineTo(p.x + 6, p.y); g.fill();
  if (season === 3) {
    g.strokeStyle = shade(C.timber, -0.1); g.lineWidth = 2.5;
    for (const [dx, dy] of [[-22, -84], [20, -80], [-8, -96], [10, -92]]) {
      g.beginPath(); g.moveTo(p.x, p.y - 40 * scale); g.lineTo(p.x + dx * scale, p.y + dy * scale); g.stroke();
    }
    g.fillStyle = C.snow;
    for (const [dx, dy] of [[-18, -78], [16, -76], [-6, -92]]) { g.beginPath(); g.ellipse(p.x + dx * scale, p.y + dy * scale, 7, 3, 0, 0, Math.PI * 2); g.fill(); }
    return c.sprite();
  }
  const [c1, c2] = CROWN[season];
  const blobs: [number, number, number][] = [[-16, -62, 24], [16, -64, 22], [0, -84, 26], [-4, -56, 20]];
  for (const [dx, dy, r] of blobs) {
    const grad = g.createRadialGradient(p.x + (dx - 8) * scale, p.y + (dy - 8) * scale, 2, p.x + dx * scale, p.y + dy * scale, r * scale);
    grad.addColorStop(0, shade(v === 1 ? c2 : c1, 0.15));
    grad.addColorStop(1, shade(v === 1 ? c2 : c1, -0.18));
    g.fillStyle = grad;
    g.beginPath(); g.arc(p.x + dx * scale, p.y + dy * scale, r * scale, 0, Math.PI * 2); g.fill();
  }
  if (type === 3) { // fruit tree: blossom in spring, fruit in summer and autumn
    const dot = season === 0 ? '#F4C6D6' : season === 1 ? '#D9483B' : '#E89B3A';
    g.fillStyle = dot;
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      g.beginPath(); g.arc(p.x + Math.cos(a) * 22 * scale, p.y - 68 * scale + Math.sin(a) * 16 * scale, 3, 0, Math.PI * 2); g.fill();
    }
  }
  return c.sprite();
}

/**
 * The kinds of broadleaf tree in the woods, as many as have art: how common each is, and whether
 * it keeps to the water's edge. (Each is painted at its own height against the people.)
 */
const BROADLEAVES: { key: string; weight: number; wet?: boolean }[] = [
  { key: 'nat_broadleaf_any_1x1', weight: 6 },
  { key: 'nat_oak_any_1x1', weight: 3 },
  { key: 'nat_birch_any_1x1', weight: 2 },
  { key: 'nat_hazel_any_1x1', weight: 1 },
  { key: 'nat_young-tree_any_1x1', weight: 1 },
  { key: 'nat_old-tree_any_1x1', weight: 0.4 },
  { key: 'nat_snag_any_1x1', weight: 0.3 },
  { key: 'nat_willow_any_1x1', weight: 5, wet: true },
  { key: 'nat_alder_any_1x1', weight: 4, wet: true },
];

/** Which kind of broadleaf tree stands here (by its number, and whether it's by the water). */
export function broadleafKind(h: number, wet: boolean): string {
  const kinds = BROADLEAVES.filter((k) => (!k.wet || wet) && variantsOf(k.key).length);
  if (kinds.length <= 1) return TREE_KEY[1];
  const total = kinds.reduce((t, k) => t + k.weight, 0);
  let r = ((h >>> 11) % 1000) / 1000 * total;
  for (const k of kinds) { r -= k.weight; if (r < 0) return k.key; }
  return kinds[0].key;
}

export function treeSprite(type: number, season: number, variant: number, kind?: string): Sprite {
  const key = kind ?? TREE_KEY[type];
  const state = ['spring', undefined, 'autumn', 'winter'][season];
  const real = key ? realSprite(key, variant, state) : undefined;
  if (real) return real;
  const ck = `t:${type}:${season}:${variant % 3}`;
  let s = cache.get(ck);
  if (!s) { s = placeholderTree(type, season, variant % 3); cache.set(ck, s); }
  return s;
}

export function graveSprite(variant: number): Sprite {
  const ck = `g:${variant % 3}`;
  let s = cache.get(ck);
  if (s) return s;
  const c = new Canvas(1, 1, 40);
  const p = c.pt(0.5, 0.5);
  const g = c.g;
  // A low mound of earth, grassing over, and a small weathered stone at its head (rounded on top,
  // lit from above, a little dark lichen), knee high to a grown-up.
  g.fillStyle = mix(C.dirt, C.summerGrass, 0.45);
  g.beginPath(); g.ellipse(p.x + 2, p.y - 1, 13, 5.5, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath(); g.ellipse(p.x + 1, p.y - 2.5, 9, 3, 0, 0, Math.PI * 2); g.fill();
  const w = [7, 6, 8][variant % 3], h = [10, 9, 12][variant % 3];
  const x = p.x - 9 - w / 2, top = p.y - 6 - h;
  const stone = shade(C.stone, -0.18);
  g.fillStyle = 'rgba(40,34,30,0.3)';
  g.beginPath(); g.ellipse(x + w / 2 + 1, p.y - 5.5, w * 0.75, 1.8, 0, 0, Math.PI * 2); g.fill();
  g.beginPath();
  g.moveTo(x, p.y - 5);
  g.lineTo(x, top + w / 2);
  g.arc(x + w / 2, top + w / 2, w / 2, Math.PI, 0);
  g.lineTo(x + w, p.y - 5);
  g.closePath();
  const grad = g.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, shade(stone, 0.12));
  grad.addColorStop(1, shade(stone, -0.12));
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = edge(stone); g.lineWidth = 0.8; g.stroke();
  g.fillStyle = 'rgba(88,104,70,0.45)';
  g.beginPath(); g.ellipse(x + w * 0.35, p.y - 6.5, w * 0.3, 1.6, 0, 0, Math.PI * 2); g.fill();
  s = c.sprite();
  cache.set(ck, s);
  return s;
}
