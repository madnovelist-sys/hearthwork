// What people walk around: every building as it's drawn (not its plot), tree
// trunks, boulders, stumps, woodsheds, racks and log piles, and the fences of
// the pens. Shapes on the ground, in map coordinates, looked up by tile.
import { TREE, type GameState } from '../sim/types';
import { DECOR, type Decor } from './decor';
import { placement, treeSpot } from './layout';

export type Shape = { kind: 'circle'; x: number; y: number; r: number } | { kind: 'box'; x0: number; y0: number; x1: number; y1: number };

/** Trunk (or rock) radius by kind of tree, in tiles. */
const TRUNK: Record<number, number> = { [TREE.BROADLEAF]: 0.13, [TREE.PINE]: 0.11, [TREE.FRUIT]: 0.12, [TREE.BUSH]: 0.2, [TREE.BOULDER]: 0.32, [TREE.STUMP]: 0.12 };
const PROP: Record<number, number> = { [DECOR.LOG]: 0.26, [DECOR.DEADWOOD]: 0.22, [DECOR.LOGPILE]: 0.24, [DECOR.WOODSHED]: 0.32, [DECOR.RACK]: 0.24 };
/** Things people walk on or into, not around. */
const OPEN = new Set(['field', 'graveyard', 'bridge', 'dock', 'landing', 'grove', 'bigtree', 'stone']);

export class Obstacles {
  private key = '';
  private cells = new Map<number, Shape[]>();
  private w = 0;

  update(s: GameState, decor: Decor) {
    const key = `${s.day}:${s.buildings.length}:${s.map.w}:${decor.items.length}`;
    if (key === this.key) return;
    this.key = key;
    this.w = s.map.w;
    this.cells.clear();
    const { map } = s;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const t = map.trees[y * map.w + x];
      if (!t) continue;
      if ((map.growth?.[y * map.w + x] ?? 1) < 0.5 && t !== TREE.STUMP && t !== TREE.BOULDER) continue; // saplings
      const at = treeSpot(x, y);
      this.add({ kind: 'circle', x: at.x, y: at.y, r: TRUNK[t] ?? 0.12 });
    }
    for (const d of decor.items) {
      const r = PROP[d.kind];
      if (r) this.add({ kind: 'circle', x: d.x + 0.5 + d.dx, y: d.y + 0.5 + d.dy, r });
    }
    for (const b of s.buildings) {
      if (b.removed || OPEN.has(b.kind)) continue;
      if (!b.built || b.kind === 'pen') { this.add({ kind: 'box', x0: b.x + 0.04, y0: b.y + 0.04, x1: b.x + b.w - 0.04, y1: b.y + b.h - 0.04 }); continue; }
      const p = placement(b);
      if (b.kind === 'hearth') { this.add({ kind: 'circle', x: p.cx, y: p.cy, r: Math.max(p.hx, p.hy) * 0.8 }); continue; }
      this.add({ kind: 'box', x0: p.cx - p.hx * 0.92, y0: p.cy - p.hy * 0.92, x1: p.cx + p.hx * 0.92, y1: p.cy + p.hy * 0.92 });
    }
  }

  private add(sh: Shape) {
    const [x0, y0, x1, y1] = sh.kind === 'circle' ? [sh.x - sh.r, sh.y - sh.r, sh.x + sh.r, sh.y + sh.r] : [sh.x0, sh.y0, sh.x1, sh.y1];
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
      const k = y * this.w + x;
      const c = this.cells.get(k);
      if (c) { if (!c.includes(sh)) c.push(sh); } else this.cells.set(k, [sh]);
    }
  }

  /** Shapes on or next to the tile at (x, y). */
  private near(x: number, y: number): Shape[] {
    const out: Shape[] = [];
    const tx = Math.floor(x), ty = Math.floor(y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.cells.get((ty + dy) * this.w + tx + dx);
      if (c) for (const sh of c) if (!out.includes(sh)) out.push(sh);
    }
    return out;
  }

  /** Whether someone of radius r standing at (x, y) would be inside something. */
  blocked(x: number, y: number, r: number): boolean {
    for (const sh of this.near(x, y)) {
      if (sh.kind === 'circle' ? Math.hypot(x - sh.x, y - sh.y) < sh.r + r : x > sh.x0 - r && x < sh.x1 + r && y > sh.y0 - r && y < sh.y1 + r) return true;
    }
    return false;
  }

  /** Move someone out of anything they've ended up inside (to the nearest edge). */
  pushOut(x: number, y: number, r: number): { x: number; y: number } {
    for (let pass = 0; pass < 2; pass++) {
      for (const sh of this.near(x, y)) {
        if (sh.kind === 'circle') {
          const dx = x - sh.x, dy = y - sh.y, d = Math.hypot(dx, dy), min = sh.r + r;
          if (d < min) {
            const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
            x = sh.x + nx * (min + 0.001); y = sh.y + ny * (min + 0.001);
          }
        } else if (x > sh.x0 - r && x < sh.x1 + r && y > sh.y0 - r && y < sh.y1 + r) {
          const opts = [[x - (sh.x0 - r), -1, 0], [(sh.x1 + r) - x, 1, 0], [y - (sh.y0 - r), 0, -1], [(sh.y1 + r) - y, 0, 1]];
          opts.sort((a, b) => a[0] - b[0]);
          const [d, ux, uy] = opts[0];
          x += ux * (d + 0.001); y += uy * (d + 0.001);
        }
      }
    }
    return { x, y };
  }

  /**
   * A sideways nudge, for someone at (x, y) heading along (vx, vy), to pass round whatever small
   * thing is just ahead (a tree, a rock, a woodshed) instead of walking into it.
   */
  avoid(x: number, y: number, vx: number, vy: number, r: number): { x: number; y: number } {
    const sp = Math.hypot(vx, vy);
    if (sp < 1e-4) return { x: 0, y: 0 };
    const ux = vx / sp, uy = vy / sp;
    let ax = 0, ay = 0;
    for (const sh of this.near(x + ux * 0.5, y + uy * 0.5)) {
      if (sh.kind !== 'circle') continue;
      const ox = sh.x - x, oy = sh.y - y;
      const ahead = ox * ux + oy * uy;
      if (ahead <= 0 || ahead > 0.9) continue;
      const side = ox * -uy + oy * ux; // which side of the way it's on
      const clear = sh.r + r + 0.06;
      if (Math.abs(side) > clear) continue;
      const push = (1 - ahead / 0.9) * (clear - Math.abs(side)) / clear;
      const dir = side >= 0 ? -1 : 1; // step to the other side
      ax += -uy * dir * push * sp * 1.6; ay += ux * dir * push * sp * 1.6;
    }
    return { x: ax, y: ay };
  }

  /** Whether a straight walk from a to b (for someone of radius r) misses everything. */
  clearLine(ax: number, ay: number, bx: number, by: number, r: number): boolean {
    const d = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(d / 0.2));
    for (let k = 1; k <= n; k++) if (this.blocked(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, r)) return false;
    return true;
  }
}
