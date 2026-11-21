// The Chronicle: every notable thing that happens, written as it happens.
import type { EntryKind, GameState, Entry } from './types';
import { DAYS_PER_YEAR } from './types';
import { yearOf } from './world';

export function log(
  s: GameState,
  kind: EntryKind,
  text: string,
  people: number[] = [],
  weight = 2,
  yearName?: string,
): Entry {
  const entry: Entry = { id: s.nextId.entry++, day: s.day, kind, text, people, weight, yearName };
  s.chronicle.push(entry);
  for (const pid of people) {
    const p = s.people[pid];
    if (p) p.memories.push(entry.id);
  }
  return entry;
}

/** Tokens the UI turns into clickable names. */
export const P = (id: number) => `{p:${id}}`;
export const F = (id: number) => `{f:${id}}`;

const QUIET_YEARS = ['A Quiet Year', 'The Year of Small Things', 'A Gentle Year', 'The Year Nothing Burned'];

/** Name a year after its weightiest event, unless the player already named it. */
export function nameYear(s: GameState, year: number): void {
  if (s.yearNames[year]) return;
  const start = (year - 1) * DAYS_PER_YEAR;
  const end = start + DAYS_PER_YEAR;
  let best: Entry | undefined;
  let arrivals = 0;
  let births = 0;
  let deaths = 0;
  for (let i = s.chronicle.length - 1; i >= 0; i--) {
    const e = s.chronicle[i];
    if (e.day < start) break;
    if (e.day >= end) continue;
    if (e.kind === 'arrival') arrivals++;
    if (e.kind === 'birth') births++;
    if (e.kind === 'death') deaths++;
    if (e.yearName && (!best || e.weight > best.weight || (e.weight === best.weight && e.id < best.id))) best = e;
  }
  let name: string;
  if (best && best.weight >= 5) name = best.yearName!;
  else if (deaths >= 4) name = 'The Year of Many Graves';
  else if (arrivals >= 5) name = s.lore?.known.some((k) => k.id === 'wheel') ? 'The Year of Many Wagons' : 'The Year of Many Newcomers';
  else if (births >= 4) name = 'The Year of Cradles';
  else if (best && best.weight >= 4) name = best.yearName!;
  else name = QUIET_YEARS[year % QUIET_YEARS.length];
  s.yearNames[year] = name;
}

export function currentYearName(s: GameState): string | undefined {
  return s.yearNames[yearOf(s.day)];
}

export function entriesSince(s: GameState, firstEntryId: number): Entry[] {
  return s.chronicle.filter((e) => e.id >= firstEntryId);
}
