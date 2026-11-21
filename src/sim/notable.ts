// Who and what the Chronicle should focus on. A small settlement's every
// quarrel matters; in a town of thousands, the Chronicle follows the people
// who shape it, the people the player follows, and the events that matter.
import type { ChronicleSettings, Entry, EntryKind, GameState } from './types';

const cache = new WeakMap<object, { day: number; n: number; set: Set<number> }>();

/** The people who matter most to the story now. */
export function notableSet(s: GameState): Set<number> {
  const hit = cache.get(s);
  if (hit && hit.day === s.day && hit.n === s.people.length) return hit.set;
  const set = new Set<number>();
  const living = s.people.filter((p) => p.alive && !p.left);
  for (const p of living) {
    if (p.followed || p.patron || p.lineage || p.hook) set.add(p.id);
  }
  // Family of the people you follow.
  for (const p of living) {
    if (!p.followed) continue;
    if (p.spouse !== undefined) set.add(p.spouse);
    for (const c of p.children) set.add(c);
    for (const c of p.parents) set.add(c);
  }
  if (s.leader) set.add(s.leader.person);
  for (const id of s.council ?? []) set.add(id);
  for (const g of s.guilds) if (!g.gone && g.master !== undefined) set.add(g.master);
  for (const k of s.lore.known) if (k.by !== undefined) set.add(k.by);
  for (const f of s.faiths) if (!f.gone) set.add(f.founder);
  if (living.length < 600) for (const b of s.buildings) if (!b.removed && b.owner !== undefined) set.add(b.owner);
  // The best-known people.
  const top = Math.max(12, Math.round(living.length * 0.04));
  for (const p of living.slice().sort((a, b) => b.renown - a.renown).slice(0, top)) if (p.renown > 10) set.add(p.id);
  cache.set(s, { day: s.day, n: s.people.length, set });
  return set;
}

export const isNotable = (s: GameState, id: number) => notableSet(s).has(id);

/** How big an event must be to show for everyone, by the size of the place ('auto' focus). */
export function autoThreshold(s: GameState): number {
  return { settlement: 0, village: 2, town: 4, city: 5, metropolis: 6 }[s.stage];
}

export const CATEGORIES: { id: string; label: string; kinds: EntryKind[] }[] = [
  { id: 'family', label: 'Births and growing up', kinds: ['birth', 'comingOfAge', 'orphan', 'naming'] },
  { id: 'love', label: 'Love and weddings', kinds: ['courtship', 'wedding', 'parting'] },
  { id: 'death', label: 'Deaths', kinds: ['death'] },
  { id: 'health', label: 'Illness and injury', kinds: ['illness', 'recovery', 'injury', 'plague'] },
  { id: 'moments', label: 'Everyday moments', kinds: ['season', 'dream'] },
  { id: 'work', label: 'Building, work and trade', kinds: ['build', 'harvest', 'hunger', 'business', 'guild', 'fire'] },
  { id: 'faith', label: 'Faith and omens', kinds: ['faith', 'omen', 'petition'] },
  { id: 'rule', label: 'Leaders and laws', kinds: ['leader', 'law', 'stage'] },
  { id: 'ages', label: 'Discoveries and ages', kinds: ['discovery', 'age'] },
  { id: 'comings', label: 'Arrivals, quests and departures', kinds: ['arrival', 'patron', 'departure', 'return', 'lost', 'fortune', 'founding'] },
];
const CATEGORY_OF = new Map<EntryKind, string>();
for (const c of CATEGORIES) for (const k of c.kinds) CATEGORY_OF.set(k, c.id);

export const DEFAULT_CHRONICLE: ChronicleSettings = { focus: 'auto', hide: [] };

/** Whether an entry shows in the Chronicle, by the player's settings. */
export function shown(s: GameState, e: Entry, settings: ChronicleSettings = s.settings.chronicle ?? DEFAULT_CHRONICLE): boolean {
  if (settings.hide.includes(CATEGORY_OF.get(e.kind) ?? '')) return false;
  const cached = notableSet(s);
  const followed = (id: number) => { const p = s.people[id]; return !!p && (p.followed || p.patron || p.lineage); };
  // Following someone counts at once, not from tomorrow.
  const notable = { has: (id: number) => cached.has(id) || followed(id) };
  switch (settings.focus) {
    case 'everyone': return true;
    case 'followed': return e.people.some(followed) || e.weight >= 7 || e.kind === 'stage' || e.kind === 'age';
    case 'notable': return e.weight >= 6 || e.people.some((id) => notable.has(id)) || (!e.people.length && e.weight >= 3);
    case 'auto':
    default: {
      const bar = autoThreshold(s);
      if (e.weight >= bar) return true;
      if (e.people.some(followed)) return true; // everything about the people you follow
      if (e.people.some((id) => notable.has(id))) return e.weight >= Math.min(2, bar);
      return !e.people.length && e.weight >= Math.max(2, bar - 1);
    }
  }
}

/** In a town or bigger, minor goings-on of people the story isn't following aren't written down. */
export function worthRecording(s: GameState, people: number[], weight: number): boolean {
  if (weight > 1 || s.stage === 'settlement' || s.stage === 'village' || !people.length) return true;
  return people.some((id) => isNotable(s, id));
}
