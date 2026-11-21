// The animals you see: herds in their pens, dogs following their people,
// cats on doorsteps, deer at the edge of the woods, ducks on the river and
// the odd flock of birds. Cosmetic, driven by the simulation's counts.
import { doorOf } from '../sim/planner';
import { hashString } from '../sim/rng';
import { TERRAIN, TREE, type GameState } from '../sim/types';
import type { Walkers } from './walkers';

export type AnimalKind = 'goat' | 'sheep' | 'dog' | 'cat' | 'deer' | 'duck';

export interface Animal {
  key: string;
  kind: AnimalKind;
  x: number;
  y: number;
  tx: number;
  ty: number;
  wait: number;
  facing: number;
  variant: number;
  visible: boolean;
}

/** A bird over the world: grid position, height above the ground (px at zoom 1), velocity in tiles a second. */
interface Bird { x: number; y: number; z: number; vx: number; vy: number; flap: number; until: number }

export class Fauna {
  list = new Map<string, Animal>();
  birds: Bird[] = [];
  private nextFlock = 0;
  private edgeTiles: number[] = [];
  private waterTiles: number[] = [];
  private scanned = -9999;

  update(s: GameState, walkers: Walkers, now: number, dtMs: number, night: number, viewW: number, viewH: number, toGrid: (sx: number, sy: number) => { x: number; y: number }) {
    const dt = Math.min(dtMs, 100) / 1000;
    if (now - this.scanned > 10_000) this.scan(s, now);
    const seen = new Set<string>();
    const rnd = (k: string, n: number) => (hashString(`${k}:${Math.floor(now / 4000)}:${n}`) % 1000) / 1000;

    // Herds wander inside their pens.
    for (const b of s.buildings) {
      if (b.kind !== 'pen' || !b.built || b.removed) continue;
      const n = Math.min(b.herd ?? 0, 9);
      for (let i = 0; i < n; i++) {
        const key = `pen${b.id}:${i}`;
        const a = this.get(key, i % 3 === 0 ? 'sheep' : 'goat', b.x + 0.5 + (i % 3) * 0.5, b.y + 0.5 + Math.floor(i / 3) * 0.45, i);
        seen.add(key);
        a.visible = true;
        if (a.wait <= now && Math.hypot(a.tx - a.x, a.ty - a.y) < 0.05) {
          a.tx = b.x + 0.25 + rnd(key, 1) * (b.w - 0.5);
          a.ty = b.y + 0.25 + rnd(key, 2) * (b.h - 0.5);
          a.wait = now + 1500 + rnd(key, 3) * 5000;
        }
        this.step(a, dt, 0.35);
      }
    }

    // Pets keep close to their people.
    for (const pet of s.pets) {
      if (!pet.alive || pet.owner === undefined) continue;
      const owner = s.people[pet.owner];
      if (!owner?.alive || owner.away !== undefined || owner.home === undefined) continue;
      const home = s.buildings[owner.home];
      if (!home || home.removed) continue;
      const key = `pet${pet.id}`;
      const door = doorOf(home);
      const a = this.get(key, pet.kind, door.x + 0.5, door.y + 0.3, pet.id);
      seen.add(key);
      const w = walkers.list.get(owner.id);
      const out = w && !w.inside && w.alpha > 0.5;
      if (pet.kind === 'dog' && out) {
        a.visible = true;
        a.tx = w.x - 0.35 * w.facing;
        a.ty = w.y + 0.2;
        this.step(a, dt, 2.2);
      } else {
        // At home: a dog lies by the door, a cat sits on the step (indoors at night).
        a.visible = night < 0.6;
        a.tx = door.x + 0.5 + (pet.kind === 'cat' ? 0.25 : -0.2);
        a.ty = door.y + 0.25;
        this.step(a, dt, 1.4);
      }
    }

    // Deer at the edge of the woods, as many as the woods hold.
    const deer = Math.min(10, Math.ceil(Math.max(0, s.wild.deer) / 3));
    for (let i = 0; i < deer && this.edgeTiles.length; i++) {
      const key = `deer${i}`;
      const home = this.edgeTiles[(i * 7) % this.edgeTiles.length];
      const hx = (home % s.map.w) + 0.5;
      const hy = Math.floor(home / s.map.w) + 0.5;
      const a = this.get(key, 'deer', hx, hy, i);
      seen.add(key);
      a.visible = true;
      if (a.wait <= now && Math.hypot(a.tx - a.x, a.ty - a.y) < 0.05) {
        a.tx = hx + (rnd(key, 1) - 0.5) * 2.5;
        a.ty = hy + (rnd(key, 2) - 0.5) * 2.5;
        a.wait = now + 3000 + rnd(key, 3) * 8000;
      }
      this.step(a, dt, 0.5);
    }

    // Ducks on the river, except in winter.
    const winter = Math.floor((s.day % 360) / 90) === 3;
    const ducks = winter ? 0 : Math.min(6, this.waterTiles.length);
    for (let i = 0; i < ducks; i++) {
      const key = `duck${i}`;
      const home = this.waterTiles[(i * 5) % this.waterTiles.length];
      const hx = (home % s.map.w) + 0.5;
      const hy = Math.floor(home / s.map.w) + 0.5;
      const a = this.get(key, 'duck', hx, hy, i);
      seen.add(key);
      a.visible = true;
      if (a.wait <= now && Math.hypot(a.tx - a.x, a.ty - a.y) < 0.05) {
        const j = this.waterTiles[(hashString(`${key}:${Math.floor(now / 7000)}`) >>> 0) % this.waterTiles.length];
        const jx = (j % s.map.w) + 0.5;
        const jy = Math.floor(j / s.map.w) + 0.5;
        if (Math.hypot(jx - a.x, jy - a.y) < 3) { a.tx = jx; a.ty = jy; }
        a.wait = now + 2000 + rnd(key, 3) * 6000;
      }
      this.step(a, dt, 0.25);
    }
    for (const k of [...this.list.keys()]) if (!seen.has(k)) this.list.delete(k);

    // Now and then a flock of birds flies over by day. It sets off from just outside what you're
    // looking at, but it flies over the land: pan away and you leave it behind.
    if (night < 0.3 && now > this.nextFlock && this.birds.length < 8) {
      this.nextFlock = now + 40_000 + (hashString(`flock${Math.floor(now / 1000)}`) % 50_000);
      const sy = 60 + (hashString(`fy${now}`) % Math.max(1, Math.floor(viewH * 0.5)));
      const dir = hashString(`fd${now}`) % 2 ? 1 : -1;
      const z = 70 + (hashString(`fz${now}`) % 50);
      const from = toGrid(dir > 0 ? -60 : viewW + 60, sy + z);
      const to = toGrid(dir > 0 ? viewW + 60 : -60, sy + z + (hashString(`fe${now}`) % 120) - 60);
      const secs = (viewW + 120) / 46;
      const vx = (to.x - from.x) / secs;
      const vy = (to.y - from.y) / secs;
      const len = Math.hypot(vx, vy) || 1;
      // A loose V: followers trail behind and to either side of the leader.
      for (let i = 0; i < 7; i++) {
        const row = Math.ceil(i / 2);
        const side = i % 2 ? 1 : -1;
        const back = row * 0.35;
        const across = row * 0.3 * side;
        this.birds.push({
          x: from.x - (vx / len) * back - (vy / len) * across,
          y: from.y - (vy / len) * back + (vx / len) * across,
          z, vx, vy, flap: i, until: now + secs * 1000 + 20_000,
        });
      }
    }
    for (const b of this.birds) { b.x += b.vx * dt; b.y += b.vy * dt; }
    const margin = 20;
    this.birds = this.birds.filter((b) => now < b.until && b.x > -margin && b.y > -margin && b.x < s.map.w + margin && b.y < s.map.h + margin);
  }

