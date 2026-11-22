// A person as they're drawn on the map, a size bigger, with their family's mark: for their card.
import { useEffect, useRef } from 'preact/hooks';
import { costumeOf, drawFigure, rolesOf, sizeFor } from '../render/figures';
import { hashString } from '../sim/rng';
import type { GameState, Person } from '../sim/types';
import { ageOf } from '../sim/world';
import { Charge } from './Arms';

const W = 56, H = 84;

export function Figure({ s, p }: { s: GameState; p: Person }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const age = ageOf(s, p);
  const costume = costumeOf(p, age, rolesOf(s));
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    drawFigure(g, W / 2, H - 6, 3.9 * sizeFor(age), p, costume, { frame: 1, facing: 1, moving: false, age });
  });
  return <canvas ref={ref} class="figure" style={{ width: `${W}px`, height: `${H}px` }} aria-hidden="true" />;
}

const MARKS = ['spiral', 'wave', 'oak', 'pot', 'fish', 'wheat', 'ram', 'axe', 'star', 'flame', 'hammer'];
const MARK_COLOURS = ['#A54D38', '#4D566F', '#697142', '#C88B3C', '#805132', '#5E7A86'];

/** Each family's own sign (painted on their pots and over their door), from their name. */
export function FamilyMark({ family }: { family: string }) {
  const h = hashString(`mark:${family}`);
  const kind = MARKS[h % MARKS.length];
  const bg = MARK_COLOURS[(h >>> 8) % MARK_COLOURS.length];
  return (
    <svg class="family-mark" viewBox="0 0 60 60" width={30} height={30} role="img" aria-label={`The ${family} family's mark`}>
      <title>{`The ${family} family's mark`}</title>
      <circle cx={30} cy={30} r={28} fill={bg} stroke="rgba(0,0,0,0.25)" stroke-width={1.5} />
      <g transform="translate(5.5 1.5) scale(0.82)"><Charge kind={kind} color="#F0E2C4" /></g>
    </svg>
  );
}
