// The player's powers, paid for with Sparks (the one thing your work earns). Acts nudge the settlement; they
// never run it. Anything that brings people or sends them away waits for dawn.
import { log, P } from './chronicle';
import { settleParty } from './arrivals';
import { departQuest } from './quests';
import { rand } from './rng';
import { enactLaw, foundFaith, hasLaw, opinion, repealLaw } from './society';
import type { LawId, TenetId } from './types';
import { DAYS_PER_YEAR, type GameState, type Party, type PersonDraft, type QuestKind } from './types';
import { ageOf, yearOf } from './world';
import { arriveCalled } from './callers';
import { nextCost } from './ages';

export type ActId = 'bless' | 'name' | 'settler' | 'quest' | 'law' | 'prophet' | 'inspire';

export const ACTS: { id: ActId; label: string; cost: number; blurb: string }[] = [
  { id: 'bless', label: 'Bless', cost: 1, blurb: 'A year of good luck and health for one person.' },
  { id: 'name', label: 'Name', cost: 1, blurb: 'Name this year, or a newborn.' },
  { id: 'settler', label: 'Create a Settler', cost: 3, blurb: 'Someone of your making arrives at dawn.' },
  { id: 'quest', label: 'Send on a Quest', cost: 2, blurb: 'Send someone (and companions) out into the world.' },
  { id: 'law', label: 'Whisper a Law', cost: 4, blurb: "Put a law in the leader's head, or talk them out of one. Costs more if they'd hate it." },
  { id: 'prophet', label: 'Raise a Prophet', cost: 6, blurb: 'Someone wakes certain of something, and founds a faith you shape.' },
  { id: 'inspire', label: 'Inspire', cost: 3, blurb: "Give someone an idea that won't let go. The next discovery is likely to come from their work, and sooner." },
];

export const actCost = (id: ActId) => ACTS.find((a) => a.id === id)!.cost;

export type ActResult = { ok: true } | { ok: false; reason: string };

function spend(s: GameState, id: ActId): ActResult {
  const cost = actCost(id);
  if (s.sparks < cost) return { ok: false, reason: `You need ${cost} Spark${cost === 1 ? '' : 's'} for that.` };
  s.sparks -= cost;
  return { ok: true };
}

export function bless(s: GameState, personId: number): ActResult {
  const p = s.people[personId];
  if (!p || !p.alive) return { ok: false, reason: 'They are no longer living.' };
  if (p.away !== undefined) return { ok: false, reason: 'They are far away.' };
  const paid = spend(s, 'bless');
  if (!paid.ok) return paid;
  p.blessedUntil = Math.max(p.blessedUntil ?? 0, s.day) + DAYS_PER_YEAR;
  p.mood += 15;
  if (p.sick) p.sick.severity *= 0.5;
  log(s, 'patron', `A warmth settled over ${P(p.id)}. Nobody could say why, but ${p.sex === 'f' ? 'she' : 'he'} smiled more that year.`, [p.id], 2);
  return { ok: true };
}

export function inspire(s: GameState, personId: number): ActResult {
  const p = s.people[personId];
  if (!p || !p.alive) return { ok: false, reason: 'They are no longer living.' };
  if (p.away !== undefined) return { ok: false, reason: 'They are far away.' };
  if (ageOf(s, p) < 16) return { ok: false, reason: 'They are too young.' };
  const paid = spend(s, 'inspire');
  if (!paid.ok) return paid;
  s.lore.nudge = { person: p.id, until: s.day + 3 * DAYS_PER_YEAR };
  s.lore.points += nextCost(s) * 0.35;
  s.lore.last = Math.min(s.lore.last ?? -999, s.day - 30);
  log(s, 'dream', `${P(p.id)} woke with an idea that would not let go, and could talk of nothing else for weeks.`, [p.id], 3);
  return { ok: true };
}

export function nameYear(s: GameState, name: string): ActResult {
  const clean = name.trim().slice(0, 60);
  if (!clean) return { ok: false, reason: 'Give the year a name.' };
  const paid = spend(s, 'name');
  if (!paid.ok) return paid;
  const year = yearOf(s.day);
  const title = /^the year/i.test(clean) ? clean : `The Year of ${clean}`;
  s.yearNames[year] = title;
  s.playerNamedYears[year] = true;
  log(s, 'naming', `People began calling it ${title}, though no one remembered who said it first.`, [], 2);
  return { ok: true };
}

export function nameChild(s: GameState, personId: number, first: string): ActResult {
  const p = s.people[personId];
  const clean = first.trim().slice(0, 24);
  if (!p || !p.alive || ageOf(s, p) >= 1) return { ok: false, reason: 'Only a baby under a year old can be named.' };
  if (!clean) return { ok: false, reason: 'Choose a name.' };
  const paid = spend(s, 'name');
  if (!paid.ok) return paid;
  const old = p.first;
  p.first = clean;
  log(s, 'naming', `The baby everyone had been calling ${old} became ${P(p.id)}. ${p.sex === 'f' ? 'Her' : 'His'} parents said the name came to them in a dream.`, [p.id], 2);
  return { ok: true };
}

