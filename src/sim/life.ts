// The lives of the settlers: love, children, sickness, accidents, old age,
// grief. Darkness scales the avoidable deaths and the way they're told.
import { F, log, P } from './chronicle';
import { assignJobs } from './economy';
import { DREAM_LABEL, childOf, nameChild } from './people';
import { hasLaw, lawMood } from './society';
import { boost } from './ages';
import { townMood } from './town';
import { placesMood } from './places';
import { temperature } from './weather';
import { layToRest, smallRites } from './traditions';
import { orphanPets } from './animals';
import { itemsOf, passHeirlooms, weddingKeepsake } from './items';
import { moveIn } from './planner';
import { chance, int, pick, rand } from './rng';
import { DAYS_PER_YEAR, type GameState, type Person } from './types';
import {
  ageOf, darkFactor, hasTrait, isBlessed, isCloseKin, objectPronoun, possessive, present, pronoun, residents,
  seasonIndex, tone,
} from './world';

const YEAR = DAYS_PER_YEAR;

// ---------------------------------------------------------------------------
// Death

export function killPerson(s: GameState, p: Person, cause: string, text: string, weightBonus = 0) {
  if (!p.alive) return;
  p.alive = false;
  p.died = s.day;
  p.cause = cause;
  p.sick = undefined;
  p.injured = undefined;
  p.pregnant = undefined;
  const age = ageOf(s, p);

  let weight = 3 + weightBonus + Math.min(3, Math.floor(p.renown / 25));
  if (p.origin === 'founder') weight += 1;
  if (p.patron) weight += 2;
  if (age < 16) weight += 1;
  log(s, 'death', text, [p.id], Math.min(10, weight), `The Year ${p.first} Died`);

  if (p.spouse !== undefined) {
    const sp = s.people[p.spouse];
    if (sp && sp.spouse === p.id) {
      sp.spouse = undefined;
      sp.widowed = s.day;
      sp.mood -= 40;
    }
    p.spouse = undefined;
  }
  if (p.courting) {
    const other = s.people[p.courting.with];
    if (other) other.courting = undefined;
    p.courting = undefined;
  }
  for (const id of [...p.children, ...p.parents]) {
    const k = s.people[id];
    if (k?.alive) k.mood -= 25;
  }
  bury(s, p);
  rehomeOrphans(s, p);
  orphanPets(s, p);
  passHeirlooms(s, p);
}

function bury(s: GameState, p: Person) {
  if (p.away !== undefined) return; // died far from home: laid to rest there
  layToRest(s, p);
}

function rehomeOrphans(s: GameState, dead: Person) {
  for (const cid of dead.children) {
    const c = s.people[cid];
    if (!c || !c.alive || ageOf(s, c) >= 16) continue;
    const parentsAlive = c.parents.some((pid) => s.people[pid]?.alive && s.people[pid]?.away === undefined);
    if (parentsAlive) continue;
    // Grandparents, aunts and uncles, grown siblings — or a kind neighbour.
    const kin: Person[] = [];
    for (const pid of c.parents) {
      const parent = s.people[pid];
      if (!parent) continue;
      for (const gid of parent.parents) kin.push(s.people[gid]);
      for (const gid of parent.parents) for (const aid of s.people[gid]?.children ?? []) if (aid !== pid) kin.push(s.people[aid]);
    }
    for (const sid of dead.children) if (sid !== cid) kin.push(s.people[sid]);
    const carers = kin.filter((k) => k && k.alive && k.away === undefined && ageOf(s, k) >= 18 && k.home !== undefined);
    let carer = carers.sort((a, b) => (b.traits.includes('kind') ? 1 : 0) - (a.traits.includes('kind') ? 1 : 0))[0];
    let neighbour = false;
    if (!carer) {
      const adults = present(s).filter((k) => ageOf(s, k) >= 20 && k.home !== undefined && k.id !== dead.id);
      adults.sort((a, b) => Number(b.traits.includes('kind')) - Number(a.traits.includes('kind')) || a.children.length - b.children.length);
      carer = adults[0];
      neighbour = true;
    }
    if (!carer) continue;
    c.home = carer.home;
    if (!carer.children.includes(c.id)) carer.children.push(c.id);
    if (!c.parents.includes(carer.id) && c.parents.length < 4) c.parents.push(carer.id);
    log(
      s, 'orphan',
      neighbour
        ? `${P(c.id)}, orphaned, was taken in by ${P(carer.id)}, who had no blood tie to the child but a place by the fire.`
        : `${P(c.id)} went to live with ${P(carer.id)} after losing both parents.`,
      [c.id, carer.id], 3,
    );
  }
}

