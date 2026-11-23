// Shared by the tests: a settlement left to grow for some years.
import { call, callOptions } from '../src/sim/callers';
import { foundSettlement, stepDay } from '../src/sim/sim';
import { DAYS_PER_YEAR, type GameState } from '../src/sim/types';

/** A settlement left to grow: people come on their own, and every year someone is called with Sparks. */
export function run(seed: number, years: number): GameState {
  const s = foundSettlement({ seed, name: 'Testbrook' });
  for (let d = 0; d < years * DAYS_PER_YEAR; d++) {
    stepDay(s);
    if (d % DAYS_PER_YEAR === DAYS_PER_YEAR - 1) { s.sparks += 3; call(s, callOptions(s)[d % 3].id, true); }
  }
  return s;
}
