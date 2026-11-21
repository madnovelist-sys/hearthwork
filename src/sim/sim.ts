// The simulation's entry points: found a settlement, and advance it one day.
import { log, nameYear, P } from './chronicle';
import { economyDay, economySeason, assignJobs } from './economy';
import { lifeDay } from './life';
import { momentsDay } from './moments';
import { deerYear, herdsSeason, petsYear } from './animals';
import { itemsYear } from './items';
import { clearRuins, fireDay, plagueDay, plagueSeason } from './calamity';
import { applyHarvestBoost } from './fortunes';
import { placesYear } from './places';
import { arrivalsSeason } from './arrivals';
import { weatherDay } from './weather';
import { chooseRule, traditionsYear } from './traditions';
import { bondsYear } from './tales';
import { hooksYear } from './callers';
import { businessYear, ensureLeader, faithYear, plantFaithSeed, societySeason } from './society';
import type { TenetId } from './types';
import { generateMap, growMap } from './mapgen';
import { agesYear, beginSideAge, loreDay } from './ages';
import { grantCharter, townDay, townYear } from './town';
import { createPerson, draftPerson } from './people';
import { addBuilding, findSite, plannerDay } from './planner';
import { questsDay, questsSeason } from './quests';
import { makeRng, chance, int, pick } from './rng';
import { familyName } from './names';
import { DAYS_PER_SEASON, DAYS_PER_YEAR, type GameState, type Goals, type Settings } from './types';
import { population, seasonIndex, yearOf } from './world';

export const SAVE_VERSION = 1;

export const DEFAULT_GOALS: Goals = { track: 'time', dailyMinutes: 60, dailyWords: 1000, sparkMinutes: 20, sparkWords: 250 };
export const DEFAULT_SETTINGS: Settings = { darkness: 50, weirdness: 1, awayMinutes: 15, notify: false, dayNight: 'clock', stopAt: null, units: 'c' };

export interface FoundingOptions {
  seed: number;
  name: string;
  goals?: Goals;
  settings?: Settings;
}

export function foundSettlement(opts: FoundingOptions): GameState {
  const { map, hearth } = generateMap(opts.seed);
  const s: GameState = {
    version: SAVE_VERSION,
    seed: opts.seed,
    rng: makeRng(opts.seed),
    name: opts.name,
    stage: 'settlement',
    age: { name: 'The Age of Bronze', era: 'bronze', since: 0 },
    ages: [{ name: 'The Age of Bronze', era: 'bronze', from: 0 }],
    lore: { points: 0, known: [] },
    guilds: [],
    traditions: { history: [] },
    day: 0,
    map,
    hearth,
    people: [],
    buildings: [],
    graves: [],
    quests: [],
    chronicle: [],
    yearNames: {},
    playerNamedYears: {},
    stores: { food: 260, wood: 40, goods: 0 },
    favor: 2,
    sparks: 0,
    arrivals: [],
    pending: [],
    goals: { ...(opts.goals ?? DEFAULT_GOALS) },
    settings: { ...(opts.settings ?? DEFAULT_SETTINGS) },
    focus: { running: null, carryMs: 0, sparkMs: 0, sparkWords: 0, totalMs: 0, days: {}, sessions: [] },
    nextId: { person: 0, building: 0, entry: 0, quest: 0, grave: 0, party: 0, faith: 0, fortune: 0, pet: 0, item: 0, guild: 0 },
    flags: { relics: 0, knowledge: 0 },
    lateReturns: [],
    laws: [],
    faiths: [],
    fortunes: [],
    pets: [],
    wild: { deer: -1 },
    items: [],
  };
  const r = s.rng;

  addBuilding(s, 'hearth', hearth.x, hearth.y, { built: true });

  // The founders: two families and a couple of loners.
  const familyA = familyName(r);
  const familyB = familyName(r);
  const households = [
    [
      draftPerson(r, { age: int(r, 28, 38), family: familyA, sex: 'f', orientation: 'straight', spouseOf: 1 }),
      draftPerson(r, { age: int(r, 28, 40), family: familyA, sex: 'm', orientation: 'straight', spouseOf: 0 }),
      draftPerson(r, { age: int(r, 4, 10), family: familyA, parentsIdx: [0, 1] }),
    ],
    [
      draftPerson(r, { age: int(r, 22, 30), family: familyB, sex: 'm', orientation: 'straight', spouseOf: 1 }),
      draftPerson(r, { age: int(r, 21, 30), family: familyB, sex: 'f', orientation: 'straight', spouseOf: 0 }),
    ],
    [draftPerson(r, { age: int(r, 50, 62) })],
    [draftPerson(r, { age: int(r, 17, 26) })],
    [draftPerson(r, { age: int(r, 18, 30) })],
  ];
  for (const drafts of households) {
    const made = drafts.map((d) => createPerson(s, d, 'founder'));
    drafts.forEach((d, i) => {
      if (d.spouseOf !== undefined) made[i].spouse = made[d.spouseOf].id;
      for (const pi of d.parentsIdx ?? []) {
        made[i].parents.push(made[pi].id);
        made[pi].children.push(made[i].id);
      }
    });
    const site = findSite(s, 'tent');
    const tent = site ? addBuilding(s, 'tent', site.x, site.y) : undefined;
    for (const p of made) p.home = tent?.id;
  }
  // The first year is a lucky one: the founders are under the fire's protection.
  for (const p of s.people) p.blessedUntil = DAYS_PER_YEAR;
  assignJobs(s);
  const elder = s.people.find((p) => p.origin === 'founder' && p.born < -50 * DAYS_PER_YEAR);
  log(
    s, 'founding',
    `In the spring of the first year, eight travelers stopped beside the river and lit a fire. ${elder ? `${P(elder.id)}, the eldest, said the ground felt right.` : ''} They called the place ${s.name}.`,
    s.people.map((p) => p.id), 10, 'The Year of the First Fire',
  );
  return s;
}