/** How the dead are seen off, after "came to see her …". */
const SEEN_OFF: Record<string, string> = { burial: 'buried', cremation: 'onto the pyre', sky: 'carried up to the platform', tomb: 'laid in the tomb', river: 'set out on the river' };
/** Who grieves a child: everyone, in a small place; the family, in a big one. */
const GRIEF: Record<GameState['stage'], string> = {
  settlement: 'The whole settlement grieved.',
  village: 'The whole village grieved.',
  town: 'The street went quiet for days.',
  city: 'Neighbours left food at the family’s door for weeks.',
  metropolis: 'Neighbours left food at the family’s door for weeks.',
};

function deathText(s: GameState, p: Person, cause: 'old' | 'illness' | 'injury' | 'childbirth' | 'infant' | 'hunger'): string {
  const t = tone(s);
  const age = ageOf(s, p);
  const name = P(p.id);
  switch (cause) {
    case 'old':
      return pick(s.rng, [
        `${name} died in ${possessive(p)} sleep at ${age}, after a long life.`,
        `${name} passed away at ${age}. ${s.stage === 'settlement' || s.stage === 'village' ? `Half the ${s.stage} came to see ${objectPronoun(p)} ${SEEN_OFF[s.traditions.dead?.custom ?? 'burial']}.` : `The whole street came out to see ${objectPronoun(p)} ${SEEN_OFF[s.traditions.dead?.custom ?? 'burial']}.`}`,
        `Old ${name} died quietly at ${age}, by the fire, in the middle of a story.`,
      ]);
    case 'illness':
      return t === 'grim'
        ? pick(s.rng, [`Fever took ${name} at ${age}. ${pronoun(p)[0].toUpperCase() + pronoun(p).slice(1)} burned for days before the end.`, `${name} coughed ${possessive(p)} way into the grave at ${age}.`])
        : pick(s.rng, [`${name} died of a fever at ${age}.`, `Sickness took ${name} at ${age}.`]);
    case 'injury':
      return t === 'grim'
        ? `${name} died of ${possessive(p)} wounds at ${age}. The healer could do nothing but hold ${possessive(p)} hand.`
        : `${name} was killed in an accident at ${age}.`;
    case 'childbirth':
      return t === 'grim'
        ? `${name} bled out giving birth. ${pronoun(p)[0].toUpperCase() + pronoun(p).slice(1)} was ${age}.`
        : `${name} died in childbirth at ${age}.`;
    case 'infant':
      return t === 'grim'
        ? `Little ${name} did not live to see ${possessive(p)} next season. ${smallRites(s, objectPronoun(p))}`
        : `${name}, only ${age < 1 ? 'a baby' : age === 1 ? 'a year old' : `${age} years old`}, fell ill and died. ${GRIEF[s.stage]}`;
    case 'hunger':
      return `${name} starved during the hunger. ${pronoun(p)[0].toUpperCase() + pronoun(p).slice(1)} was ${age}.`;
  }
}

/** Yearly chance of dying of "natural" causes at a given age. */
function annualMortality(s: GameState, age: number): number {
  if (age < 5) return 0.025 * (darkFactor(s) ** 1.3);
  if (age < 16) return 0.003 * darkFactor(s);
  return 0.0012 * Math.exp(0.088 * (age - 20)) * (age < 55 ? Math.max(0.4, darkFactor(s)) : 1);
}

