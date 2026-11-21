// Newcomers. People come on their own when the settlement is doing well, or
// has work they can do: a kiln draws potters, a dock draws fishers, building
// draws journeymen. In hard times, few come. (Calling someone special with
// Sparks is in callers.ts.)
import { F, log, P } from './chronicle';
import { familyName } from './names';
import { createPerson, draftPerson } from './people';
import { pitchShelter } from './planner';
import { chance, int, pick, weighted } from './rng';
import { makeItem } from './items';
import { hasLaw } from './society';
import { boost } from './ages';
import { consumption } from './economy';
import { rand } from './rng';
import { DAYS_PER_YEAR, type GameState, type JobId, type Party, type PersonDraft } from './types';
import { ageOf, present } from './world';

type PartyShape = 'single' | 'couple' | 'family' | 'siblings' | 'elder' | 'caravan' | 'journeymen' | 'scholars' | 'pilgrims';

export function makeParty(s: GameState): Party {
  const r = s.rng;
  const village = s.stage !== 'settlement';
  // A town draws other kinds of travelers: traders, craftsmen looking for work, scholars, pilgrims.
  const town = s.stage !== 'settlement' && s.stage !== 'village';
  const temple = s.buildings.find((b) => b.kind === 'temple' && b.built && !b.removed && b.faith !== undefined && !s.faiths[b.faith]?.gone);
  const shape = weighted<PartyShape>(r, [
    ['single', village ? 34 : 56],
    ['couple', village ? 30 : 30],
    ['family', village ? 22 : 6],
    ['siblings', village ? 9 : 5],
    ['elder', village ? 5 : 3],
    ['caravan', town ? 9 : 0],
    ['journeymen', town ? 9 : 0],
    ['scholars', town && s.buildings.some((b) => b.kind === 'scribes' && b.built && !b.removed) ? 5 : 0],
    ['pilgrims', town && temple ? 5 : 0],
  ]);
  const family = familyName(r);
  const people: PersonDraft[] = [];
  let story = '';
  let faith: number | undefined;
  switch (shape) {
    case 'single': {
      const p = draftPerson(r, { age: int(r, 17, 45) });
      people.push(p);
      const job = p.skill;
      story = pick(r, [
        `${p.first} walked out of the hills with nothing but a ${pick(r, ['bedroll', 'bone knife', 'sack of seed', 'cooking pot'])}.`,
        `${p.first}, a ${job}, left a crowded valley to the south looking for room to breathe.`,
        `${p.first} saw the smoke from your fire three days' walk away and followed it.`,
        `${p.first} heard about the settlement from a trader and came to see for ${p.sex === 'f' ? 'herself' : 'himself'}.`,
        p.traits.includes('cunning') || p.traits.includes('greedy')
          ? `${p.first} is running from a debt, or so the rumor goes.`
          : `${p.first} buried a spouse last winter and wanted to start again somewhere new.`,
      ]);
      break;
    }
    case 'couple': {
      const a = draftPerson(r, { age: int(r, 18, 40), family, orientation: 'straight' });
      const sameSex = int(r, 0, 99) < 8;
      const b = draftPerson(r, {
        age: Math.max(17, a.age + int(r, -6, 6)),
        family,
        sex: sameSex ? a.sex : a.sex === 'f' ? 'm' : 'f',
        orientation: sameSex ? 'gay' : 'straight',
        spouseOf: 0,
      });
      if (sameSex) a.orientation = 'gay';
      a.spouseOf = 1;
      people.push(a, b);
      story = pick(r, [
        `${a.first} and ${b.first}, newly wed, came looking for land of their own.`,
        `${a.first} and ${b.first} ran away from a village upriver, where their families would not bless the match.`,
        `${a.first} and ${b.first} lost their home to a flood and walked until they saw your fire.`,
      ]);
      break;
    }
    case 'family': {
      const a = draftPerson(r, { age: int(r, 24, 40), family, sex: 'f', orientation: 'straight', spouseOf: 1 });
      const b = draftPerson(r, { age: Math.max(20, a.age + int(r, -4, 6)), family, sex: 'm', orientation: 'straight', spouseOf: 0 });
      people.push(a, b);
      const kids = village ? int(r, 1, 3) : 1;
      for (let i = 0; i < kids; i++) people.push(draftPerson(r, { age: int(r, 1, Math.min(14, a.age - 17)), family, parentsIdx: [0, 1] }));
      story = pick(r, [
        `The ${family} family, driven out of the lowlands by floods, with ${kids === 1 ? 'one child' : `${kids} children`} and a goat.`,
        `The ${family}s, whose old village was raided last spring.`,
        `The ${family} family, who heard the soil here was good and the people were kind.`,
      ]);
      break;
    }
    case 'siblings': {
      const n = int(r, 2, 3);
      for (let i = 0; i < n; i++) people.push(draftPerson(r, { age: int(r, 14, 26), family }));
      story = `${n === 2 ? 'Two' : 'Three'} ${family} siblings, ${people.map((p) => p.first).join(' and ')}, orphaned by a fever and looking for a place to belong.`;
      break;
    }
    case 'caravan': {
      const a = draftPerson(r, { age: int(r, 26, 44), family, sex: 'm', orientation: 'straight', spouseOf: 1, skill: pick(r, ['potter', 'smith'] as const) });
      const b = draftPerson(r, { age: Math.max(20, a.age + int(r, -6, 4)), family, sex: 'f', orientation: 'straight', spouseOf: 0 });
      people.push(a, b);
      if (chance(r, 0.6)) people.push(draftPerson(r, { age: int(r, 2, 12), family, parentsIdx: [0, 1] }));
      story = pick(r, [
        `The ${family}s, traders who had passed through ${s.name} with their mules for years, finally decided to stay.`,
        `A merchant's caravan came over the hills, and the ${family} family that led it liked the market so much they bought a house.`,
      ]);
      break;
    }
    case 'journeymen': {
      const trade = pick(r, ['potter', 'smith', 'builder'] as const);
      const n = int(r, 2, 3);
      for (let i = 0; i < n; i++) people.push(draftPerson(r, { age: int(r, 18, 30), skill: trade }));
      const word = trade === 'potter' ? 'potters' : trade === 'smith' ? 'smiths' : 'builders';
      story = `${n === 2 ? 'Two' : 'Three'} young ${word}, ${people.map((p) => p.first).join(' and ')}, walking from town to town to learn their trade, heard there was work in ${s.name}.`;
      break;
    }
    case 'scholars': {
      const a = draftPerson(r, { age: int(r, 20, 50), family, traits: ['curious', pick(r, ['clever', 'shy', 'stubborn', 'gregarious'] as const)] });
      people.push(a);
      story = `${a.first} ${family} came a long way to read the tablets kept by the scribes of ${s.name}, and never quite got around to leaving.`;
      break;
    }
    case 'pilgrims': {
      const f = s.faiths[temple!.faith!];
      faith = f.id;
      const n = int(r, 1, 3);
      for (let i = 0; i < n; i++) people.push(draftPerson(r, { age: int(r, 18, 55), traits: ['pious', pick(r, ['kind', 'content', 'gloomy', 'cheerful'] as const)] }));
      story = `${people.map((p) => p.first).join(' and ')} came on pilgrimage to the temple of ${f.name}, and stayed to be near it.`;
      break;
    }
    case 'elder': {
      const g = draftPerson(r, { age: int(r, 55, 70), family });
      const c = draftPerson(r, { age: int(r, 6, 14), family });
      people.push(g, c);
      story = `Old ${g.first} ${family} and ${g.sex === 'f' ? 'her' : 'his'} grandchild ${c.first}, the last of their family.`;
      break;
    }
  }
  return { id: s.nextId.party++, story, people, faith };
}

