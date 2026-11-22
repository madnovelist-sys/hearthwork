// Making people: traits, trades, dreams and the drafts newcomers arrive from.
import { inheritWays, keeps } from './culture';
import { chance, int, pick, rand, weighted, type RngState } from './rng';
import { familyName, givenName } from './names';
import { DAYS_PER_YEAR, type DreamId, type GameState, type JobId, type Orientation, type Person, type PersonDraft, type Sex, type TraitId } from './types';

export const TRAITS: { id: TraitId; label: string; opposite?: TraitId }[] = [
  { id: 'brave', label: 'Brave', opposite: 'timid' },
  { id: 'timid', label: 'Timid', opposite: 'brave' },
  { id: 'curious', label: 'Curious' },
  { id: 'kind', label: 'Kind', opposite: 'cruel' },
  { id: 'cruel', label: 'Cruel', opposite: 'kind' },
  { id: 'greedy', label: 'Greedy', opposite: 'generous' },
  { id: 'generous', label: 'Generous', opposite: 'greedy' },
  { id: 'pious', label: 'Pious', opposite: 'skeptical' },
  { id: 'skeptical', label: 'Skeptical', opposite: 'pious' },
  { id: 'ambitious', label: 'Ambitious', opposite: 'content' },
  { id: 'content', label: 'Content', opposite: 'ambitious' },
  { id: 'diligent', label: 'Diligent', opposite: 'lazy' },
  { id: 'lazy', label: 'Lazy', opposite: 'diligent' },
  { id: 'cheerful', label: 'Cheerful', opposite: 'gloomy' },
  { id: 'gloomy', label: 'Gloomy', opposite: 'cheerful' },
  { id: 'restless', label: 'Restless', opposite: 'homebody' },
  { id: 'homebody', label: 'Homebody', opposite: 'restless' },
  { id: 'clever', label: 'Clever' },
  { id: 'strong', label: 'Strong', opposite: 'frail' },
  { id: 'frail', label: 'Frail', opposite: 'strong' },
  { id: 'gregarious', label: 'Gregarious', opposite: 'shy' },
  { id: 'shy', label: 'Shy', opposite: 'gregarious' },
  { id: 'honest', label: 'Honest', opposite: 'cunning' },
  { id: 'cunning', label: 'Cunning', opposite: 'honest' },
  { id: 'stubborn', label: 'Stubborn' },
];

export const TRAIT_LABEL = Object.fromEntries(TRAITS.map((t) => [t.id, t.label])) as Record<TraitId, string>;

/** Common traits come up more often than cruel or frail ones. */
const TRAIT_WEIGHTS: Partial<Record<TraitId, number>> = { cruel: 0.35, frail: 0.6, cunning: 0.7, lazy: 0.7, timid: 0.8 };

export const JOB_LABEL: Record<JobId, string> = {
  farmer: 'Farmer', gatherer: 'Gatherer & hunter', fisher: 'Fisher', woodcutter: 'Woodcutter', builder: 'Builder',
  potter: 'Potter', smith: 'Bronzesmith', healer: 'Healer', herder: 'Herder', elder: 'Elder', child: 'Child', none: 'Idle',
};

export const TRADES: JobId[] = ['farmer', 'gatherer', 'fisher', 'woodcutter', 'builder', 'potter', 'smith', 'healer', 'herder'];

export const DREAM_LABEL: Record<DreamId, string> = {
  love: 'to find love',
  family: 'to raise a big family',
  sea: 'to see the sea',
  treasure: 'to find treasure',
  house: 'to live in a fine house',
  craft: 'to master their trade',
  remembered: 'to be remembered',
  lead: 'to lead',
};
export const DREAMS = Object.keys(DREAM_LABEL) as DreamId[];

export function rollTraits(r: RngState, count = rand(r) < 0.25 ? 3 : 2): TraitId[] {
  const out: TraitId[] = [];
  let guard = 0;
  while (out.length < count && guard++ < 50) {
    const t = weighted(r, TRAITS.map((x) => [x, TRAIT_WEIGHTS[x.id] ?? 1] as const));
    if (out.includes(t.id) || (t.opposite && out.includes(t.opposite))) continue;
    out.push(t.id);
  }
  return out;
}

export function rollOrientation(r: RngState): Orientation {
  return weighted(r, [['straight', 88], ['gay', 6], ['bi', 6]] as const);
}

export function rollSkill(r: RngState): JobId {
  return weighted(r, [
    ['farmer', 24], ['gatherer', 14], ['fisher', 12], ['woodcutter', 12], ['builder', 14],
    ['potter', 9], ['smith', 7], ['healer', 8], ['herder', 6],
  ] as const);
}