  private get(key: string, kind: AnimalKind, x: number, y: number, variant: number): Animal {
    let a = this.list.get(key);
    if (!a || a.kind !== kind) {
      a = { key, kind, x, y, tx: x, ty: y, wait: 0, facing: 1, variant, visible: true };
      this.list.set(key, a);
    }
    return a;
  }

  private step(a: Animal, dt: number, speed: number) {
    const dx = a.tx - a.x;
    const dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.01) return;
    if (d > 6) { a.x = a.tx; a.y = a.ty; return; } // jumped too far (e.g. after a pause): just be there
    const move = Math.min(d, speed * dt);
    a.x += (dx / d) * move;
    a.y += (dy / d) * move;
    if (Math.abs(dx - dy) > 0.02) a.facing = dx - dy > 0 ? 1 : -1;
  }

  private scan(s: GameState, now: number) {
    this.scanned = now;
    const { map, hearth } = s;
    const edge: number[] = [];
    const water: number[] = [];
    const R = 18;
    for (let y = Math.max(1, hearth.y - R); y < Math.min(map.h - 1, hearth.y + R); y++) {
      for (let x = Math.max(1, hearth.x - R); x < Math.min(map.w - 1, hearth.x + R); x++) {
        const i = y * map.w + x;
        const t = map.terrain[i];
        if ((t === TERRAIN.WATER || t === TERRAIN.DEEP) && Math.hypot(x - hearth.x, y - hearth.y) < 13) water.push(i);
        if (t !== TERRAIN.GRASS || map.trees[i] !== TREE.NONE || map.occ[i] || map.wear[i] > 0.5) continue;
        let woods = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = map.trees[(y + dy) * map.w + (x + dx)];
          if ((n === TREE.BROADLEAF || n === TREE.PINE) && map.growth[(y + dy) * map.w + (x + dx)] >= 1) woods++;
        }
        if (woods >= 2 && Math.hypot(x - hearth.x, y - hearth.y) > 6) edge.push(i);
      }
    }
    this.edgeTiles = edge;
    this.waterTiles = water;
  }
}