/** Advance the settlement by one day. */
export function stepDay(s: GameState) {
  const d = s.day;
  if (d % DAYS_PER_SEASON === 0 && d > 0) onSeason(s);
  weatherDay(s);
  economyDay(s);
  lifeDay(s);
  questsDay(s);
  plannerDay(s);
  plagueDay(s);
  fireDay(s);
  momentsDay(s);
  loreDay(s);
  townDay(s);
  if (d % 30 === 0) assignJobs(s);
  ensureLeader(s);
  checkStage(s);
  s.day += 1;
  if (s.day % DAYS_PER_YEAR === 0) {
    petsYear(s);
    deerYear(s);
    itemsYear(s);
    faithYear(s);
    businessYear(s);
    agesYear(s);
    townYear(s);
    placesYear(s);
    hooksYear(s);
    traditionsYear(s);
    bondsYear(s);
    nameYear(s, yearOf(s.day - 1));
  }
}

function onSeason(s: GameState) {
  economySeason(s);
  applyHarvestBoost(s);
  questsSeason(s);
  societySeason(s);
  herdsSeason(s);
  arrivalsSeason(s);
  plagueSeason(s);
  clearRuins(s);
  if (seasonIndex(s.day) === 0) omens(s);
}

function omens(s: GameState) {
  const w = s.settings.weirdness;
  const r = s.rng;
  if (w === 0) {
    if (chance(r, 0.04)) {
      log(s, 'omen', `A comet hung over ${s.name} for nine nights. Some said it meant good fortune; some said the opposite.`, [], 5, 'The Year of the Comet');
      plantFaithSeed(s, 'comet');
    }
    return;
  }
  if (!chance(r, 0.12 + w * 0.06)) return;
  const options: [string, string, TenetId][] = [
    [`Lights were seen over the marsh at night, drifting against the wind.`, 'The Year of the Marsh Lights', 'river'],
    [`The stones of the hearth hummed for a whole night. Dogs would not go near the fire.`, 'The Year the Hearth Hummed', 'hearth'],
    [`A comet hung over ${s.name} for nine nights, green at the edges.`, 'The Year of the Comet', 'comet'],
  ];
  if (w >= 2) options.push(
    [`After a storm, the river turned up bones the size of a man, from some animal nobody could name.`, 'The Year of the Great Bones', 'ancestors'],
    [`For three days, every bird in the valley flew west. Then they came back, as if nothing had happened.`, 'The Year of the Birds', 'comet'],
  );
  if (w >= 3) options.push(
    [`Something large walked the edge of the woods at dusk, and left tracks with too many toes.`, 'The Year of the Tracks', 'relics'],
  );
  if (w >= 4) options.push(
    [`A stone the size of a hut was found floating a hand's width above the meadow. Children dared each other to crawl under it.`, 'The Year of the Floating Stone', 'hearth'],
  );
  const [text, name, tenet] = pick(r, options);
  log(s, 'omen', text, [], 5, name);
  plantFaithSeed(s, tenet);
  // Omen after omen: people start to say they're living in strange times.
  const recent = (s.flags.omenDays ?? []).filter((d) => s.day - d < 6 * DAYS_PER_YEAR);
  recent.push(s.day);
  s.flags.omenDays = recent;
  if (recent.length >= 3) {
    beginSideAge(s, 'omens', `Omen followed omen, and the old people said the world was thinning at the edges. People began to call it the Age of Omens.`);
  }
}

export function checkStage(s: GameState) {
  const pop = population(s);
  if (s.stage === 'settlement' && pop >= 50) {
    s.stage = 'village';
    log(s, 'stage', `${s.name} had grown into a village. The elders marked the day by planting an oak beside the fire, and a charter was sung: everyone who lived here, and everyone who would.`, [], 9, 'The Year of the Charter');
    chooseRule(s, `A village needs a way to decide things, and ${s.name} argued about it all winter.`);
  } else if (s.stage === 'village' && pop >= 250) {
    s.stage = 'town';
    grantCharter(s);
    growMap(s);
  } else if (s.stage === 'town' && pop >= 2000) {
    s.stage = 'city';
    log(s, 'stage', `${s.name} had become a city: more people than anyone could know by name, more streets than anyone could walk in a day.`, [], 10, 'The Year of the City');
    s.flags.ceremony = { kind: 'charter', day: s.day };
    growMap(s);
  } else if (s.stage === 'city' && pop >= 10000) {
    s.stage = 'metropolis';
    log(s, 'stage', `${s.name} had become one of the great cities of the world.`, [], 10, 'The Year of the Great City');
    s.flags.ceremony = { kind: 'charter', day: s.day };
    growMap(s);
  }
}

export function advanceDays(s: GameState, days: number) {
  for (let i = 0; i < days; i++) stepDay(s);
}