// ---------------------------------------------------------------------------
// Daily life

export function lifeDay(s: GameState) {
  const hungry = s.flags.hungerSince !== undefined;
  const hasHealer = present(s).some((p) => p.job === 'healer' && !p.sick);
  // What's been learned about sickness, and healers' huts to nurse people in.
  const huts = s.buildings.filter((b) => b.kind === 'healer' && b.built && !b.removed).length;
  const healing = boost(s, 'health') * (1 + Math.min(3, huts) * 0.12);
  const people = present(s);
  const dark = darkFactor(s);

  for (const p of people) {
    if (!p.alive) continue;
    const age = ageOf(s, p);
    const blessed = isBlessed(s, p);
    const daysOld = s.day - p.born;

    if (daysOld > 0 && daysOld % YEAR === 0) birthday(s, p, age);

    // Old age and other natural deaths.
    let m = annualMortality(s, age) / YEAR;
    if (blessed) m *= 0.5;
    if (hasTrait(p, 'frail')) m *= 1.3;
    if (hasTrait(p, 'strong')) m *= 0.85;
    if (p.health < 40) m *= 1 + (40 - p.health) / 30;
    if (chance(s.rng, m)) {
      const cause = age >= 55 ? 'old' : age < 5 ? 'infant' : 'illness';
      killPerson(s, p, cause === 'old' ? 'old age' : 'sickness', deathText(s, p, cause));
      continue;
    }
    if (hungry && p.health <= 1 && tone(s) !== 'gentle' && chance(s.rng, 0.05)) {
      killPerson(s, p, 'hunger', deathText(s, p, 'hunger'), 1);
      continue;
    }

    // Illness.
    if (p.sick) {
      if (s.day >= p.sick.until) {
        if (p.sick.severity > 0.9) log(s, 'recovery', `${P(p.id)} recovered from the fever, thinner but alive.`, [p.id], 2);
        p.sick = undefined;
      } else {
        let d = p.sick.severity * (p.sick.plague ? 0.0055 : 0.0012) * dark;
        if (p.sick.plague && hasLaw(s, 'fever-huts')) d *= 0.7;
        if (s.flags.healerUntil !== undefined && s.day < s.flags.healerUntil) d *= 0.5;
        if (age < 5 || age >= 60) d *= 1.8;
        if (hasHealer) d *= 0.5;
        d /= healing;
        if (blessed) d *= 0.4;
        if (chance(s.rng, d)) {
          if (p.sick.plague && s.plague) s.plague.deaths++;
          killPerson(s, p, p.sick.plague ? s.plague?.name ?? 'plague' : 'fever', deathText(s, p, age < 5 ? 'infant' : 'illness'), 1);
          continue;
        }
        p.health = Math.max(5, p.health - p.sick.severity * 0.6);
      }
    } else {
      const temp = temperature(s);
      let ill = 0.0005 * (temp < 5 ? 1.5 + (5 - temp) * 0.04 : 1) * (hungry ? 2 : 1) * (age < 5 || age >= 60 ? 1.6 : 1);
      if (hasTrait(p, 'frail')) ill *= 1.6;
      if (hasTrait(p, 'strong')) ill *= 0.7;
      if (blessed) ill *= 0.5;
      if (chance(s.rng, ill)) {
        const severity = rand(s.rng);
        p.sick = { until: s.day + int(s.rng, 5, 40), severity };
        if (severity > 0.9) log(s, 'illness', `${P(p.id)} fell gravely ill.`, [p.id], 2);
      }
      if (!hungry && p.health < 100) p.health = Math.min(100, p.health + 0.4);
    }

    // Accidents at work.
    if (p.injured) {
      if (s.day >= p.injured.until) p.injured = undefined;
    } else if (age >= 14) {
      const risk: Partial<Record<Person['job'], number>> = { woodcutter: 0.0005, builder: 0.0004, fisher: 0.0003, smith: 0.0003, farmer: 0.0002 };
      let r = (risk[p.job] ?? 0.0001) * (hasTrait(p, 'strong') ? 0.7 : 1) * (blessed ? 0.5 : 1);
      if (hasTrait(p, 'brave')) r *= 1.2;
      if (chance(s.rng, r)) injure(s, p, dark);
    }
    if (!p.alive) continue;

    // Pregnancy and birth.
    if (p.pregnant && s.day >= p.pregnant.due) giveBirth(s, p);
    if (!p.alive) continue;

    // Love.
    if (age >= 16) {
      if (p.courting) courtshipTick(s, p);
      else if (p.spouse === undefined && age <= 60) seekLove(s, p, age);
      if (p.spouse !== undefined) conceive(s, p, age, hungry, blessed);
    }

    // Mood drifts toward how life is going.
    let base = 10;
    if (hasTrait(p, 'cheerful')) base += 15;
    if (hasTrait(p, 'gloomy')) base -= 15;
    base += p.home === undefined ? -12 : 4;
    if (p.spouse !== undefined) base += 8;
    if (hungry) base -= 20;
    base += lawMood(s, p);
    base += townMood(s, p) + placesMood(s, p);
    if (itemsOf(s, p.id).length) base += 3; // something of their family's to hold onto
    if (p.sick || p.injured) base -= 10;
    base += Math.min(10, (s.stores.goods / Math.max(1, people.length)) * 2);
    p.mood += (base - p.mood) * 0.02;
  }
}

