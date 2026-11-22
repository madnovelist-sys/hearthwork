// The isometric view: a miniature diorama of the settlement. Terrain is drawn
// as batched diamonds; everything standing on it is a depth-sorted sprite.
import { TERRAIN, TREE, type Building, type GameState } from '../sim/types';
import { seasonIndex, seasonProgress } from '../sim/world';
import { hashString } from '../sim/rng';
import { C, GRASS_BY_SEASON, mix, shade } from './palette';
import { costumeOf, drawFigure, rolesOf, sizeFor } from './figures';
import { buildingSprite, graveSprite, hasBuildingArt, onArtChange, realSprite, scaffoldSprite, treeSprite, type Sprite } from './sprites';
import { Walkers } from './walkers';
import { fieldsAsleep, indoorShare, snowOnGround } from '../sim/weather';
import { Fauna, drawAnimal, drawBirds } from './fauna';
import { groundReady, surface, type Surface } from './ground';
import { DECOR_KEY, Decor } from './decor';
import type { Selection } from '../game/store';

const BASE_TW = 64; // tile width in CSS px at zoom 1
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

interface Puff { x: number; y: number; z: number; age: number; life: number; drift: number; size: number }
interface Flake { x: number; y: number; speed: number; sway: number }

type Drawable =
  | { depth: number; kind: 'sprite'; sprite: Sprite; gx: number; gy: number; b?: Building; alpha?: number; fit?: number; flip?: boolean }
  | { depth: number; kind: 'wall'; x: number; y: number }
  | { depth: number; kind: 'deck'; x: number; y: number; alongX: boolean }
  | { depth: number; kind: 'walker'; id: number }
  | { depth: number; kind: 'animal'; key: string };

const BARLEY = 'nat_barley_any_2x2';

/** The kinds of ground, and which is painted over which where they meet (higher over lower). */
const KIND_OF: Record<number, string> = {
  [TERRAIN.GRASS]: 'grass', [TERRAIN.SAND]: 'sand', [TERRAIN.ROCK]: 'rock', [TERRAIN.WATER]: 'shallow',
  [TERRAIN.DEEP]: 'deep', [TERRAIN.MARSH]: 'marsh', [TERRAIN.PLAZA]: 'plaza', [TERRAIN.BRIDGE]: 'shallow',
};
const RANK: Record<string, number> = { grass: 0, plaza: 0, marsh: 1, rock: 2, sand: 3, shallow: 4, deep: 5 };
/** Each corner of a tile: its two side neighbours and the one across, as (dx, dy) pairs. */
const CORNERS: [number, number, number, number, number, number][] = [
  [-1, 0, 0, -1, -1, -1], [1, 0, 0, -1, 1, -1], [1, 0, 0, 1, 1, 1], [-1, 0, 0, 1, -1, 1],
];
const kindAt = (map: GameState['map'], x: number, y: number) =>
  x < 0 || y < 0 || x >= map.w || y >= map.h ? undefined : KIND_OF[map.terrain[y * map.w + x]];

/**
 * How a barley field looks today: sprouting in spring, green then ripening in summer, cut one
 * field at a time through the autumn, and lying fallow (under snow, when there is some) in winter.
 */
function barleyState(s: GameState, b: Building, snowy: boolean): string {
  const season = seasonIndex(s.day);
  const p = seasonProgress(s.day);
  if (snowy) return 'winter-fallow';
  if (season === 3) return 'harvested';
  if (season === 0) return p < 0.45 ? 'sprouts' : 'growing';
  if (season === 1) return p < 0.55 ? 'growing' : 'ripe';
  const cut = 0.15 + (hashString(`field${b.id}`) % 100) / 100 * 0.5; // each field is cut on its own day
  return p < cut ? 'ripe' : 'harvested';
}

export class Renderer {
  /** The context drawn to: the canvas, or briefly the cached ground while it's being repainted. */
  g: CanvasRenderingContext2D;
  dpr = 1;
  w = 0;
  h = 0;
  cam = { x: 32, y: 32, zoom: 0.9 };
  /** 0 = full day, 1 = full night. The city is dark while you're not working. */
  night = 1;
  walkers = new Walkers();
  fauna = new Fauna();
  decor = new Decor();
  private puffs: Puff[] = [];
  /** The map width last drawn, to follow the map when it widens. */
  private mapW = 0;
  private flakes: Flake[] = [];
  private last = 0;
  private lastSmoke = 0;
  private hoverPerson: number | null = null;
  private drawn: Drawable[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
    this.resize();
    onArtChange(() => { this.groundKey = ''; });
  }

  /** Resting, after dark: the hearth is banked to embers. */
  private banked = false;

  /** The textured ground, painted once and reused until the view moves or a day passes. */
  private groundCache: HTMLCanvasElement | null = null;
  private groundKey = '';

  get tw() { return BASE_TW * this.cam.zoom; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  centerOn(x: number, y: number) { this.cam.x = x; this.cam.y = y; }

  toScreen(gx: number, gy: number) {
    const tw = this.tw;
    return {
      x: this.w / 2 + ((gx - this.cam.x) - (gy - this.cam.y)) * (tw / 2),
      y: this.h / 2 + ((gx - this.cam.x) + (gy - this.cam.y)) * (tw / 4),
    };
  }

  toGrid(sx: number, sy: number) {
    const tw = this.tw;
    const a = (sx - this.w / 2) / (tw / 2);
    const b = (sy - this.h / 2) / (tw / 4);
    return { x: (a + b) / 2 + this.cam.x, y: (b - a) / 2 + this.cam.y };
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.toGrid(sx, sy);
    this.cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.cam.zoom * factor));
    const after = this.toGrid(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
  }

  pan(dx: number, dy: number) {
    const tw = this.tw;
    const a = -dx / (tw / 2);
    const b = -dy / (tw / 4);
    this.cam.x += (a + b) / 2;
    this.cam.y += (b - a) / 2;
  }

  // -------------------------------------------------------------------------

  /** When the city was paused: while you rest, time stands still and nothing moves. */
  private frozenAt: number | null = null;

