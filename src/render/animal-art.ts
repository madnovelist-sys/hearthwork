// The painted animals (art/animals): goats, sheep, dogs, cats, deer and ducks,
// each in one three-quarter view (facing right; mirrored to face left), with a
// gentle breathing loop for standing still and, for ducks, a swimming pose.
// There's no painted gait yet, so a walking animal bobs a little as it goes.
// Coats vary a little from animal to animal (a darker dog, a grey cat, the odd
// black sheep). Until the art loads, the code-drawn animals stand in.
import type { Animal, AnimalKind } from './fauna';

type State = 'idle' | 'ambient' | 'swimming';
const art = new Map<string, HTMLImageElement>();
const tinted = new Map<string, HTMLCanvasElement>();

export function addAnimalArt(kind: string, state: string, size: number, img: HTMLImageElement) {
  art.set(`${kind}:${state}:${size}`, img);
  tinted.clear();
}

/** How tall each animal stands, in CSS px at zoom 1 (a grown-up villager is 20). */
const HEIGHT: Record<AnimalKind, number> = { goat: 11, sheep: 10.5, dog: 9, cat: 6.5, deer: 17, duck: 6 };
/** How tall each is painted in its 96 px frame, and where its feet stand (from the art's notes). */
const PAINTED: Record<AnimalKind, number> = { goat: 65, sheep: 59, dog: 56, cat: 44, deer: 69, duck: 40 };
const ANCHOR: Record<number, [number, number]> = { 96: [48, 88], 64: [32, 59] };
/** Coats, picked by each animal's number. */
const COATS: Record<AnimalKind, (Tint | null)[]> = {
  dog: [null, 'dark', 'pale'], cat: [null, 'grey', 'dark'], goat: [null, 'dark', 'pale'],
  sheep: [null, null, null, null, null, null, 'black'], deer: [null], duck: [null],
};
type Tint = 'dark' | 'pale' | 'grey' | 'black';

export function drawAnimalArt(g: CanvasRenderingContext2D, a: Animal, x: number, y: number, k: number, now: number, dpr: number): boolean {
  const moving = Math.hypot(a.tx - a.x, a.ty - a.y) > 0.05;
  const state: State = a.kind === 'duck' ? 'swimming' : moving ? 'idle' : 'ambient';
  const height = HEIGHT[a.kind] * k;
  const scale96 = height / PAINTED[a.kind];
  // The 64 px painting when it's small on screen, the 96 px one when it's big.
  const size = scale96 * 96 * dpr <= 72 && art.has(`${a.kind}:${state}:64`) ? 64 : 96;
  const img = art.get(`${a.kind}:${state}:${size}`) ?? art.get(`${a.kind}:idle:${size}`);
  if (!img) return false;
  const scale = scale96 * (96 / size);
  const frames = Math.max(1, Math.round(img.width / size));
  const frame = frames > 1 ? Math.floor(now / 190 + a.variant * 1.7) % frames : 0;
  const coats = COATS[a.kind];
  const src = coat(img, a.kind, state, size, coats[a.variant % coats.length]);
  // A little bob as it walks; a duck rides the water.
  const bob = a.kind === 'duck' ? Math.sin(now / 600 + a.variant) * 0.5 * k : moving ? Math.abs(Math.sin(now / 95 + a.variant)) * 1.1 * k : 0;
  if (a.kind !== 'duck') {
    g.fillStyle = 'rgba(62,58,79,0.25)';
    g.beginPath(); g.ellipse(x, y, height * 0.42, height * 0.17, 0, 0, Math.PI * 2); g.fill();
  }
  const [ax, ay] = ANCHOR[size];
  const w = size * scale;
  const top = y - ay * scale - bob;
  if (a.facing < 0) {
    g.save();
    g.translate(x + ax * scale, top);
    g.scale(-1, 1);
    g.drawImage(src, frame * size, 0, size, size, 0, 0, w, w);
    g.restore();
  } else {
    g.drawImage(src, frame * size, 0, size, size, x - ax * scale, top, w, w);
  }
  return true;
}

/** The painting in another coat (made once). */
function coat(img: HTMLImageElement, kind: string, state: string, size: number, tint: Tint | null): HTMLImageElement | HTMLCanvasElement {
  if (!tint) return img;
  const key = `${kind}:${state}:${size}:${tint}`;
  let c = tinted.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  if (tint === 'grey') {
    g.globalCompositeOperation = 'saturation';
    g.globalAlpha = 0.85;
    g.fillStyle = '#808080';
  } else {
    g.globalCompositeOperation = tint === 'pale' ? 'screen' : 'multiply';
    g.fillStyle = { dark: '#8A7568', pale: '#4A4038', black: '#4A403A' }[tint];
  }
  g.fillRect(0, 0, c.width, c.height);
  // Keep the painting's own outline.
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  tinted.set(key, c);
  return c;
}
