// The wind: one breeze over the whole map, with gusts that roll across it in
// waves, so trees, bushes, reeds, flowers, barley and grass all lean together
// and a gust can be seen travelling over a field. Stronger in storms, almost
// still on a calm hot day.
import type { GameState } from '../sim/types';

/** How hard it's blowing, 0..1, from the day's weather (eased, so it never jumps). */
let strength = 0.35;

export function windStrength(s: GameState, dt: number): number {
  const sky = s.weather?.sky;
  const want = sky === 'storm' ? 1 : sky === 'rain' ? 0.6 : sky === 'snow' ? 0.45 : sky === 'fog' ? 0.12 : sky === 'cloudy' ? 0.45 : 0.32;
  strength += (want - strength) * Math.min(1, dt / 4000);
  return strength;
}

/**
 * How far something at (x, y) on the map leans at time t (ms): about -1..1, mostly leaning
 * downwind (to the right), with gusts sweeping across from the left.
 */
export function sway(x: number, y: number, t: number, phase = 0): number {
  const s = t / 1000;
  // A gust front moving across the map, and a slower swell under it.
  const front = Math.sin((x - y) * 0.35 - s * 1.1) * 0.5 + 0.5;
  const swell = Math.sin(s * 0.37 + (x + y) * 0.05) * 0.5 + 0.5;
  const gust = Math.pow(front, 3) * (0.4 + 0.6 * swell);
  // Each plant also flutters a little on its own.
  const flutter = Math.sin(s * 2.3 + phase * 6.283) * 0.25 + Math.sin(s * 3.7 + phase * 11.1) * 0.12;
  return (0.25 + gust * 0.9) * strength + flutter * (0.35 + strength * 0.65);
}