function birthday(s: GameState, p: Person, age: number) {
  if (age === 16) {
    log(s, 'comingOfAge', pick(s.rng, [
      `${P(p.id)} came of age at sixteen.`,
      `${P(p.id)} turned sixteen and was counted among the grown.`,
    ]), [p.id], 1);
    assignJobs(s);
  }
  if (p.job !== 'elder' && p.job !== 'child' && s.day - p.jobSince === YEAR * 20 && p.dream === 'craft' && !p.dreamMet) {
    p.dreamMet = true;
    p.renown += 10;
    log(s, 'dream', `After twenty years at the work, ${P(p.id)} was called a master ${p.job}. ${pronoun(p)[0].toUpperCase() + pronoun(p).slice(1)} had always wanted that.`, [p.id], 3);
  }
  if (p.dream === 'remembered' && !p.dreamMet && p.renown >= 50) {
    p.dreamMet = true;
    log(s, 'dream', `Everyone in ${s.name} knew the name ${F(p.id)}. ${pronoun(p)[0].toUpperCase() + pronoun(p).slice(1)} had wanted to be remembered, and would be.`, [p.id], 3);
  }
}

function injure(s: GameState, p: Person, dark: number) {
  const what: Record<string, string[]> = {
    woodcutter: ['was crushed by a falling tree', 'split a foot open with an axe'],
    builder: ['fell from a half-built roof', 'was struck by a swinging beam'],
    fisher: ['was dragged under by the current', 'gashed a leg on the rocks'],
    smith: ['was burned by a spill of molten bronze', 'crushed a hand at the anvil'],
    farmer: ['was gored by an ox', 'cut a leg badly with a sickle'],
  };
  const event = pick(s.rng, what[p.job] ?? ['fell and broke a leg', 'was bitten by a wild dog']);
  if (chance(s.rng, Math.min(0.5, 0.07 * dark))) {
    killPerson(s, p, 'accident', tone(s) === 'grim'
      ? `${P(p.id)} ${event} and died of it.`
      : `${P(p.id)} ${event}, and did not survive.`, 1);
    return;
  }
  const days = int(s.rng, 15, 90);
  p.injured = { until: s.day + days };
  p.health = Math.max(20, p.health - 30);
  if (days >= 50) log(s, 'injury', `${P(p.id)} ${event}.`, [p.id], 2);
}

// ---------------------------------------------------------------------------
// Love and family

function attracted(a: Person, b: Person): boolean {
  const wants = (x: Person, y: Person) =>
    x.orientation === 'bi' || (x.orientation === 'straight' ? x.sex !== y.sex : x.sex === y.sex);
  return wants(a, b) && wants(b, a);
}

