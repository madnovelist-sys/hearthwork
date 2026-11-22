// The villagers, drawn in code after the Bronze Age costume sheet
// (art/_reference/ref_costumes_bronze.png): what each person wears follows
// their work and standing (the leader's red cloak, a faith-founder's hood, a
// potter's apron and jar, an elder's cloak and staff), while skin and hair are
// their own, whatever their work. Figures walk in four steps; children are
// smaller, and elders stoop.
import type { GameState, Person } from '../sim/types';

/** The seven natural skin tones of the costume sheet, light to deep; any of them in any role. */
export const SKIN = ['#E8C4A4', '#DBA879', '#C78D5C', '#AB704C', '#835338', '#603B2A', '#432B25'];
export const HAIR = ['#2B1F18', '#4A3020', '#7A5230', '#B08040', '#D8C090', '#6A2E1E'];
const GREY_HAIR = '#C9C4BC';

type Shape = 'tunic' | 'apron' | 'drape' | 'robe' | 'cloak';
type Prop = 'basket' | 'jar' | 'satchel' | 'staff' | 'crook' | 'axe' | 'hammer';
export interface Costume {
  shape: Shape;
  /** The garment's main colour, and the cloth beneath or beside it. */
  main: string;
  second: string;
  prop?: Prop;
  head?: 'hood' | 'band';
  belt?: 'rope' | 'bronze';
  brooch?: boolean;
  /** A short child's tunic, or a robe to the ankles. */
  short?: boolean;
  long?: boolean;
}

const WICKER = '#B8873F';
const LEATHER = '#8A5A35';
const WOOD = '#7A5533';
const BRONZE = '#C9A040';
const ROPE = '#D9C49A';

/** Clothes by work. Colours are the sheet's suggestions, extended in its spirit to the other trades. */
const BY_JOB: Record<string, Costume> = {
  farmer: { shape: 'tunic', main: '#C88B3C', second: '#EED6AE', belt: 'rope', prop: 'basket' },
  gatherer: { shape: 'tunic', main: '#9C8A45', second: '#E6D2A8', belt: 'rope', prop: 'basket' },
  herder: { shape: 'tunic', main: '#8C6E4E', second: '#E3CFA8', belt: 'rope', prop: 'crook' },
  fisher: { shape: 'tunic', main: '#5E7A86', second: '#DCCDB0', belt: 'rope', prop: 'basket' },
  woodcutter: { shape: 'tunic', main: '#6B4A33', second: '#C9A97C', belt: 'rope', prop: 'axe' },
  builder: { shape: 'tunic', main: '#A86A3E', second: '#E8D2B0', belt: 'rope' },
  potter: { shape: 'apron', main: '#AF563A', second: '#F0D7B6', prop: 'jar', head: 'band' },
  smith: { shape: 'apron', main: '#5B4636', second: '#D9C3A0', prop: 'hammer' },
  healer: { shape: 'drape', main: '#7F9A6E', second: '#EFE4CF', prop: 'satchel', long: true },
  elder: { shape: 'cloak', main: '#6E7453', second: '#DBC8AA', prop: 'staff' },
  child: { shape: 'tunic', main: '#BB792E', second: '#E6C29A', belt: 'rope', short: true },
  none: { shape: 'tunic', main: '#A8977C', second: '#E4D5BC', belt: 'rope' },
};
const LEADER: Costume = { shape: 'cloak', main: '#A54D38', second: '#D8AC69', belt: 'bronze', brooch: true };
const PRIEST: Costume = { shape: 'robe', main: '#4D566F', second: '#D8BFA0', head: 'hood', belt: 'bronze' };
const MERCHANT: Costume = { shape: 'drape', main: '#697142', second: '#D6B287', prop: 'satchel', belt: 'rope' };

/** Who holds which standing, worked out once per frame. */
export interface Roles { leader?: number; priests: Set<number>; merchants: Set<number> }

export function rolesOf(s: GameState): Roles {
  const priests = new Set<number>();
  for (const f of s.faiths) if (!f.gone) priests.add(f.founder);
  const merchants = new Set<number>();
  for (const b of s.buildings) if (b.kind === 'stall' && !b.removed && b.owner !== undefined) merchants.add(b.owner);
  return { leader: s.leader?.person, priests, merchants };
}

export function costumeOf(p: Person, age: number, roles: Roles): Costume {
  if (roles.leader === p.id && age >= 16) return LEADER;
  if (roles.priests.has(p.id) && age >= 16) return PRIEST;
  if (roles.merchants.has(p.id) && age >= 16) return MERCHANT;
  if (age >= 60) return BY_JOB.elder;
  if (age < 12) return BY_JOB.child;
  return BY_JOB[p.job] ?? BY_JOB.none;
}