export function makeArrivalOptions(s: GameState): Party[] {
  const n = hasLaw(s, 'open-gates') ? 4 : 3;
  return Array.from({ length: n }, () => makeParty(s));
}

/** The party arrives: real people, a tent, and a line in the Chronicle. */
export function settleParty(s: GameState, party: Party, patron = false, quiet = false) {
  const created = party.people.map((d) => createPerson(s, d, patron ? 'patron' : 'arrival'));
  party.people.forEach((d, i) => {
    const p = created[i];
    if (d.spouseOf !== undefined) p.spouse = created[d.spouseOf].id;
    for (const pi of d.parentsIdx ?? []) {
      p.parents.push(created[pi].id);
      created[pi].children.push(p.id);
    }
    p.backstory = p.backstory ?? party.story;
  });
  if (party.faith !== undefined && !s.faiths[party.faith]?.gone) for (const p of created) p.faith = party.faith;
  const shelter = pitchShelter(s, created.length);
  for (const p of created) p.home = shelter?.id;
  const ids = created.map((p) => p.id);
  if (quiet) return created;
  if (patron) {
    const p = created[0];
    // Your settlers sometimes bring a keepsake from wherever they came from.
    if (chance(s.rng, 0.5)) makeItem(s, pick(s.rng, ['ring', 'cloak', 'comb'] as const), p, 'brought');
    log(s, 'patron', `${P(p.id)} arrived at dawn, as if ${p.sex === 'f' ? 'she' : 'he'} had been expected. ${p.backstory ?? ''}`.trim(), ids, 5, `The Year ${p.first} Came`);
  } else {
    // Turn the first mention of each newcomer into a clickable name.
    let story = party.story;
    for (const p of created) story = story.replace(new RegExp(`\\b${p.first}\\b`), F(p.id));
    log(s, 'arrival', `New arrivals: ${story}`, ids, 3, created.length >= 4 ? `The Year the ${created[0].family}s Came` : undefined);
  }
  return created;
}