export function createSettler(s: GameState, draft: PersonDraft): ActResult {
  if (!draft.first.trim() || !draft.family.trim()) return { ok: false, reason: 'Your settler needs a full name.' };
  if (draft.age < 16 || draft.age > 70) return { ok: false, reason: 'Settlers arrive between 16 and 70.' };
  const paid = spend(s, 'settler');
  if (!paid.ok) return paid;
  const party: Party = {
    id: s.nextId.party++,
    story: draft.backstory?.trim() || `${draft.first} came of ${draft.sex === 'f' ? 'her' : 'his'} own accord.`,
    people: [{ ...draft, first: draft.first.trim(), family: draft.family.trim(), patron: true }],
  };
  s.pending.push({ kind: 'party', party, patron: true });
  return { ok: true };
}

export function sendOnQuest(s: GameState, leaderId: number, memberIds: number[], kind: QuestKind): ActResult {
  const all = [leaderId, ...memberIds];
  for (const id of all) {
    const p = s.people[id];
    if (!p || !p.alive || p.away !== undefined) return { ok: false, reason: 'Everyone going must be here and alive.' };
    if (ageOf(s, p) < 16) return { ok: false, reason: 'Children cannot be sent on quests.' };
    if (p.preparing) return { ok: false, reason: `${p.first} is already promised to a quest.` };
  }
  const paid = spend(s, 'quest');
  if (!paid.ok) return paid;
  for (const id of all) s.people[id].preparing = true;
  s.pending.push({ kind: 'quest', leader: leaderId, members: memberIds, questKind: kind });
  return { ok: true };
}

/** Welcome one party from a waiting group. The other two move on. */
export function welcomeParty(s: GameState, partyId: number, now: boolean): ActResult {
  const gi = s.arrivals.findIndex((g) => g.some((p) => p.id === partyId));
  if (gi < 0) return { ok: false, reason: 'They have already moved on.' };
  const party = s.arrivals[gi].find((p) => p.id === partyId)!;
  s.arrivals.splice(gi, 1);
  if (now) settleParty(s, party);
  else s.pending.push({ kind: 'party', party });
  return { ok: true };
}

/** Groups nobody chose from: the settlement takes one party from each in on its own. */
export function settleUnchosen(s: GameState, keep = 0) {
  while (s.arrivals.length > keep) {
    const group = s.arrivals.shift()!;
    settleParty(s, group[Math.floor(rand(s.rng) * group.length)]);
  }
}

/** Dawn: everything queued during the break happens as work begins. */
export function applyDawn(s: GameState) {
  settleUnchosen(s);
  applyPending(s);
}

/** Carry out queued acts now (used directly when an act is made mid-session). */
export function applyPending(s: GameState) {
  const queue = s.pending;
  s.pending = [];
  for (const act of queue) {
    if (act.kind === 'party') { if (act.party.call) arriveCalled(s, act.party); else settleParty(s, act.party, act.patron); }
    else {
      const leader = s.people[act.leader];
      const members = act.members.map((id) => s.people[id]).filter((m) => m?.alive && m.away === undefined);
      if (leader?.alive && leader.away === undefined) departQuest(s, leader, members, act.questKind, true);
      else for (const m of members) m.preparing = undefined;
    }
  }
}

/** What whispering this law would cost: more if the leader would hate it. */
export function lawCost(s: GameState, id: LawId): number {
  const leader = s.leader ? s.people[s.leader.person] : undefined;
  if (!leader) return actCost('law');
  const o = opinion(leader, id);
  const wants = hasLaw(s, id) ? -o : o; // repealing something they like is the hard sell
  return actCost('law') + (wants < 0 ? 2 * -wants : 0);
}

export function whisperLaw(s: GameState, id: LawId): ActResult {
  const leader = s.leader ? s.people[s.leader.person] : undefined;
  if (!leader || !leader.alive) return { ok: false, reason: 'No one leads the settlement yet.' };
  const cost = lawCost(s, id);
  if (s.sparks < cost) return { ok: false, reason: `You need ${cost} Sparks for that.` };
  s.sparks -= cost;
  if (hasLaw(s, id)) repealLaw(s, id, { patron: true });
  else enactLaw(s, id, { patron: true });
  return { ok: true };
}

export function raiseProphet(s: GameState, personId: number, tenets: TenetId[], name?: string): ActResult {
  const p = s.people[personId];
  if (!p || !p.alive || p.away !== undefined || ageOf(s, p) < 16) return { ok: false, reason: 'Choose a grown person who is here.' };
  if (tenets.length < 1 || tenets.length > 2) return { ok: false, reason: 'Choose one or two teachings.' };
  const free = !!s.flags.freeProphet;
  if (!free) {
    const paid = spend(s, 'prophet');
    if (!paid.ok) return paid;
  }
  s.flags.freeProphet = false;
  foundFaith(s, p, tenets, name, { patron: true });
  return { ok: true };
}