function compatibility(a: Person, b: Person): number {
  let c = 1;
  for (const t of a.traits) if (b.traits.includes(t)) c += 0.5;
  if (a.traits.includes('cheerful') && b.traits.includes('gloomy')) c -= 0.3;
  if (a.traits.includes('cruel') || b.traits.includes('cruel')) c -= 0.3;
  if (a.traits.includes('kind') || b.traits.includes('kind')) c += 0.3;
  return Math.max(0.1, c);
}

function seekLove(s: GameState, p: Person, age: number) {
  let rate = 0.004;
  if (hasTrait(p, 'gregarious')) rate *= 1.5;
  if (hasTrait(p, 'shy')) rate *= 0.6;
  if (p.widowed !== undefined && s.day - p.widowed < YEAR * 2) rate *= 0.2;
  if (isBlessed(s, p)) rate *= 1.3;
  if (!chance(s.rng, rate)) return;
  const candidates = present(s).filter((o) => {
    if (o.id === p.id || o.spouse !== undefined || o.courting || o.preparing) return false;
    const oa = ageOf(s, o);
    if (oa < 16 || oa > 62) return false;
    const gap = Math.abs(oa - age);
    if (gap > (Math.min(oa, age) > 35 ? 18 : 10)) return false;
    return attracted(p, o) && !isCloseKin(s, p, o);
  });
  if (!candidates.length) return;
  const weights = candidates.map((o) => [o, compatibility(p, o)] as const);
  let total = 0;
  for (const [, w] of weights) total += w;
  let roll = rand(s.rng) * total;
  let match = candidates[0];
  for (const [o, w] of weights) { roll -= w; if (roll < 0) { match = o; break; } }
  const until = s.day + int(s.rng, 40, 320);
  p.courting = { with: match.id, since: s.day, until };
  match.courting = { with: p.id, since: s.day, until };
  log(s, 'courtship', pick(s.rng, [
    `${P(p.id)} and ${P(match.id)} were seen walking together by the river.`,
    `${P(p.id)} began courting ${P(match.id)}.`,
    `${P(match.id)} caught the eye of ${P(p.id)}, and the whole settlement noticed.`,
  ]), [p.id, match.id], 1);
}

function courtshipTick(s: GameState, p: Person) {
  const c = p.courting!;
  const other = s.people[c.with];
  if (!other || !other.alive || other.away !== undefined || other.courting?.with !== p.id) {
    p.courting = undefined;
    return;
  }
  if (s.day < c.until || p.id > other.id) return;
  const fit = compatibility(p, other);
  if (chance(s.rng, Math.min(0.92, 0.55 + fit * 0.15))) wed(s, p, other);
  else {
    p.courting = undefined;
    other.courting = undefined;
    p.mood -= 10;
    other.mood -= 10;
    log(s, 'parting', pick(s.rng, [
      `${P(p.id)} and ${P(other.id)} went their separate ways.`,
      `It didn't work out between ${P(p.id)} and ${P(other.id)}.`,
    ]), [p.id, other.id], 1);
  }
}

function wed(s: GameState, a: Person, b: Person) {
  a.courting = undefined;
  b.courting = undefined;
  a.spouse = b.id;
  b.spouse = a.id;
  a.mood += 30;
  b.mood += 30;
  const season = seasonIndex(s.day);
  const where = ['under the blossoming trees', 'in the long summer light', 'at the harvest fire', 'in the snow, by the hearth'][season];
  log(s, 'wedding', `${P(a.id)} and ${P(b.id)} were wed ${where}.`, [a.id, b.id], 4, `The Year ${a.first} and ${b.first} Wed`);
  weddingKeepsake(s, a, b);
  for (const x of [a, b]) {
    if (x.dream === 'love' && !x.dreamMet) x.dreamMet = true;
  }
  // Move in together: the one living alone (or with only their children) keeps the home.
  const homeOf = (x: Person) => (x.home === undefined ? [] : residents(s, x.home).filter((r) => r.id !== x.id && ageOf(s, r) >= 16 && !x.children.includes(r.id)));
  if (a.home !== undefined && homeOf(a).length === 0) moveIn(s, s.buildings[a.home], [b.id]);
  else if (b.home !== undefined && homeOf(b).length === 0) moveIn(s, s.buildings[b.home], [a.id]);
  else if (a.home !== undefined) b.home = a.home; // crowded until the planner finds them a place
}

