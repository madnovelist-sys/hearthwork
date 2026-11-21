// Calamities: plague that moves through a crowded settlement, and fire that
// jumps from thatch to thatch. Darkness decides how deadly they are.
import { F, log, P } from './chronicle';
import { killPerson } from './life';
import { addBuilding, findSite, removeBuilding } from './planner';
import { hasLaw, plantFaithSeed } from './society';
import { beginSideAge } from './ages';
import { temperature } from './weather';
import { afterPlague } from './traditions';
import { chance, int, pick, range } from './rng';
import type { Building, GameState } from './types';
import { ageOf, darkFactor, isDwelling, present, residents, seasonIndex, tone } from './world';

const PLAGUE_NAMES = ['the Grey Cough', 'the Sweating Sickness', 'the Red Fever', 'the Shaking Sickness', 'the River Fever', 'the Spotted Fever'];

/** At the turn of a season: maybe a plague arrives. */
export function plagueSeason(s: GameState) {
  if (s.plague) return;
  const pop = present(s).length;
  if (pop < 20) return;
  let p = 0.012 * Math.sqrt(pop / 60);
  if (seasonIndex(s.day) === 3) p *= 1.5;
  if (hasLaw(s, 'fever-huts')) p *= 0.6;
  if (s.buildings.some((b) => b.kind === 'well' && b.built && !b.removed)) p *= 0.8;
  if (!chance(s.rng, Math.min(0.035, p))) return;
  startPlague(s);
}

export function startPlague(s: GameState) {
  const name = pick(s.rng, PLAGUE_NAMES);
  s.plague = { name, since: s.day, lastCase: s.day, cases: 0, deaths: 0 };
  const first = pick(s.rng, present(s).filter((p) => !p.sick));
  if (first) infect(s, first);
  const lines = {
    gentle: `${cap(name)} came to ${s.name}. People kept to their homes and waited for it to pass.`,
    balanced: `${cap(name)} came to ${s.name}, carried in by who knows what. ${first ? `${P(first.id)} was the first to fall sick.` : ''}`,
    grim: `${cap(name)} came to ${s.name}. ${first ? `${P(first.id)} was the first.` : ''} Doors were marked, and the healers stopped sleeping.`,
  };
  log(s, 'plague', lines[tone(s)], first ? [first.id] : [], 7, `The Year of ${name}`);
}

function infect(s: GameState, p: { id: number; sick?: { until: number; severity: number; plague?: boolean } }) {
  p.sick = { until: s.day + int(s.rng, 10, 28), severity: range(s.rng, 0.55, 1), plague: true };
  s.plague!.cases++;
  s.plague!.lastCase = s.day;
}

/** Each day of a plague: it spreads, and eventually burns itself out. */
export function plagueDay(s: GameState) {
  const pl = s.plague;
  if (!pl) return;
  const people = present(s);
  const sick = people.filter((p) => p.sick?.plague).length;
  const healers = people.some((p) => p.job === 'healer' && !p.sick);
  // It comes in from outside for the first months, then only passes from the sick to the well.
  const age = s.day - pl.since;
  let spread = (age < 120 ? 0.002 : 0) + 0.05 * (sick / Math.max(1, people.length));
  if (hasLaw(s, 'fever-huts')) spread *= 0.55;
  if (healers) spread *= 0.85;
  if (age > 200) spread *= 0.3; // the survivors are hardier
  if (age > 540) spread *= 0.3;
  for (const p of people) if (!p.sick && chance(s.rng, spread)) infect(s, p);
  if ((s.day - pl.lastCase > 40 && sick === 0) || age > 3 * 360) endPlague(s, false);
}

export function endPlague(s: GameState, answered: boolean) {
  const pl = s.plague;
  if (!pl) return;
  s.plague = undefined;
  for (const p of s.people) if (p.sick?.plague) p.sick = undefined;
  const toll = pl.deaths === 0 ? 'Not one person died of it.' : pl.deaths === 1 ? 'It took one life.' : `It took ${pl.deaths} lives.`;
  log(s, 'plague', answered
    ? `The fever broke all at once, in every house on the same night, as if someone had decided it was enough. ${toll}`
    : `${cap(pl.name)} burned itself out. ${toll}`, [], pl.deaths >= 5 ? 6 : 4);
  plantFaithSeed(s, answered ? 'hearth' : 'ancestors');
  afterPlague(s, pl.deaths);
  // A plague that took many lives gives its name to the times, if the world is grim enough.
  if (pl.deaths >= Math.max(8, present(s).length * 0.1)) {
    beginSideAge(s, 'plague', `Nobody who lived through ${pl.name} ever quite forgot it. People began to call it the Age of Plague.`);
  }
}