// ---------------------------------------------------------------------------
// Coming on their own

interface Draw { why: string; job?: JobId; weight: number }

/** What draws people to the settlement just now, and how strongly. */
export function draws(s: GameState): { perYear: number; reasons: Draw[] } {
  const people = present(s);
  const pop = people.length;
  const built = (k: string) => s.buildings.some((b) => b.kind === k && b.built && !b.removed);
  const workers = (j: JobId) => people.filter((p) => p.job === j).length;
  const reasons: Draw[] = [{ why: 'that the land along the river was good and the people kind', weight: 2 }];
  if (built('kiln')) reasons.push({ why: `there was work at the kiln in ${s.name}`, job: 'potter', weight: workers('potter') < 2 + pop / 40 ? 2 : 0.6 });
  if (built('furnace')) reasons.push({ why: `the furnace in ${s.name} needed hands`, job: 'smith', weight: workers('smith') < 1 + pop / 60 ? 2 : 0.5 });
  if (built('dock')) reasons.push({ why: 'the river here was full of fish', job: 'fisher', weight: 1.2 });
  if (built('pen')) reasons.push({ why: `the pasture around ${s.name} was rich`, job: 'herder', weight: 0.8 });
  if (s.buildings.some((b) => !b.built && !b.removed)) reasons.push({ why: `${s.name} was building and needed builders`, job: 'builder', weight: 1.4 });
  if (built('stall')) reasons.push({ why: `there was trade to be done at the market in ${s.name}`, weight: 1.2 });
  if (built('healer')) reasons.push({ why: `the healers of ${s.name} could help where others couldn't`, weight: 0.6 });
  if (built('alehouse')) reasons.push({ why: `the beer in ${s.name} was worth the walk`, weight: 0.5 });

  // How well things are going: food in store, homes, health, mood.
  const need = people.reduce((t, p) => t + consumption(s, p), 0);
  const foodDays = s.stores.food / Math.max(1, need);
  let well = foodDays < 20 ? 0.15 : foodDays < 90 ? 0.6 : foodDays < 300 ? 1 : 1.25;
  if (s.flags.hungerSince !== undefined) well *= 0.2;
  if (s.plague) well *= 0.25;
  const homeless = people.filter((p) => p.home === undefined && ageOf(s, p) >= 16).length;
  if (homeless > pop * 0.1) well *= 0.7;
  const mood = people.reduce((t, p) => t + p.mood, 0) / Math.max(1, pop);
  well *= mood > 20 ? 1.15 : mood < 0 ? 0.75 : 1;
  well = Math.min(1.3, well * Math.min(1.2, boost(s, 'goods') ** 0.2));
  // A young settlement is news: people come to see it even through a lean year.
  if (s.stage === 'settlement') well = Math.max(well, 0.7);
  else if (s.stage === 'village') well = Math.max(well, 0.35);
  // About three parties a year for a village doing fine, a few more as it grows into a town.
  const perYear = (2.2 + Math.sqrt(pop) * 0.06) * well * (hasLaw(s, 'open-gates') ? 1.5 : 1);
  return { perYear, reasons };
}

/** Each season: some people may come to stay, drawn by what the settlement has to offer. */
export function arrivalsSeason(s: GameState) {
  const { perYear, reasons } = draws(s);
  let expected = perYear / 4;
  while (expected > 0) {
    if (rand(s.rng) < Math.min(1, expected)) {
      const reason = weighted(s.rng, reasons.map((r) => [r, r.weight] as const));
      const party = makeParty(s);
      // Those who came for the work have the trade for it.
      if (reason.job) for (const d of party.people) if (d.age >= 16 && chance(s.rng, 0.75)) d.skill = reason.job;
      party.story = `${party.story} ${party.people.length > 1 ? 'They' : party.people[0].first} had heard ${reason.why}.`;
      settleParty(s, party);
    }
    expected -= 1;
  }
}

/** How many people came on their own in the last year (for the Arrivals panel). */
export function cameLastYear(s: GameState): number {
  let n = 0;
  for (let i = s.chronicle.length - 1; i >= 0; i--) {
    const e = s.chronicle[i];
    if (e.day < s.day - DAYS_PER_YEAR) break;
    if (e.kind === 'arrival') n += e.people.length;
  }
  return n;
}