export function draftPerson(r: RngState, opts: Partial<PersonDraft> & { age: number }): PersonDraft {
  const sex: Sex = opts.sex ?? (rand(r) < 0.5 ? 'f' : 'm');
  return {
    first: opts.first ?? givenName(r, sex),
    family: opts.family ?? familyName(r),
    sex,
    orientation: opts.orientation ?? rollOrientation(r),
    age: opts.age,
    traits: opts.traits ?? rollTraits(r),
    skill: opts.skill ?? rollSkill(r),
    dream: opts.dream ?? pick(r, DREAMS),
    backstory: opts.backstory,
    patron: opts.patron,
    spouseOf: opts.spouseOf,
    parentsIdx: opts.parentsIdx,
  };
}

/** Turn a draft into a real resident of the settlement. */
export function createPerson(s: GameState, d: PersonDraft, origin: Person['origin']): Person {
  const r = s.rng;
  const ageDays = d.age * DAYS_PER_YEAR + int(r, 0, DAYS_PER_YEAR - 1);
  const p: Person = {
    id: s.nextId.person++,
    first: d.first,
    family: d.family,
    sex: d.sex,
    orientation: d.orientation,
    born: s.day - ageDays,
    alive: true,
    traits: [...d.traits],
    skill: d.skill,
    job: d.age < 16 ? 'child' : 'none',
    jobSince: s.day,
    dream: d.dream,
    origin,
    backstory: d.backstory,
    land: d.land,
    customs: d.customs ? [...d.customs] : undefined,
    patron: d.patron || undefined,
    lineage: d.patron || undefined,
    parents: [],
    children: [],
    health: 100,
    mood: 20,
    renown: d.patron ? 10 : 0,
    look: { skin: int(r, 0, 6), hair: int(r, 0, 5) }, // seven skin tones (see render/figures.ts), six hair colours
    memories: [],
  };
  s.people.push(p);
  return p;
}

export function childOf(s: GameState, mother: Person, father: Person | undefined, first: string, sex: Sex): Person {
  const r = s.rng;
  const p: Person = {
    id: s.nextId.person++,
    first,
    family: father?.family ?? mother.family,
    sex,
    orientation: rollOrientation(r),
    born: s.day,
    alive: true,
    traits: inheritTraits(r, mother, father),
    skill: chance(r, 0.5) ? (chance(r, 0.5) ? mother.skill : father?.skill ?? mother.skill) : rollSkill(r),
    job: 'child',
    jobSince: s.day,
    dream: pick(r, DREAMS),
    origin: 'born',
    lineage: mother.lineage || father?.lineage || undefined,
    land: mother.land ?? father?.land,
    customs: inheritWays(s, mother, father),
    parents: father ? [mother.id, father.id] : [mother.id],
    children: [],
    health: 100,
    mood: 30,
    renown: 0,
    look: {
      skin: chance(r, 0.5) ? mother.look.skin : father?.look.skin ?? mother.look.skin,
      hair: chance(r, 0.5) ? mother.look.hair : father?.look.hair ?? int(r, 0, 5),
    },
    memories: [],
  };
  s.people.push(p);
  mother.children.push(p.id);
  if (father) father.children.push(p.id);
  return p;
}

function inheritTraits(r: RngState, a: Person, b: Person | undefined): TraitId[] {
  const pool = [...a.traits, ...(b?.traits ?? [])];
  const out = rollTraits(r);
  if (pool.length && chance(r, 0.6)) {
    const t = pick(r, pool);
    const opposite = TRAITS.find((x) => x.id === t)?.opposite;
    if (!out.includes(t)) {
      const filtered = out.filter((x) => x !== opposite);
      filtered[0] = t;
      return [...new Set(filtered)];
    }
  }
  return out;
}

/** Pick a child's name: sometimes after a departed grandparent, never a living sibling's. */
export function nameChild(s: GameState, mother: Person, father: Person | undefined, sex: Sex): string {
  const r = s.rng;
  const siblings = new Set(mother.children.map((c) => s.people[c]?.first));
  const honorees = [...mother.parents, ...(father?.parents ?? [])]
    .map((id) => s.people[id])
    .filter((g) => g && !g.alive && g.sex === sex && !siblings.has(g.first));
  // Where children are named for their grandparents, living ones count too, and it's likelier.
  const forGrandparents = keeps(s, 'grandparent-names');
  const pool = forGrandparents ? [...mother.parents, ...(father?.parents ?? [])].map((id) => s.people[id]).filter((g) => g && g.sex === sex && !siblings.has(g.first)) : honorees;
  if (pool.length && chance(r, forGrandparents ? 0.7 : 0.35)) return pick(r, pool)!.first;
  for (let i = 0; i < 10; i++) {
    const n = givenName(r, sex);
    if (!siblings.has(n)) return n;
  }
  return givenName(r, sex);
}
