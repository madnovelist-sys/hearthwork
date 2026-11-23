// The barley's year, field by field: sprouting in spring, green then ripening in summer, cut one
// field at a time through the autumn (a strip at a time, along a line the farmer works), and
// lying fallow (under snow, when there is some) in winter.
import { hashString } from '../sim/rng';
import type { Building, GameState } from '../sim/types';
import { seasonIndex, seasonProgress } from '../sim/world';

/** How much of a field has been cut, 0..1 (0 outside the autumn before its turn, 1 after). */
export function harvestOf(s: GameState, b: Building): number {
  const season = seasonIndex(s.day);
  if (season === 3) return 1;
  if (season !== 2) return 0;
  const p = seasonProgress(s.day);
  const done = 0.15 + ((hashString(`field${b.id}`) % 100) / 100) * 0.5; // each field its own days
  const start = done - 0.12;
  return p <= start ? 0 : p >= done ? 1 : (p - start) / 0.12;
}

export function barleyState(s: GameState, b: Building, snowy: boolean): string {
  const season = seasonIndex(s.day);
  const p = seasonProgress(s.day);
  if (snowy) return 'winter-fallow';
  if (season === 3) return 'harvested';
  if (season === 0) return p < 0.45 ? 'sprouts' : 'growing';
  if (season === 1) return p < 0.55 ? 'growing' : 'ripe';
  return harvestOf(s, b) >= 1 ? 'harvested' : 'ripe';
}