  /** skyNight: how dark the sky is (0 day … 1 night), from the time of day. */
  frame(s: GameState, now: number, running: boolean, selection: Selection, skyNight = 0) {
    // Clamp: timestamps can jump (sleep, wake, a reset clock); never run time backwards.
    const gap = this.last ? now - this.last : 0;
    const realDt = this.last ? Math.max(0, Math.min(250, gap)) : 16;
    this.last = now;
    // The window was hidden (no frames drawn, so nobody moved): the city carried on without us.
    if (running && gap > 3000) {
      this.walkers.scatter(s, now, this.night);
      this.fauna.catchUp(s, this.walkers, now, this.night, this.w, this.h, (sx, sy) => this.toGrid(sx, sy));
    }
    if (this.mapW && s.map.w !== this.mapW) {
      // The map widened around the old one: everything moved by the same amount.
      const d = (s.map.w - this.mapW) / 2;
      this.cam.x += d; this.cam.y += d;
      this.walkers = new Walkers();
      this.fauna = new Fauna();
      this.decor = new Decor();
      this.puffs = [];
    }
    this.mapW = s.map.w;
    if (running) this.frozenAt = null;
    else this.frozenAt ??= now;
    const dt = running ? realDt : 0;
    const anim = this.frozenAt ?? now; // animation time stops while paused
    this.night += (skyNight - this.night) * Math.min(1, realDt / 900);
    if (Math.abs(this.night - skyNight) < 0.002) this.night = skyNight;
    this.banked = !running && this.night >= 0.9;
    this.walkers.indoor = indoorShare(s);
    this.walkers.fieldsAsleep = fieldsAsleep(s);
    this.walkers.frozen = !!s.weather?.ice;
    if (running) {
      this.walkers.update(s, now, dt, this.night);
      this.fauna.update(s, this.walkers, now, dt, this.night, this.w, this.h, (sx, sy) => this.toGrid(sx, sy));
    }
    now = anim;

    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const bg = g.createLinearGradient(0, 0, 0, this.h);
    bg.addColorStop(0, '#3E4A3B');
    bg.addColorStop(1, '#262E28');
    g.fillStyle = bg;
    g.fillRect(0, 0, this.w, this.h);

    const season = seasonIndex(s.day);
    // Seasons fade in over their first week or so (the very first spring starts green).
    const blend = s.day < 90 ? 1 : Math.min(1, seasonProgress(s.day) / 0.09);
    // Snow covers the ground when it has actually snowed (and not otherwise); trees follow the season.
    const snowy = snowOnGround(s);
    const cover = Math.min(1, (s.weather?.snow ?? (season === 3 ? 2 : 0)) / 2);
    const bare = mix(GRASS_BY_SEASON[(season + 3) % 4], GRASS_BY_SEASON[season], Math.round(blend * 8) / 8);
    const grass = snowy ? mix(bare, C.snow, Math.round((0.55 + cover * 0.45) * 8) / 8) : bare;
    const winter = snowy;
    const treeSeason = blend < 0.5 && s.day >= 90 ? (season + 3) % 4 : season;

    this.drawBase(s, grass);
    const textured = groundReady(g);
    if (textured) this.drawGroundCached(s, season, blend, snowy ? 0.55 + cover * 0.45 : 0, now);
    else this.drawTerrain(s, grass, winter, now);
    this.drawFields(s, season, blend, textured);
    this.collect(s, treeSeason, winter, selection);
    this.drawObjects(s, now, selection);
    this.drawHearthFire(s, now, running);
    this.updateSmoke(s, now, dt, running);
    drawBirds(this.g, this.fauna.birds, now, (gx, gy) => this.toScreen(gx, gy), this.tw / BASE_TW);
    this.drawLighting(s, now);
    this.drawWeather(s, dt, anim);
    this.drawMood(s);
    // While you rest, time stands still and the colors soften (drawn here rather than with a
    // CSS filter on the canvas, which some web views draw badly).
    this.still += ((running ? 0 : 1) - this.still) * Math.min(1, realDt / 600);
    if (this.still > 0.01) {
      g.globalCompositeOperation = 'saturation';
      g.fillStyle = `rgba(128,128,128,${(0.45 * this.still).toFixed(3)})`;
      g.fillRect(0, 0, this.w, this.h);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = `rgba(255,236,210,${(0.35 * this.still).toFixed(3)})`;
      g.fillRect(0, 0, this.w, this.h);
      g.globalCompositeOperation = 'source-over';
    }
  }

  /** 0 while time runs, easing to 1 while it stands still. */
  private still = 0;

  /** Side ages color the whole world a little: sickly after plague, grey after fire, strange in an age of omens. */
  private drawMood(s: GameState) {
    if (!s.age.side) return;
    const last = s.ages[s.ages.length - 1];
    const tint: Record<string, string> = { plague: 'rgba(150,170,110,0.16)', ash: 'rgba(120,115,110,0.2)', omens: 'rgba(130,100,190,0.12)', comet: 'rgba(110,200,180,0.1)', alchemy: 'rgba(200,160,60,0.1)' };
    const c = tint[last?.side ?? ''];
    if (!c) return;
    const g = this.g;
    g.globalCompositeOperation = 'color';
    g.fillStyle = c;
    g.fillRect(0, 0, this.w, this.h);
    g.globalCompositeOperation = 'source-over';
  }

  /** The diorama's earthen sides along the front edges of the map. */
  private drawBase(s: GameState, grass: string) {
    const g = this.g;
    const { w, h } = s.map;
    const depth = this.tw * 0.55;
    const left = this.toScreen(0, h);
    const bottom = this.toScreen(w, h);
    const right = this.toScreen(w, 0);
    const layer = (a: { x: number; y: number }, b: { x: number; y: number }, color: string, top: number, bottom2: number) => {
      g.beginPath();
      g.moveTo(a.x, a.y + top); g.lineTo(b.x, b.y + top); g.lineTo(b.x, b.y + bottom2); g.lineTo(a.x, a.y + bottom2);
      g.closePath(); g.fillStyle = color; g.fill();
    };
    layer(left, bottom, shade(grass, -0.2), 0, depth * 0.12);
    layer(left, bottom, shade(C.soil, 0.05), depth * 0.12, depth * 0.6);
    layer(left, bottom, shade(C.soil, -0.25), depth * 0.6, depth);
    layer(bottom, right, shade(grass, -0.32), 0, depth * 0.12);
    layer(bottom, right, shade(C.soil, -0.15), depth * 0.12, depth * 0.6);
    layer(bottom, right, shade(C.soil, -0.4), depth * 0.6, depth);
  }