function conceive(s: GameState, p: Person, age: number, hungry: boolean, blessed: boolean) {
  if (p.sex !== 'f' || p.pregnant || age > 44) return;
  const partner = s.people[p.spouse!];
  if (!partner || partner.sex !== 'm' || partner.away !== undefined) return;
  const kids = p.children.filter((c) => s.people[c]?.parents.includes(p.id) && s.people[c]?.parents[0] === p.id).length;
  const youngest = p.children.map((c) => s.people[c]).filter(Boolean).reduce((m, c) => Math.min(m, s.day - c.born), Infinity);
  let rate = 0.0014 * 0.7 ** kids;
  if (youngest < YEAR) rate *= 0.15;
  if (age > 38) rate *= 0.5;
  if (hungry) rate *= 0.4;
  if (blessed) rate *= 1.3;
  if (p.dream === 'family' || partner.dream === 'family') rate *= 1.3;
  if (chance(s.rng, rate)) p.pregnant = { due: s.day + 270, father: partner.id };
}

function giveBirth(s: GameState, mother: Person) {
  const father = s.people[mother.pregnant!.father];
  mother.pregnant = undefined;
  const dark = darkFactor(s);
  const twins = chance(s.rng, 0.02);
  const babies: Person[] = [];
  for (let i = 0; i < (twins ? 2 : 1); i++) {
    const sex = rand(s.rng) < 0.5 ? 'f' : 'm';
    const child = childOf(s, mother, father, nameChild(s, mother, father, sex), sex);
    child.home = mother.home;
    child.faith = mother.faith ?? father?.faith; // children are raised in their parents' faith
    babies.push(child);
  }
  const names = babies.map((b) => P(b.id));
  const kind = (b: Person) => (b.sex === 'f' ? 'daughter' : 'son');
  const parents = father ? `${P(mother.id)} and ${P(father.id)}` : P(mother.id);
  const text = twins
    ? `${parents} welcomed twins: ${names[0]} and ${names[1]}.`
    : `${parents} welcomed a ${kind(babies[0])}, ${names[0]}.`;
  const people = [mother.id, ...(father ? [father.id] : []), ...babies.map((b) => b.id)];
  const lineage = babies[0].lineage ? 1 : 0;
  log(s, 'birth', text, people, (twins ? 5 : 2) + lineage, twins ? 'The Year of the Twins' : `The Year ${babies[0].first} Was Born`);
  mother.mood += 20;
  if (father) father.mood += 20;

  const big = (x: Person | undefined) => x && x.dream === 'family' && !x.dreamMet && x.children.length >= 4;
  for (const x of [mother, father]) {
    if (big(x)) {
      x!.dreamMet = true;
      log(s, 'dream', `With ${x!.children.length} children underfoot, ${P(x!.id)} had the big family ${pronoun(x!)} always wanted.`, [x!.id], 2);
    }
  }

  // The dangers of childbirth.
  if (chance(s.rng, 0.012 * (dark < 0.2 ? 0 : dark) / boost(s, 'births'))) {
    killPerson(s, mother, 'childbirth', deathText(s, mother, 'childbirth'), 1);
  } else if (tone(s) === 'grim' && chance(s.rng, 0.03)) {
    const b = babies[0];
    killPerson(s, b, 'stillbirth', `${P(b.id)} was born still. ${P(mother.id)} would not let go of the small body until dawn.`, 0);
  }
}

export const dreamText = (p: Person) => DREAM_LABEL[p.dream];