// ---------------------------------------------------------------------------
// Fire

/** Each day: a hearth gets out of hand somewhere, now and then. */
export function fireDay(s: GameState) {
  const season = seasonIndex(s.day);
  const hasWell = s.buildings.some((b) => b.kind === 'well' && b.built && !b.removed);
  for (const b of s.buildings) {
    if (b.removed || !b.built || b.burned) continue;
    if (b.burning !== undefined) { burn(s, b, hasWell); continue; }
    if (!flammable(b)) continue;
    let p = 0.000005;
    const w = s.weather;
    if (season === 1) p *= 1.4 + Math.min(3, (w?.dry ?? 0) / 15); // dry summers, worse in a drought
    if (temperature(s) < 3) p *= 1.5; // fires lit all day in the cold
    if (w?.sky === 'rain' || w?.sky === 'snow') p *= 0.4;
    if (w?.sky === 'storm') p *= 2.5; // lightning
    if (b.kind === 'kiln' || b.kind === 'furnace') p *= 3;
    if (chance(s.rng, p)) ignite(s, b, true);
  }
}

const flammable = (b: Building) => isDwelling(b.kind) || ['granary', 'kiln', 'furnace', 'stall', 'hall', 'dock', 'alehouse', 'healer', 'scribes', 'guildhall'].includes(b.kind);

export function ignite(s: GameState, b: Building, first: boolean) {
  b.burning = s.day + int(s.rng, 2, 4);
  if (!first) return;
  const owner = residents(s, b.id)[0];
  const where = owner ? `${P(owner.id)}'s home` : b.name ?? `the ${b.kind}`;
  log(s, 'fire', `Fire broke out in ${where}. The whole settlement ran with buckets.`, owner ? [owner.id] : [], 5, 'The Year of the Fire');
}

function burn(s: GameState, b: Building, hasWell: boolean) {
  // Spread to anything flammable within a tile.
  for (const o of s.buildings) {
    if (o === b || o.removed || !o.built || o.burned || o.burning !== undefined || !flammable(o)) continue;
    const near = o.x <= b.x + b.w && o.x + o.w >= b.x && o.y <= b.y + b.h && o.y + o.h >= b.y;
    if (near && chance(s.rng, hasWell ? 0.035 : 0.09)) ignite(s, o, false);
  }
  // Rain helps put it out.
  if ((s.weather?.sky === 'rain' || s.weather?.sky === 'storm' || s.weather?.sky === 'snow') && b.burning !== undefined) b.burning -= 1;
  if (s.day < (b.burning ?? 0)) return;
  // Burned out.
  b.burning = undefined;
  b.burned = true;
  // A great fire: many buildings in a few days.
  const run = s.day - (s.flags.lastBurn ?? -99) < 12 ? (s.flags.burnedRun ?? 0) + 1 : 1;
  s.flags.lastBurn = s.day;
  s.flags.burnedRun = run;
  if (run === 10) beginSideAge(s, 'ash', `The great fire left a scar of ash through the middle of ${s.name}, and for years afterward people dated things from it. They called it the Age of Ash.`);
  const inside = residents(s, b.id);
  const dark = darkFactor(s);
  for (const p of inside) {
    p.home = undefined;
    p.mood -= 25;
    if (ageOf(s, p) >= 3 && chance(s.rng, 0.02 * dark)) {
      killPerson(s, p, 'fire', tone(s) === 'grim'
        ? `${P(p.id)} went back into the burning house for something and did not come out.`
        : `${P(p.id)} died in the fire.`, 2);
    }
  }
  const firstLoss = s.day - (s.flags.lastFireLoss ?? -99) > 5;
  if (inside.length) s.flags.lastFireLoss = s.day;
  if (inside.length) {
    const site = findSite(s, 'tent');
    if (site) {
      const tent = addBuilding(s, 'tent', site.x, site.y);
      for (const p of inside) if (p.alive) p.home = tent.id;
    }
    if (firstLoss) log(s, 'fire', `${inside.filter((p) => p.alive).map((p) => F(p.id)).slice(0, 3).join(', ') || 'The family'} lost everything but what they were wearing.`, inside.map((p) => p.id), 3);
  }
  if (b.kind === 'granary') {
    s.stores.food *= 0.7;
    log(s, 'fire', `The granary burned, and a third of the stores with it.`, [], 4);
  }
}

/** Once a season: burned shells are cleared away to make room. */
export function clearRuins(s: GameState) {
  for (const b of s.buildings) {
    if (b.burned && !b.removed && chance(s.rng, 0.35)) removeBuilding(s, b);
  }
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