/** Draw one animal at a screen point. k = zoom scale (1 at the default size). */
export function drawAnimal(g: CanvasRenderingContext2D, a: Animal, x: number, y: number, k: number, now: number) {
  const f = a.facing;
  g.fillStyle = 'rgba(62,58,79,0.25)';
  g.beginPath(); g.ellipse(x, y, 4.5 * k, 2 * k, 0, 0, Math.PI * 2); g.fill();
  const leg = (dx: number, len: number, color: string) => {
    g.strokeStyle = color; g.lineWidth = Math.max(1, 0.9 * k);
    g.beginPath(); g.moveTo(x + dx * k, y - len * k); g.lineTo(x + dx * k, y); g.stroke();
  };
  switch (a.kind) {
    case 'goat': {
      const body = a.variant % 2 ? '#8A6A4E' : '#E9E2D3';
      leg(-2.5, 3, '#5A4A3A'); leg(2.5, 3, '#5A4A3A');
      g.fillStyle = body; g.beginPath(); g.ellipse(x, y - 4.2 * k, 4 * k, 2.3 * k, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + 4 * f * k, y - 5.6 * k, 1.6 * k, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#4A3A2E'; g.lineWidth = Math.max(1, 0.7 * k);
      g.beginPath(); g.moveTo(x + 3.6 * f * k, y - 7 * k); g.lineTo(x + 2.6 * f * k, y - 8.6 * k); g.stroke();
      break;
    }
    case 'sheep': {
      leg(-2.2, 2.6, '#3B3330'); leg(2.2, 2.6, '#3B3330');
      g.fillStyle = '#F2EEE6';
      for (const [dx, dy, r] of [[-1.8, -4, 2.4], [1.2, -4.4, 2.6], [0, -5.2, 2.2]]) { g.beginPath(); g.arc(x + dx * k, y + dy * k, r * k, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#3B3330'; g.beginPath(); g.arc(x + 3.8 * f * k, y - 4.8 * k, 1.4 * k, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'dog': {
      const body = ['#8A5A3B', '#3B3330', '#C9A56A'][a.variant % 3];
      const wag = Math.sin(now / 120 + a.variant) * 1.2;
      leg(-2, 2.6, body); leg(2, 2.6, body);
      g.fillStyle = body; g.beginPath(); g.ellipse(x, y - 3.6 * k, 3.6 * k, 1.8 * k, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + 3.5 * f * k, y - 5 * k, 1.5 * k, 0, Math.PI * 2); g.fill();
      g.strokeStyle = body; g.lineWidth = Math.max(1, 0.9 * k);
      g.beginPath(); g.moveTo(x - 3.4 * f * k, y - 4 * k); g.lineTo(x - 5 * f * k, y - (5.5 + wag) * k); g.stroke();
      break;
    }
    case 'cat': {
      const body = ['#3B3330', '#C98B3A', '#9A928A'][a.variant % 3];
      g.fillStyle = body; g.beginPath(); g.ellipse(x, y - 2.2 * k, 1.9 * k, 2.2 * k, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + 0.4 * f * k, y - 4.8 * k, 1.3 * k, 0, Math.PI * 2); g.fill();
      g.strokeStyle = body; g.lineWidth = Math.max(1, 0.8 * k);
      g.beginPath(); g.moveTo(x - 1.6 * f * k, y - 1 * k); g.quadraticCurveTo(x - 3.6 * f * k, y - 2 * k, x - 3 * f * k, y - 4.6 * k); g.stroke();
      break;
    }
    case 'deer': {
      leg(-2.4, 4.6, '#6B4A33'); leg(2.4, 4.6, '#6B4A33');
      g.fillStyle = '#A87B52'; g.beginPath(); g.ellipse(x, y - 5.6 * k, 4 * k, 2 * k, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(x + 2.6 * f * k, y - 6.2 * k); g.lineTo(x + 4.2 * f * k, y - 9.4 * k); g.lineTo(x + 5.2 * f * k, y - 8.8 * k); g.lineTo(x + 3.8 * f * k, y - 5.6 * k); g.fill();
      g.beginPath(); g.ellipse(x + 4.8 * f * k, y - 9.6 * k, 1.5 * k, 1 * k, 0, 0, Math.PI * 2); g.fill();
      if (a.variant % 3 === 0) {
        g.strokeStyle = '#E3D3B8'; g.lineWidth = Math.max(1, 0.7 * k);
        g.beginPath(); g.moveTo(x + 4.6 * f * k, y - 10.4 * k); g.lineTo(x + 4 * f * k, y - 13 * k); g.moveTo(x + 4.3 * f * k, y - 12 * k); g.lineTo(x + 5.6 * f * k, y - 13 * k); g.stroke();
      }
      break;
    }
    case 'duck': {
      const bob = Math.sin(now / 600 + a.variant) * 0.4;
      g.fillStyle = a.variant % 2 ? '#8A6A4E' : '#F2EEE6';
      g.beginPath(); g.ellipse(x, y - (1.2 + bob) * k, 2.6 * k, 1.3 * k, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = a.variant % 2 ? '#3F6B4A' : '#F2EEE6';
      g.beginPath(); g.arc(x + 2 * f * k, y - (2.8 + bob) * k, 1 * k, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#E8A33A'; g.fillRect(x + (f > 0 ? 2.8 : -3.8) * k, y - (2.9 + bob) * k, 1 * k, 0.6 * k);
      break;
    }
  }
}

export function drawBirds(g: CanvasRenderingContext2D, birds: Bird[], now: number, toScreen: (gx: number, gy: number) => { x: number; y: number }, zoom: number) {
  const k = Math.max(0.6, Math.min(1.5, zoom));
  g.strokeStyle = 'rgba(59,47,42,0.75)';
  g.lineWidth = 1.4 * k;
  for (const b of birds) {
    const p = toScreen(b.x, b.y);
    const x = p.x;
    const y = p.y - b.z * zoom;
    const w = Math.sin(now / 140 + b.flap) * 3 * k;
    g.beginPath();
    g.moveTo(x - 5 * k, y - w);
    g.quadraticCurveTo(x - 2 * k, y - 3 * k, x, y);
    g.quadraticCurveTo(x + 2 * k, y - 3 * k, x + 5 * k, y - w);
    g.stroke();
  }
}