  private visibleRange(s: GameState) {
    const pts = [this.toGrid(0, 0), this.toGrid(this.w, 0), this.toGrid(0, this.h), this.toGrid(this.w, this.h + this.tw * 2)];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      x0: Math.max(0, Math.floor(Math.min(...xs)) - 2),
      x1: Math.min(s.map.w - 1, Math.ceil(Math.max(...xs)) + 2),
      y0: Math.max(0, Math.floor(Math.min(...ys)) - 2),
      y1: Math.min(s.map.h - 1, Math.ceil(Math.max(...ys)) + 2),
    };
  }

  private drawTerrain(s: GameState, grass: string, winter: boolean, now: number) {
    const g = this.g;
    const { map } = s;
    const tw = this.tw;
    const hw = tw / 2 + 0.6;
    const hh = tw / 4 + 0.4;
    const buckets = new Map<string, Path2D>();
    const r = this.visibleRange(s);
    const sand = winter ? mix(C.sand, C.snow, 0.6) : C.sand;
    const rock = winter ? mix(C.stone, C.snow, 0.5) : C.stone;
    const marsh = winter ? mix(C.marsh, C.snow, 0.5) : C.marsh;
    const shallow = winter ? mix(C.shallow, '#DCEAF0', 0.35) : C.shallow;
    const trail = winter ? mix(C.dirt, C.snow, 0.45) : C.dirt;
    const plaza = mix(C.stone, C.sand, 0.45);
    const ice = !!s.weather?.ice;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const i = y * map.w + x;
        const t = map.terrain[i];
        const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        const vary = ((n % 3) - 1) * 0.035;
        let col: string;
        if (ice && (t === TERRAIN.DEEP || t === TERRAIN.WATER || t === TERRAIN.BRIDGE)) col = t === TERRAIN.DEEP ? '#BFD3DE' : '#D6E4EC';
        else if (t === TERRAIN.DEEP) col = C.deep;
        else if (t === TERRAIN.WATER || t === TERRAIN.BRIDGE) col = shallow;
        else if (t === TERRAIN.PLAZA) col = shade(winter ? mix(plaza, C.snow, 0.4) : plaza, ((n >> 3) % 3 - 1) * 0.05);
        else if (t === TERRAIN.SAND) col = shade(sand, vary);
        else if (t === TERRAIN.ROCK) col = shade(rock, vary);
        else if (t === TERRAIN.MARSH) col = shade(marsh, vary);
        else {
          const fert = map.fertility[i] > 0.6 && !winter ? -0.04 : 0; // richer soil, deeper green
          col = shade(grass, vary + fert);
        }
        const wear = map.wear[i];
        if (wear > 0.7 && t !== TERRAIN.WATER && t !== TERRAIN.DEEP && t !== TERRAIN.PLAZA && t !== TERRAIN.BRIDGE) col = mix(col, trail, Math.min(4, Math.round(wear))/ 4.6);
        const c = this.toScreen(x + 0.5, y + 0.5);
        if (c.x < -tw || c.x > this.w + tw || c.y < -tw || c.y > this.h + tw) continue;
        let p = buckets.get(col);
        if (!p) { p = new Path2D(); buckets.set(col, p); }
        p.moveTo(c.x, c.y - hh); p.lineTo(c.x + hw, c.y); p.lineTo(c.x, c.y + hh); p.lineTo(c.x - hw, c.y); p.closePath();
      }
    }
    for (const [col, p] of buckets) { g.fillStyle = col; g.fill(p); }

    // Glints on the water and tufts in the grass, when close enough to see them.
    if (tw >= 56) {
      g.lineWidth = Math.max(1, tw / 48);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      const phase = now / 1400;
      for (let y = r.y0; y <= r.y1; y++) {
        for (let x = r.x0; x <= r.x1; x++) {
          const i = y * map.w + x;
          const t = map.terrain[i];
          const n = ((x * 2654435761) ^ (y * 40503)) >>> 0;
          const c = this.toScreen(x + 0.5, y + 0.5);
          if ((t === TERRAIN.WATER || t === TERRAIN.DEEP) && n % 5 === 0 && !winter) {
            const k = Math.sin(phase + (n % 100)) * 0.5 + 0.5;
            if (k > 0.55) { g.moveTo(c.x - tw * 0.12, c.y + tw * 0.03 * k); g.lineTo(c.x + tw * 0.1, c.y + tw * 0.03 * k); }
          }
        }
      }
      g.stroke();
      if (!winter) {
        g.strokeStyle = shade(grass, -0.22);
        g.lineWidth = Math.max(1, tw / 64);
        g.beginPath();
        for (let y = r.y0; y <= r.y1; y++) {
          for (let x = r.x0; x <= r.x1; x++) {
            const i = y * map.w + x;
            if (map.terrain[i] !== TERRAIN.GRASS || map.occ[i] || map.wear[i] > 1) continue;
            const n = ((x * 2246822519) ^ (y * 3266489917)) >>> 0;
            if (n % 4) continue;
            const c = this.toScreen(x + ((n >> 4) % 70) / 100 + 0.15, y + ((n >> 12) % 70) / 100 + 0.15);
            const l = tw * 0.06;
            g.moveTo(c.x, c.y); g.lineTo(c.x - l * 0.4, c.y - l);
            g.moveTo(c.x, c.y); g.lineTo(c.x + l * 0.3, c.y - l * 1.1);
          }
        }
        g.stroke();
      }
    }
  }

  /** Where the map's origin was on screen when the cached ground was painted. */
  private groundAt = { x: 0, y: 0 };

  /**
   * The textured ground is painted with a margin around the view, then reused: a pan only slides
   * it along, until the view runs past the margin; a zoom, a new day or new weather repaints it.
   */
  private drawGroundCached(s: GameState, season: number, blend: number, snow: number, now: number) {
    const M = Math.round(Math.max(this.w, this.h) * 0.25);
    const W = Math.round((this.w + 2 * M) * this.dpr), H = Math.round((this.h + 2 * M) * this.dpr);
    let c = this.groundCache;
    if (!c || c.width !== W || c.height !== H) {
      c = document.createElement('canvas');
      c.width = W; c.height = H;
      this.groundCache = c;
      this.groundKey = '';
    }
    const key = [this.cam.zoom, this.w, this.h, this.dpr, s.seed, s.day, s.map.w, !!s.weather?.ice, snow, season, blend].join(',');
    const o = this.toScreen(0, 0);
    let dx = o.x - this.groundAt.x, dy = o.y - this.groundAt.y;
    if (key !== this.groundKey || Math.abs(dx) > M || Math.abs(dy) > M) {
      const main = this.g;
      const off = c.getContext('2d')!;
      off.setTransform(1, 0, 0, 1, 0, 0);
      off.clearRect(0, 0, W, H);
      off.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      off.imageSmoothingEnabled = true;
      off.imageSmoothingQuality = 'high';
      // Paint a view M bigger on every side (the camera stays at its centre).
      const w = this.w, h = this.h;
      this.g = off; this.w = w + 2 * M; this.h = h + 2 * M;
      try { this.drawTexturedGround(s, season, blend, snow); } finally { this.g = main; this.w = w; this.h = h; }
      this.groundKey = key;
      this.groundAt = o;
      dx = 0; dy = 0;
    }
    // Only the part that's on screen.
    const d = this.dpr;
    this.g.drawImage(c, (M - dx) * d, (M - dy) * d, this.w * d, this.h * d, 0, 0, this.w, this.h);
    this.drawGlints(s, this.visibleRange(s), now, snow > 0 || !!s.weather?.ice);
  }

  /**
   * The ground, from the art's textures: each kind of ground is gathered into one shape and
   * filled with its texture, then the seasons, worn paths and snow are laid over it.
   */
  private drawTexturedGround(s: GameState, season: number, blend: number, snow: number) {
    const g = this.g;
    const { map } = s;
    const tw = this.tw;
    const hw = tw / 2 + 0.6;
    const hh = tw / 4 + 0.4;
    const r = this.visibleRange(s);
    const ice = !!s.weather?.ice;
    const shapes = new Map<string, Path2D>();
    const add = (key: string, cx: number, cy: number) => {
      let p = shapes.get(key);
      if (!p) { p = new Path2D(); shapes.set(key, p); }
      p.moveTo(cx, cy - hh); p.lineTo(cx + hw, cy); p.lineTo(cx, cy + hh); p.lineTo(cx - hw, cy); p.closePath();
    };
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const c = this.toScreen(x + 0.5, y + 0.5);
        if (c.x < -tw || c.x > this.w + tw || c.y < -tw || c.y > this.h + tw) continue;
        const i = y * map.w + x;
        const t = map.terrain[i];
        const wet = t === TERRAIN.WATER || t === TERRAIN.DEEP || t === TERRAIN.BRIDGE;
        const own = KIND_OF[t] ?? 'grass';
        add(own, c.x, c.y);
        // Smooth the staircase where two kinds of ground meet: a corner closed in on both sides
        // (and across) by a kind painted over this one is filled with it, along the tile's diagonal.
        if (!map.occ[i] || wet) {
          const rank = RANK[own];
          for (const [ax, ay, bx, by, cx, cy] of CORNERS) {
            const k1 = kindAt(map, x + ax, y + ay), k2 = kindAt(map, x + bx, y + by), k3 = kindAt(map, x + cx, y + cy);
            if (k1 && k1 === k2 && k1 === k3 && RANK[k1] > rank) this.cornerPatch(shapes, `edge:${k1}`, x, y, ax + bx, ay + by);
          }
        }
        if (wet) continue;
        if (t === TERRAIN.GRASS && map.fertility[i] > 0.6) add('rich', c.x, c.y);
        const wear = map.wear[i];
        const worn = wear > 0.7 && t !== TERRAIN.PLAZA ? Math.min(4, Math.round(wear)) : 0;
        if (worn) add(`worn${worn}`, c.x, c.y);
        if (snow) add(t === TERRAIN.PLAZA ? 'snowPlaza' : worn >= 2 ? 'snowWorn' : 'snow', c.x, c.y);
      }
    }
    const ox = this.toScreen(0, 0);
    const fill = (key: string, name: Surface, alpha = 1) => {
      const p = shapes.get(key);
      if (!p || alpha <= 0) return;
      const pat = surface(g, name, tw, this.dpr, ox.x, ox.y);
      if (!pat) return;
      g.globalAlpha = alpha;
      g.fillStyle = pat;
      g.fill(p);
      g.globalAlpha = 1;
    };
    // The seasons' grasses, the new one fading in over the old for its first week or so.
    const GRASS: Surface[] = ['grass_spring', 'grass_summer', 'grass_autumn', 'grass_winter'];
    if (blend < 1) fill('grass', GRASS[(season + 3) % 4]);
    fill('grass', GRASS[season], blend < 1 ? blend : 1);
    const rich = shapes.get('rich');
    if (rich && season !== 3) { g.fillStyle = 'rgba(40,70,25,0.08)'; g.fill(rich); }
    fill('sand', 'sand');
    fill('rock', 'rock');
    fill('marsh', 'marsh');
    fill('plaza', 'plaza');
    fill('shallow', ice ? 'ice_shallow' : 'water_shallow');
    fill('deep', ice ? 'ice_deep' : 'water_deep');
    // Paths worn into the ground, deeper the more they're walked.
    // Land smoothing into land goes under the paths and the snow; water into land goes over them.
    fill('edge:sand', 'sand'); fill('edge:rock', 'rock'); fill('edge:marsh', 'marsh');
    for (let k = 1; k <= 4; k++) fill(`worn${k}`, 'dirt', k / 4.6);
    // Snow lies over everything but the water; trodden paths show through it.
    if (snow) {
      fill('snow', 'grass_snow', snow);
      fill('snowWorn', 'grass_snow', snow * 0.55);
      fill('snowPlaza', 'grass_snow', 0.4);
    }
    fill('edge:shallow', ice ? 'ice_shallow' : 'water_shallow');
    fill('edge:deep', ice ? 'ice_deep' : 'water_deep');
  }

  /** Half a tile, cut along its diagonal: the half nearest the corner at (x + cx/2 + 0.5, y + cy/2 + 0.5). */
  private cornerPatch(shapes: Map<string, Path2D>, key: string, x: number, y: number, cx: number, cy: number) {
    // The corner and its two neighbouring corners, in grid space; cx, cy are each -1 or +1.
    const kx = x + (cx > 0 ? 1 : 0), ky = y + (cy > 0 ? 1 : 0);
    // (The tiles beside it are drawn a hair oversize, which hides any seam along its two sides.)
    const a = this.toScreen(kx, ky), b = this.toScreen(kx - cx, ky), c = this.toScreen(kx, ky - cy);
    let p = shapes.get(key);
    if (!p) { p = new Path2D(); shapes.set(key, p); }
    p.moveTo(a.x, a.y); p.lineTo(b.x, b.y); p.lineTo(c.x, c.y); p.closePath();
  }

  /** Light catching the moving water, when close enough to see it. */
  private drawGlints(s: GameState, r: { x0: number; x1: number; y0: number; y1: number }, now: number, still: boolean) {
    const tw = this.tw;
    if (tw < 56 || still) return;
    const g = this.g;
    const { map } = s;
    g.lineWidth = Math.max(1, tw / 48);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    const phase = now / 1400;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const t = map.terrain[y * map.w + x];
        if (t !== TERRAIN.WATER && t !== TERRAIN.DEEP) continue;
        const n = ((x * 2654435761) ^ (y * 40503)) >>> 0;
        if (n % 5) continue;
        const c = this.toScreen(x + 0.5, y + 0.5);
        const k = Math.sin(phase + (n % 100)) * 0.5 + 0.5;
        if (k > 0.55) { g.moveTo(c.x - tw * 0.12, c.y + tw * 0.03 * k); g.lineTo(c.x + tw * 0.1, c.y + tw * 0.03 * k); }
      }
    }
    g.stroke();
  }

  private drawFields(s: GameState, season: number, blend: number, textured: boolean) {
    const g = this.g;
    const crop = ['#8DBE5A', '#B7B24A', '#D9B24A', ''][season];
    const snowy = snowOnGround(s);
    const art = !!realSprite(BARLEY, 0, 'ripe');
    const ox = this.toScreen(0, 0);
    for (const b of s.buildings) {
      if (b.kind !== 'field' || b.removed) continue;
      if (art && b.built) continue; // the barley art stands among the other sprites
      const pts = [this.toScreen(b.x, b.y), this.toScreen(b.x + b.w, b.y), this.toScreen(b.x + b.w, b.y + b.h), this.toScreen(b.x, b.y + b.h)];
      if (pts.every((p) => p.x < -200 || p.x > this.w + 200 || p.y < -200 || p.y > this.h + 200)) continue;
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
      const soil = textured ? surface(g, 'soil_plowed', this.tw, this.dpr, ox.x, ox.y) : null;
      if (soil) {
        // Turned earth (half dug, while the field is still being made), under any snow.
        g.globalAlpha = b.built ? 1 : 0.6; g.fillStyle = soil; g.fill();
        const snowTex = snowy ? surface(g, 'grass_snow', this.tw, this.dpr, ox.x, ox.y) : null;
        if (snowTex) { g.globalAlpha = 0.55; g.fillStyle = snowTex; g.fill(); }
        g.globalAlpha = 1;
      } else {
        g.fillStyle = snowy ? mix(C.soil, C.snow, 0.55) : b.built ? C.soil : mix(C.soil, C.summerGrass, 0.4);
        g.fill();
      }
      g.strokeStyle = shade(C.timber, -0.1); g.lineWidth = Math.max(1, this.tw / 40); g.stroke();
      if (!b.built || season === 3) continue;
      // Crop rows (an early or late snow leaves only pale stubble showing through)
      const rows = 6;
      const height = snowy ? 0.02 : season === 0 ? 0.05 : season === 1 ? 0.12 : season === 2 && blend < 0.7 ? 0.14 : 0.04;
      g.strokeStyle = snowy ? mix(crop, C.snow, 0.6) : crop;
      g.lineWidth = Math.max(1.2, this.tw * (season === 0 || snowy ? 0.04 : 0.08));
      g.lineCap = 'round';
      g.beginPath();
      for (let i = 0; i < rows; i++) {
        const t = (i + 0.5) / rows;
        const a = this.toScreen(b.x + 0.12, b.y + t * b.h);
        const c = this.toScreen(b.x + b.w - 0.12, b.y + t * b.h);
        g.moveTo(a.x, a.y - this.tw * height * 0.5);
        g.lineTo(c.x, c.y - this.tw * height * 0.5);
      }
      g.stroke();
      g.lineCap = 'butt';
    }
  }

  private collect(s: GameState, season: number, winter: boolean, _selection: Selection) {
    const list: Drawable[] = [];
    const r = this.visibleRange(s);
    const { map } = s;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const i = y * map.w + x;
        const t = map.trees[i];
        if (t === TREE.NONE) continue;
        const v = hashString(`${x},${y}`) % 3;
        // Saplings are drawn small and grow over the years.
        const g = map.growth?.[i] ?? 1;
        const fit = t !== TREE.STUMP && g < 1 ? 0.3 + 0.7 * g : undefined;
        list.push({ depth: x + y + 2, kind: 'sprite', sprite: treeSprite(t, winter ? 3 : season, v), gx: x + 1, gy: y + 1, fit });
      }
    }
    // Low plants, rocks and logs: the day's scenery.
    this.decor.update(s);
    for (const d of this.decor.items) {
      if (d.x < r.x0 || d.x > r.x1 || d.y < r.y0 || d.y > r.y1) continue;
      const sprite = realSprite(DECOR_KEY[d.kind], d.variant, ['spring', undefined, 'autumn', 'winter'][winter ? 3 : season]);
      if (!sprite) continue;
      const gx = d.x + 1 + d.dx, gy = d.y + 1 + d.dy;
      list.push({ depth: gx + gy, kind: 'sprite', sprite, gx, gy, flip: d.flip });
    }
    const snowy = snowOnGround(s);
    for (const b of s.buildings) {
      if (b.removed) continue;
      if (b.kind === 'field') {
        // Barley, at whatever stage the year has it (fields being dug are drawn with the ground).
        const sprite = b.built ? realSprite(BARLEY, 0, barleyState(s, b, snowy)) : undefined;
        if (sprite && b.x + b.w >= r.x0 && b.x <= r.x1 + 1 && b.y + b.h >= r.y0 && b.y <= r.y1 + 1) {
          list.push({ depth: b.x + b.y + 0.5, kind: 'sprite', sprite, gx: b.x + b.w, gy: b.y + b.h, b });
        }
        continue;
      }
      if (b.x + b.w < r.x0 || b.x > r.x1 + 1 || b.y + b.h < r.y0 || b.y > r.y1 + 1) continue;
      if (b.kind === 'bridge' && b.built) {
        // A deck of planks over the water, a tile at a time.
        for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) list.push({ depth: x + y + 1, kind: 'deck', x, y, alongX: b.w > 1 });
        continue;
      }
      // The hearth is banked to embers while the village sleeps (resting, after dark).
      const banked = b.kind === 'hearth' && b.built && this.banked ? realSprite('lmk_hearth_bronze_1x1', b.variant, 'embers') : undefined;
      const sprite = banked ?? (b.built ? buildingSprite(b.kind, b.variant, winter, b.era) : scaffoldSprite(b.w, b.h, b.progress / Math.max(1, b.required)));
      const depth = b.kind === 'graveyard' || b.kind === 'pen' ? b.x + b.y + 0.5 : b.x + b.w + b.y + b.h; // low enclosures sit under what's inside them
      // Art made for a different footprint (e.g. a 2×2 granary in an older city's 1×1 spot) is scaled to fit.
      const fit = sprite.tiles && sprite.tiles !== b.w ? b.w / sprite.tiles : undefined;
      list.push({ depth, kind: 'sprite', sprite, gx: b.x + b.w, gy: b.y + b.h, b, fit });
    }
    // The town wall, where it's been built so far.
    const wl = map.walls;
    if (wl && s.walls) {
      for (let y = r.y0; y <= r.y1; y++) {
        for (let x = r.x0; x <= r.x1; x++) {
          const i = y * map.w + x;
          if (!wl[i] || map.occ[i] || map.terrain[i] === TERRAIN.WATER || map.terrain[i] === TERRAIN.DEEP || map.terrain[i] === TERRAIN.BRIDGE) continue;
          list.push({ depth: x + y + 1, kind: 'wall', x, y });
        }
      }
    }
    for (const gr of s.graves) {
      list.push({ depth: gr.x + gr.y + 0.9, kind: 'sprite', sprite: graveSprite(gr.id), gx: gr.x + 0.45, gy: gr.y + 0.45 });
    }
    for (const w of this.walkers.list.values()) {
      if (w.alpha <= 0.02) continue;
      list.push({ depth: w.x + w.y + 0.5, kind: 'walker', id: w.id });
    }
    for (const a of this.fauna.list.values()) {
      if (!a.visible) continue;
      list.push({ depth: a.x + a.y + 0.45, kind: 'animal', key: a.key });
    }
    list.sort((a, b) => a.depth - b.depth);
    this.drawn = list;
  }

  private drawSprite(sp: Sprite, gx: number, gy: number, alpha = 1, fit = 1, flip = false) {
    const scale = (this.tw / sp.tilePx) * fit;
    const a = this.toScreen(gx, gy);
    // Mirrored (for variety in plants and rocks) about the anchor.
    const x = flip ? a.x - (sp.w - sp.ax) * scale : a.x - sp.ax * scale;
    const y = a.y - sp.ay * scale;
    const w = sp.w * scale;
    const h = sp.h * scale;
    if (x > this.w || y > this.h || x + w < 0 || y + h < 0) return;
    const g = this.g;
    if (alpha < 1) g.globalAlpha = alpha;
    // Always drawn at the exact size and place for this zoom (the pre-shrunk copy is within 3%
    // of it), so buildings stay planted on their tiles while zooming instead of shifting a little
    // each time the zoom crosses one of the pre-shrunk sizes.
    if (flip) {
      g.save();
      g.translate(x + w, y);
      g.scale(-1, 1);
      g.drawImage(this.prescaled(sp, scale), 0, 0, w, h);
      g.restore();
    } else {
      g.drawImage(this.prescaled(sp, scale), x, y, w, h);
    }
    if (alpha < 1) g.globalAlpha = 1;
  }

  /** A sprite darkened to a burned-out shell (made once, then kept). */
  private charredCache = new WeakMap<Sprite, Sprite>();
  private charred(sp: Sprite): Sprite {
    let c = this.charredCache.get(sp);
    if (!c) {
      const cv = document.createElement('canvas');
      cv.width = sp.w; cv.height = sp.h;
      const x = cv.getContext('2d');
      if (!x) return sp;
      x.drawImage(sp.img, 0, 0, sp.w, sp.h);
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = 'rgba(34,28,26,0.78)';
      x.fillRect(0, 0, sp.w, sp.h);
      c = { ...sp, img: cv, lights: [], smoke: [] };
      this.charredCache.set(sp, c);
    }
    return c;
  }

  /**
   * Shrinking a big sprite every frame is slow. Keep copies already scaled to
   * the current zoom (in steps of about 6%), drawn at device resolution.
   */
  private scaledCache = new WeakMap<Sprite, { key: number; img: HTMLCanvasElement }[]>();
  private prescaled(sp: Sprite, scale: number): CanvasImageSource {
    const target = scale * this.dpr;
    if (target > 0.92) return sp.img; // close to full size: draw directly
    const key = Math.round(Math.log(target) / Math.log(1.06));
    let list = this.scaledCache.get(sp);
    if (!list) { list = []; this.scaledCache.set(sp, list); }
    let hit = list.find((e) => e.key === key);
    if (!hit) {
      const k = 1.06 ** key;
      let src: CanvasImageSource = sp.img;
      let sw = sp.w;
      let sh = sp.h;
      // Halve in steps for a clean downscale, then finish at the exact size.
      while (sw * 0.5 > sp.w * k) {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(sw / 2));
        c.height = Math.max(1, Math.round(sh / 2));
        const cg = c.getContext('2d')!;
        cg.imageSmoothingQuality = 'high';
        cg.drawImage(src, 0, 0, c.width, c.height);
        src = c; sw = c.width; sh = c.height;
      }
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(sp.w * k));
      out.height = Math.max(1, Math.round(sp.h * k));
      const og = out.getContext('2d')!;
      og.imageSmoothingQuality = 'high';
      og.drawImage(src, 0, 0, out.width, out.height);
      hit = { key, img: out };
      list.unshift(hit);
      if (list.length > 3) list.pop();
    }
    return hit.img;
  }

  private drawObjects(s: GameState, now: number, selection: Selection) {
    const g = this.g;
    const tw = this.tw;
    const selB = selection?.kind === 'building' ? selection.id : -1;
    const selP = selection?.kind === 'person' ? selection.id : -1;
    const roles = rolesOf(s);
    for (const d of this.drawn) {
      if (d.kind === 'wall') { this.drawWall(s, d.x, d.y); continue; }
      if (d.kind === 'deck') { this.drawDeck(d.x, d.y, d.alongX, s.buildings[s.map.occ[d.y * s.map.w + d.x] - 1]?.id === selB); continue; }
      if (d.kind === 'sprite') {
        if (d.b && d.b.id === selB) this.outlineFootprint(d.b);
        if (d.b?.burned) {
          // A charred shell.
          this.drawSprite(this.charred(d.sprite), d.gx, d.gy, d.alpha, d.fit);
        } else {
          this.drawSprite(d.sprite, d.gx, d.gy, d.alpha, d.fit, d.flip);
        }
        if (d.b?.burning !== undefined) this.drawFlames(d.b, now);
        continue;
      }
      if (d.kind === 'animal') {
        const a = this.fauna.list.get(d.key);
        if (!a) continue;
        const c = this.toScreen(a.x, a.y);
        if (c.x < -20 || c.x > this.w + 20 || c.y < -30 || c.y > this.h + 20) continue;
        drawAnimal(g, a, c.x, c.y, tw / 64, now);
        continue;
      }
      const w = this.walkers.list.get(d.id)!;
      const p = s.people[d.id];
      const c = this.toScreen(w.x, w.y);
      if (c.x < -20 || c.x > this.w + 20 || c.y < -30 || c.y > this.h + 20) continue;
      const age = Math.floor((s.day - p.born) / 360);
      // About 17 px for a grown-up at the usual zoom; children smaller.
      const k = tw / 64 * 1.08 * sizeFor(age);
      g.globalAlpha = w.alpha;
      if (d.id === selP || d.id === this.hoverPerson) {
        g.strokeStyle = C.hearthGold; g.lineWidth = 2;
        g.beginPath(); g.ellipse(c.x, c.y, 7 * k, 3.5 * k, 0, 0, Math.PI * 2); g.stroke();
      }
      // Four steps to a stride; elders step more slowly.
      const frame = Math.floor(now / (age >= 60 ? 190 : 135) + d.id * 0.37) % 4;
      drawFigure(g, c.x, c.y, k, p, costumeOf(p, age, roles), { frame, facing: w.facing, moving: w.moving, age });
      if (p.patron || p.lineage) {
        g.fillStyle = C.hearthGold;
        g.beginPath(); g.arc(c.x, c.y - 19.5 * k, 1.3 * k + 0.5, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }
  }

  /** Stakes (or stonework) of the town wall that fall within one tile. */
  private drawWall(s: GameState, tx: number, ty: number) {
    const w = s.walls!;
    const g = this.g;
    const k = this.tw / BASE_TW;
    const a0 = Math.atan2(ty + 0.5 - w.cy, tx + 0.5 - w.cx);
    const step = 0.2 / w.r;
    const done = w.built ? 1 : w.progress / Math.max(1, w.required);
    const gate = s.map.walls?.[ty * s.map.w + tx] === 2;
    const pts: { x: number; y: number }[] = [];
    for (let j = -8; j <= 8; j++) {
      const a = a0 + j * step;
      const gx = w.cx + Math.cos(a) * w.r;
      const gy = w.cy + Math.sin(a) * w.r;
      if (Math.floor(gx) !== tx || Math.floor(gy) !== ty) continue;
      if ((((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) > done) continue;
      pts.push(this.toScreen(gx, gy));
    }
    if (!pts.length) return;
    if (gate) {
      // Gateposts, taller than the wall, at either side of the opening.
      const half = 1.1 / w.r;
      for (const g0 of w.gates) {
        for (const side of [-1, 1]) {
          const a = g0 + side * half;
          const gx = w.cx + Math.cos(a) * w.r;
          const gy = w.cy + Math.sin(a) * w.r;
          if (Math.floor(gx) !== tx || Math.floor(gy) !== ty) continue;
          const p = this.toScreen(gx, gy);
          const hgt = (w.kind === 'stone' ? 40 : 30) * k;
          g.fillStyle = w.kind === 'stone' ? shade(C.stone, 0.05) : shade(C.timber, -0.05);
          g.fillRect(p.x - 3 * k, p.y - hgt, 6 * k, hgt);
          g.fillStyle = w.kind === 'stone' ? shade(C.stone, -0.2) : C.redClay;
          g.fillRect(p.x - 3.5 * k, p.y - hgt - 4 * k, 7 * k, 4 * k);
        }
      }
      return;
    }
    if (w.kind === 'stone') {
      const hgt = 22 * k;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        g.fillStyle = shade(C.stone, (i % 2) * 0.04 - 0.02);
        g.fillRect(p.x - 3 * k, p.y - hgt, 6.5 * k, hgt);
        if (i % 2 === 0) { g.fillStyle = shade(C.stone, 0.1); g.fillRect(p.x - 3 * k, p.y - hgt - 4 * k, 4 * k, 4 * k); }
      }
      return;
    }
    // Sharpened stakes, lashed together.
    const hgt = 17 * k;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const h = hgt * (0.92 + ((tx * 7 + ty * 3 + i) % 3) * 0.05);
      g.fillStyle = shade(C.timber, ((i + tx) % 2) * 0.08 - 0.04);
      g.beginPath();
      g.moveTo(p.x - 2.2 * k, p.y);
      g.lineTo(p.x - 2.2 * k, p.y - h);
      g.lineTo(p.x, p.y - h - 4 * k);
      g.lineTo(p.x + 2.2 * k, p.y - h);
      g.lineTo(p.x + 2.2 * k, p.y);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = shade(C.thatch, -0.2); g.lineWidth = Math.max(1, 1.2 * k);
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y - hgt * 0.55) : g.moveTo(p.x, p.y - hgt * 0.55))); g.stroke();
  }

  /** One tile of a timber bridge. */
  private drawDeck(x: number, y: number, alongX: boolean, selected: boolean) {
    const g = this.g;
    const k = this.tw / BASE_TW;
    const lift = 5 * k;
    const [x0, x1, y0, y1] = alongX ? [x, x + 1, y + 0.12, y + 0.88] : [x + 0.12, x + 0.88, y, y + 1];
    const p = (gx: number, gy: number, z = lift) => { const q = this.toScreen(gx, gy); return { x: q.x, y: q.y - z }; };
    // posts down into the water
    g.fillStyle = shade(C.timber, -0.3);
    for (const [gx, gy] of [[x0, y1], [x1, y1]]) { const q = p(gx, gy, 0); g.fillRect(q.x - 1.5 * k, q.y - lift, 3 * k, lift + 3 * k); }
    const c = [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)];
    g.beginPath(); c.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath();
    g.fillStyle = selected ? shade(C.timber, 0.35) : shade(C.timber, 0.18); g.fill();
    g.strokeStyle = shade(C.timber, -0.25); g.lineWidth = Math.max(1, k); g.stroke();
    // planks across the deck
    g.strokeStyle = shade(C.timber, -0.05); g.lineWidth = Math.max(0.6, 0.7 * k);
    g.beginPath();
    for (let t = 0.2; t < 1; t += 0.2) {
      const a = alongX ? p(x0 + t, y0) : p(x0, y0 + t);
      const b = alongX ? p(x0 + t, y1) : p(x1, y0 + t);
      g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    }
    g.stroke();
    // rails along both sides
    g.strokeStyle = shade(C.timber, -0.15); g.lineWidth = Math.max(1, 1.4 * k);
    const rail = 6 * k;
    g.beginPath();
    if (alongX) {
      for (const gy of [y0, y1]) { const a = p(x0, gy, lift + rail), b = p(x1, gy, lift + rail); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
    } else {
      for (const gx of [x0, x1]) { const a = p(gx, y0, lift + rail), b = p(gx, y1, lift + rail); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
    }
    g.stroke();
  }

  private drawFlames(b: Building, now: number) {
    const g = this.g;
    const k = this.tw / 64;
    const base = this.toScreen(b.x + b.w / 2, b.y + b.h / 2);
    const spread = (b.w + b.h) * 11 * k;
    // A glow first, then the flames over the roof.
    const glow = g.createRadialGradient(base.x, base.y - 24 * k, 0, base.x, base.y - 24 * k, 46 * k * b.w);
    glow.addColorStop(0, 'rgba(255,150,60,0.55)');
    glow.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = glow;
    g.fillRect(base.x - 50 * k * b.w, base.y - 74 * k * b.w, 100 * k * b.w, 100 * k * b.w);
    for (let i = 0; i < 6 + b.w * 3; i++) {
      const fx = base.x + (((i * 37) % 11) / 11 - 0.5) * spread * 1.6;
      const fy = base.y - (22 + ((i * 53) % 7) * 4) * k;
      const flick = Math.sin(now / (70 + i * 13) + i) * 0.5 + 0.5;
      const h = (24 + flick * 18) * k;
      const w = (7 + ((i * 17) % 4) * 1.5) * k;
      g.fillStyle = i % 3 === 0 ? '#FFD27A' : C.fire;
      g.globalAlpha = 0.9;
      g.beginPath();
      g.moveTo(fx - w, fy);
      g.quadraticCurveTo(fx - w * 0.8, fy - h * 0.6, fx + (flick - 0.5) * 4 * k, fy - h);
      g.quadraticCurveTo(fx + w * 0.8, fy - h * 0.6, fx + w, fy);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;
  }

  private outlineFootprint(b: Building) {
    const g = this.g;
    const pts = [this.toScreen(b.x, b.y), this.toScreen(b.x + b.w, b.y), this.toScreen(b.x + b.w, b.y + b.h), this.toScreen(b.x, b.y + b.h)];
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
    g.fillStyle = 'rgba(255,179,71,0.18)'; g.fill();
    g.strokeStyle = C.hearthGold; g.lineWidth = 2; g.stroke();
  }

  private drawHearthFire(s: GameState, now: number, running: boolean) {
    const g = this.g;
    const c = this.toScreen(s.hearth.x + 0.5, s.hearth.y + 0.5);
    const k = this.tw / 64;
    if (hasBuildingArt('hearth')) {
      // The painted fire is already lit; make it flicker while time runs.
      if (!running) return;
      const f = Math.sin(now / 110) * 0.5 + Math.sin(now / 47 + 1) * 0.3 + 0.5;
      const r = 14 * k;
      const fy = c.y - 4 * k;
      const grad = g.createRadialGradient(c.x, fy, 0, c.x, fy, r);
      grad.addColorStop(0, `rgba(255,190,90,${0.18 + f * 0.14})`);
      grad.addColorStop(1, 'rgba(255,190,90,0)');
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = grad;
      g.fillRect(c.x - r, fy - r, r * 2, r * 2);
      g.globalCompositeOperation = 'source-over';
      return;
    }
    if (running || this.night < 0.9) {
      const flick = (i: number) => Math.sin(now / (90 + i * 23) + i * 2) * 0.5 + 0.5;
      for (let i = 0; i < 3; i++) {
        const fh = (10 + flick(i) * 6 - i * 2) * k * (1 - this.night * 0.7);
        const fx = c.x + (i - 1) * 3 * k;
        g.fillStyle = i === 1 ? '#FFD27A' : C.fire;
        g.beginPath();
        g.moveTo(fx - 3.5 * k, c.y - 2 * k);
        g.quadraticCurveTo(fx - 3 * k, c.y - fh * 0.6, fx + (flick(i + 3) - 0.5) * 2 * k, c.y - fh);
        g.quadraticCurveTo(fx + 3 * k, c.y - fh * 0.6, fx + 3.5 * k, c.y - 2 * k);
        g.closePath(); g.fill();
      }
    } else {
      g.fillStyle = `rgba(255,120,60,${0.55 + Math.sin(now / 700) * 0.15})`;
      g.beginPath(); g.ellipse(c.x, c.y - 2 * k, 6 * k, 3 * k, 0, 0, Math.PI * 2); g.fill();
    }
  }

  private updateSmoke(s: GameState, now: number, dt: number, running: boolean) {
    const g = this.g;
    if (now - this.lastSmoke > (running ? 260 : 700)) {
      this.lastSmoke = now;
      for (const d of this.drawn) {
        if (d.kind === 'sprite' && d.b?.burning !== undefined && this.puffs.length < 280) {
          // Burning buildings pour out smoke.
          for (let i = 0; i < 3; i++) this.puffs.push({ x: d.b.x + d.b.w / 2, y: d.b.y + d.b.h / 2, z: 0, age: 0, life: 3000 + i * 500, drift: (i - 1) * 6, size: -20 - i * 6 });
        }
        if (d.kind !== 'sprite' || !d.b || !d.sprite.smoke.length || !d.b.built || d.b.burned || d.b.kind === 'hearth') continue;
        if (this.puffs.length > 260) break;
        if (hashString(`${d.b.id}:${Math.floor(now / 260)}`) % 3) continue;
        const [sx, sy] = d.sprite.smoke[0];
        // offset in tiles-at-zoom-1 pixels from the anchor
        const ox = (sx - d.sprite.ax) / d.sprite.tilePx * BASE_TW * (d.fit ?? 1);
        const oy = (sy - d.sprite.ay) / d.sprite.tilePx * BASE_TW * (d.fit ?? 1);
        this.puffs.push({ x: d.gx, y: d.gy, z: 0, age: 0, life: 2600 + Math.random() * 1600, drift: ox, size: oy });
      }
      // A pyre burns for a day or two after a funeral.
      for (const b of s.buildings) {
        if (b.kind === 'pyre' && !b.removed && b.lastFire !== undefined && s.day - b.lastFire <= 1 && this.puffs.length < 270) {
          this.puffs.push({ x: b.x + 1, y: b.y + 1, z: 0, age: 0, life: 3600, drift: 0, size: -14 });
        }
      }
      // The hearth always smokes a little, from the top of its flames.
      if (this.puffs.length < 280) {
        const h = this.drawn.find((d) => d.kind === 'sprite' && d.b?.kind === 'hearth');
        if (h && h.kind === 'sprite' && h.sprite.smoke.length) {
          const [sx, sy] = h.sprite.smoke[0];
          const drift = (sx - h.sprite.ax) / h.sprite.tilePx * BASE_TW * (h.fit ?? 1);
          const size = (sy - h.sprite.ay) / h.sprite.tilePx * BASE_TW * (h.fit ?? 1);
          this.puffs.push({ x: h.gx, y: h.gy, z: 0, age: 0, life: 2400, drift, size });
        } else {
          this.puffs.push({ x: s.hearth.x + 0.5, y: s.hearth.y + 0.5, z: 0, age: 0, life: 2400, drift: 0, size: -10 });
        }
      }
    }
    const k = this.tw / BASE_TW;
    g.fillStyle = 'rgba(230,226,220,1)';
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age > p.life) { this.puffs.splice(i, 1); continue; }
      const t = p.age / p.life;
      const base = this.toScreen(p.x, p.y);
      const x = base.x + (p.drift + t * 18) * k;
      const y = base.y + (p.size - t * 46) * k;
      g.globalAlpha = (1 - t) * 0.35;
      g.beginPath(); g.arc(x, y, Math.max(0.5, (2.5 + t * 7) * k), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }

  private drawLighting(s: GameState, now: number) {
    const n = this.night;
    if (n <= 0.01) return;
    const g = this.g;
    // Dusk and dawn pass through warm amber; full night is a deep blue.
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = mix('#FFE2B8', '#4A5684', Math.min(1, n * 1.15));
    g.globalAlpha = Math.min(1, n * 1.6);
    g.fillRect(0, 0, this.w, this.h);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'lighter';
    const k = this.tw / BASE_TW;
    const occupied = new Set<number>();
    for (const p of s.people) if (p.alive && p.home !== undefined && p.away === undefined) occupied.add(p.home);
    for (const d of this.drawn) {
      if (d.kind !== 'sprite' || !d.b || !d.sprite.lights.length || d.b.burned) continue;
      const home = ['tent', 'leanto', 'hut', 'house', 'townhouse', 'bighouse'].includes(d.b.kind);
      if (home && !occupied.has(d.b.id)) continue;
      const scale = (this.tw / d.sprite.tilePx) * (d.fit ?? 1);
      const a = this.toScreen(d.gx, d.gy);
      for (const [lx, ly] of d.sprite.lights) {
        const x = a.x + (lx - d.sprite.ax) * scale;
        const y = a.y + (ly - d.sprite.ay) * scale;
        const flick = 0.85 + Math.sin(now / 300 + lx) * 0.08;
        const r = 9 * k;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(255,196,107,${0.85 * n * flick})`);
        grad.addColorStop(1, 'rgba(255,196,107,0)');
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    // The hearth's glow (a low red one, when it's banked to embers for the night).
    const c = this.toScreen(s.hearth.x + 0.5, s.hearth.y + 0.5);
    const r = (this.banked ? 26 : 60) * k;
    const grad = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
    grad.addColorStop(0, this.banked ? `rgba(255,110,50,${0.4 * n})` : `rgba(255,150,70,${0.45 * n})`);
    grad.addColorStop(1, 'rgba(255,150,70,0)');
    g.fillStyle = grad;
    g.fillRect(c.x - r, c.y - r, r * 2, r * 2);
    g.globalCompositeOperation = 'source-over';
  }

  /** Rain, snow, fog, grey skies and lightning, from the day's weather. */
  private drawWeather(s: GameState, dt: number, now: number) {
    const sky = s.weather?.sky;
    const g = this.g;
    if (sky === 'cloudy' || sky === 'rain' || sky === 'storm' || sky === 'snow' || sky === 'fog') {
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = sky === 'storm' ? 'rgba(150,155,170,0.5)' : sky === 'cloudy' ? 'rgba(215,218,226,0.45)' : 'rgba(190,195,205,0.45)';
      g.fillRect(0, 0, this.w, this.h);
      g.globalCompositeOperation = 'source-over';
    }
    if (sky === 'snow') this.drawSnow(dt);
    if (sky === 'rain' || sky === 'storm') this.drawRain(dt, sky === 'storm');
    if (sky === 'fog') {
      const grad = g.createLinearGradient(0, 0, 0, this.h);
      grad.addColorStop(0, 'rgba(235,236,238,0.55)');
      grad.addColorStop(1, 'rgba(235,236,238,0.25)');
      g.fillStyle = grad;
      g.fillRect(0, 0, this.w, this.h);
    }
    // Now and then, lightning.
    if (sky === 'storm' && dt > 0 && Math.sin(now / 1300) > 0.995) {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(0, 0, this.w, this.h);
    }
  }

  private drops: { x: number; y: number; speed: number }[] = [];
  private drawRain(dt: number, heavy: boolean) {
    const g = this.g;
    const n = heavy ? 260 : 150;
    while (this.drops.length < n) this.drops.push({ x: Math.random() * this.w, y: Math.random() * this.h, speed: 420 + Math.random() * 260 });
    if (this.drops.length > n) this.drops.length = n;
    g.strokeStyle = 'rgba(200,214,230,0.45)';
    g.lineWidth = 1;
    g.beginPath();
    for (const d of this.drops) {
      d.y += (d.speed * dt) / 1000;
      d.x -= (d.speed * dt) / 1000 * 0.18;
      if (d.y > this.h) { d.y = -10; d.x = Math.random() * (this.w + 60); }
      g.moveTo(d.x, d.y);
      g.lineTo(d.x + 2.5, d.y - 12);
    }
    g.stroke();
  }

  private drawSnow(dt: number) {
    const g = this.g;
    while (this.flakes.length < 140) {
      this.flakes.push({ x: Math.random() * this.w, y: Math.random() * this.h, speed: 18 + Math.random() * 30, sway: Math.random() * 6 });
    }
    g.fillStyle = 'rgba(255,255,255,0.75)';
    for (const f of this.flakes) {
      f.y += (f.speed * dt) / 1000;
      f.x += Math.sin(f.y / 30 + f.sway) * 0.3;
      if (f.y > this.h) { f.y = -4; f.x = Math.random() * this.w; }
      g.fillRect(f.x, f.y, 2, 2);
    }
  }

  // -------------------------------------------------------------------------

  /** What's under the cursor: a person, a building, or nothing. */
  pick(s: GameState, sx: number, sy: number): Selection {
    let best: { id: number; d: number } | null = null;
    for (const w of this.walkers.list.values()) {
      if (w.alpha < 0.3) continue;
      const c = this.toScreen(w.x, w.y);
      const d = Math.hypot(c.x - sx, c.y - 7 * (this.tw / 64) - sy);
      const r = Math.max(8, 9 * (this.tw / 64));
      if (d < r && (!best || d < best.d)) best = { id: w.id, d };
    }
    if (best) return { kind: 'person', id: best.id };
    const t = this.toGrid(sx, sy);
    const tx = Math.floor(t.x);
    const ty = Math.floor(t.y);
    if (tx >= 0 && ty >= 0 && tx < s.map.w && ty < s.map.h) {
      const o = s.map.occ[ty * s.map.w + tx];
      if (o) return { kind: 'building', id: o - 1 };
    }
    // Tall buildings: test sprite rectangles, nearest first.
    for (let i = this.drawn.length - 1; i >= 0; i--) {
      const d = this.drawn[i];
      if (d.kind !== 'sprite' || !d.b) continue;
      const sp = d.sprite;
      const scale = this.tw / sp.tilePx;
      const a = this.toScreen(d.gx, d.gy);
      const x = a.x - sp.ax * scale;
      const y = a.y - sp.ay * scale;
      if (sx >= x + sp.w * scale * 0.2 && sx <= x + sp.w * scale * 0.8 && sy >= y + sp.h * scale * 0.15 && sy <= a.y) return { kind: 'building', id: d.b.id };
    }
    return null;
  }

  hover(s: GameState, sx: number, sy: number) {
    const p = this.pick(s, sx, sy);
    this.hoverPerson = p?.kind === 'person' ? p.id : null;
    return p;
  }
}