/** How tall someone stands, as a share of a grown-up. */
export const sizeFor = (age: number) => (age < 8 ? 0.62 : age < 12 ? 0.72 : age < 16 ? 0.86 : 1);

export interface Pose {
  /** Walking step, 0–3 (1 and 3 are the passing steps); standing still uses 1. */
  frame: number;
  facing: number;
  moving: boolean;
  age: number;
}

/**
 * A person standing at (x, y) (their feet), `k` pixels to a figure unit (a grown-up is about
 * 17 units tall).
 */
export function drawFigure(g: CanvasRenderingContext2D, x: number, y: number, k: number, p: Person, c: Costume, pose: Pose) {
  const f = pose.facing >= 0 ? 1 : -1;
  const stoop = pose.age >= 60 ? 1 : 0;
  const step = pose.moving ? pose.frame : 1;
  const swing = step === 0 ? 1 : step === 2 ? -1 : 0; // which leg is forward
  const lift = step === 1 || step === 3 ? 0.35 : 0; // up a little on the passing steps
  const skin = SKIN[p.look.skin % SKIN.length];
  const P = (ux: number, uy: number): [number, number] => [x + ux * k, y + (uy - lift) * k];
  const line = (pts: [number, number][], colour: string, width: number) => {
    g.strokeStyle = colour; g.lineWidth = width * k; g.lineCap = 'round';
    g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.stroke();
  };
  const poly = (pts: [number, number][], colour: string) => {
    g.fillStyle = colour;
    g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.closePath(); g.fill();
  };
  const dot = (ux: number, uy: number, r: number, colour: string) => {
    const [a, b] = P(ux, uy);
    g.fillStyle = colour; g.beginPath(); g.arc(a, b, r * k, 0, Math.PI * 2); g.fill();
  };
  // Elders lean forward from the hips.
  const lean = stoop * 0.9 * f;
  const sh = -12.2 + stoop * 0.8; // shoulder height
  const head = { x: lean * 1.2, y: -14.5 + stoop * 1.3 };

  // Shadow
  g.fillStyle = 'rgba(62,58,79,0.3)';
  g.beginPath(); g.ellipse(x, y, 4 * k, 2 * k, 0, 0, Math.PI * 2); g.fill();

  // A staff or crook stands behind the far side, held in the front hand.
  if (c.prop === 'staff' || c.prop === 'crook') {
    line([P(f * 3.6, 0.3), P(f * 3.3 + lean, -15.2)], WOOD, 0.8);
    if (c.prop === 'crook') line([P(f * 3.3 + lean, -15.2), P(f * 4.6 + lean, -15.8), P(f * 4.9 + lean, -14.6)], WOOD, 0.7);
  }

  // Legs, striding in four steps (bare legs and sandals).
  const hem = c.shape === 'robe' || c.long ? -1.2 : c.shape === 'cloak' ? -2.2 : c.shape === 'apron' ? -2.8 : c.short ? -5.6 : -4.6;
  for (const side of [-1, 1]) {
    const fwd = swing * side * f;
    const foot: [number, number] = [x + (side * 0.95 + fwd * 1.0) * k, y]; // feet stay on the ground
    line([P(side * 1.0, hem - 0.5), foot], skin, 1.35);
    g.fillStyle = '#5A3A22'; g.fillRect(foot[0] - 0.8 * k, foot[1] - 0.45 * k, 1.6 * k, 0.6 * k);
  }

  // A cloak hangs behind and around the body.
  if (c.shape === 'cloak') poly([P(-3.2 + lean, sh - 0.2), P(3.2 + lean, sh - 0.2), P(4.0, hem), P(-4.0, hem)], c.main);

  // The body: tunic, dress or robe.
  const inner = c.shape === 'tunic' ? c.main : c.shape === 'robe' ? c.main : c.second;
  const wHem = c.shape === 'robe' ? 3.6 : c.shape === 'cloak' ? 3.0 : 3.3;
  poly([P(-2.6 + lean, sh), P(2.6 + lean, sh), P(wHem, hem), P(-wHem, hem)], inner);
  // A pale hem on tunics (the cloth beneath), as on the sheet.
  if (c.shape === 'tunic') line([P(-wHem + 0.3, hem - 0.25), P(wHem - 0.3, hem - 0.25)], c.second, 0.6);

  if (c.shape === 'apron') {
    // The apron, from chest to knee, over a pale dress.
    poly([P(-1.8 + lean * 0.8, sh + 1.2), P(1.8 + lean * 0.8, sh + 1.2), P(2.5, hem - 0.8), P(-2.5, hem - 0.8)], c.main);
  }
  if (c.shape === 'robe') {
    // A pale band down the front, with a mark on it.
    poly([P(-0.8 + lean * 0.8, sh + 0.6), P(0.8 + lean * 0.8, sh + 0.6), P(1.0, hem), P(-1.0, hem)], c.second);
    dot(lean * 0.5, sh + 4.8, 0.55, c.main);
  }
  if (c.shape === 'drape') {
    // A shawl over the shoulders, and a strap across the body to a satchel.
    poly([P(-3.0 + lean, sh - 0.3), P(3.0 + lean, sh - 0.3), P(2.6 + lean * 0.7, sh + 3.0), P(0 + lean * 0.6, sh + 4.4), P(-2.6 + lean * 0.7, sh + 3.0)], c.main);
  }
  if (c.belt) line([P(-2.9 + lean * 0.5, -8.4), P(2.9 + lean * 0.5, -8.4)], c.belt === 'bronze' ? BRONZE : ROPE, 0.7);

  // Arms, swinging against the legs.
  const sleeve = c.shape === 'apron' ? c.second : c.main;
  for (const side of [-1, 1]) {
    const back = -swing * side * f * 0.8;
    const holding = (c.prop === 'basket' || c.prop === 'axe' || c.prop === 'hammer') && side === f ? 0 : back;
    const shoulder = P(side * 2.5 + lean, sh + 0.5);
    const hand = P(side * 3.0 + holding + lean * 0.6, -7.2 + stoop * 0.4);
    line([shoulder, hand], sleeve, 1.3);
    dot(side * 3.0 + holding + lean * 0.6, -7.0 + stoop * 0.4, 0.7, skin);
  }

  // Head, hair and headwear.
  if (c.head === 'hood') dot(head.x, head.y + 0.2, 3.0, c.main);
  dot(head.x, head.y + (c.head === 'hood' ? 0.5 : 0), c.head === 'hood' ? 2.1 : 2.5, skin);
  if (c.head !== 'hood') {
    g.fillStyle = pose.age >= 58 ? GREY_HAIR : HAIR[p.look.hair % HAIR.length];
    const [hx, hy] = P(head.x - f * 0.4, head.y - 1.0);
    g.beginPath(); g.arc(hx, hy, 2.5 * k, Math.PI * 1.05, Math.PI * 1.95); g.fill();
  }
  if (c.head === 'band') line([P(head.x - 2.3, head.y - 0.9), P(head.x + 2.3, head.y - 0.9)], c.second, 0.7);
  if (c.brooch) dot(lean - f * 1.1, sh + 0.6, 0.7, BRONZE);

  // What they carry.
  const hx = f * 3.0, hy = -7.0 + stoop * 0.4;
  switch (c.prop) {
    case 'basket': {
      const [a, b] = P(hx + f * 0.2, hy + 0.4);
      g.fillStyle = WICKER; g.beginPath(); g.ellipse(a, b + 0.9 * k, 1.7 * k, 1.3 * k, 0, 0, Math.PI * 2); g.fill();
      line([P(hx - 1.3 + f * 0.2, hy + 0.7), P(hx + 1.5 + f * 0.2, hy + 0.7)], '#8A6430', 0.45);
      break;
    }
    case 'jar':
      dot(f * 1.2 + lean, -9.6, 1.6, '#B8603E');
      line([P(f * 1.2 + lean - 0.7, -11.2), P(f * 1.2 + lean + 0.7, -11.2)], '#8E4630', 0.6);
      break;
    case 'satchel': {
      line([P(f * 2.0 + lean, sh + 0.2), P(-f * 2.6, -7.6)], '#6B4428', 0.5);
      const [a, b] = P(-f * 2.9, -6.9);
      g.fillStyle = LEATHER; g.fillRect(a - 1.1 * k, b - 1.0 * k, 2.2 * k, 2.0 * k);
      break;
    }
    case 'axe':
      line([P(hx, hy), P(hx - f * 1.2 + lean, -15.0)], WOOD, 0.6);
      poly([P(hx - f * 1.2 + lean, -15.4), P(hx - f * 2.6 + lean, -15.0), P(hx - f * 2.4 + lean, -13.4), P(hx - f * 1.3 + lean, -13.9)], '#7C7F84');
      break;
    case 'hammer':
      line([P(hx, hy), P(hx + f * 0.3, hy + 2.6)], WOOD, 0.55);
      poly([P(hx - 0.6 + f * 0.3, hy + 2.3), P(hx + 0.9 + f * 0.3, hy + 2.3), P(hx + 0.9 + f * 0.3, hy + 3.5), P(hx - 0.6 + f * 0.3, hy + 3.5)], '#5E6266');
      break;
  }
  g.lineCap = 'butt';
}
