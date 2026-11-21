// Knowledge, discoveries and ages. People learn things together over the
// years; now and then someone makes a discovery. A great discovery starts a
// new age, named for it, and the greatest open the next era, which slowly
// changes how the city is built. Which discoveries come, in what order, and
// who makes them depends on the city and on chance.
import { log, P } from './chronicle';
import { chance, rand, weighted, int } from './rng';
import { DAYS_PER_YEAR, type BuildingKind, type Era, type GameState, type JobId, type Person } from './types';
import { ageOf, darkFactor, present } from './world';
import { isSite } from './places';

export const ERAS: Era[] = ['bronze', 'iron', 'stone-timber', 'sail-dome', 'steam', 'electric', 'glass'];
export const ERA_LABEL: Record<Era, string> = {
  bronze: 'Bronze', iron: 'Iron and Marble', 'stone-timber': 'Stone and Timber', 'sail-dome': 'Sail and Dome',
  steam: 'Steam and Brick', electric: 'Electric and Deco', glass: 'Glass and Steel',
};

export type Boost = 'food' | 'goods' | 'build' | 'health' | 'knowledge' | 'wood' | 'births';

export interface Discovery {
  id: string;
  /** As it reads in a sentence: "the wheel". */
  name: string;
  /** Index into ERAS. */
  era: number;
  /** Great discoveries start an age with this name. */
  age?: string;
  /** Whose work it tends to come out of. */
  jobs: JobId[];
  boosts?: Partial<Record<Boost, number>>;
  unlocks?: BuildingKind[];
  /** What it does, in a few words, for the History panel. */
  note: string;
  /** For the Chronicle; {p} is whoever made it. */
  text: string;
  /** Extra likelihood from the city's circumstances. */
  likes?: (s: GameState) => number;
  /** Discoveries it builds on, which must come first. */
  needs?: string[];
}

const count = (s: GameState, kind: BuildingKind) => s.buildings.filter((b) => b.kind === kind && b.built && !b.removed).length;
const workers = (s: GameState, job: JobId) => present(s).filter((p) => p.job === job).length;

export const DISCOVERIES: Discovery[] = [
  // --- Bronze -------------------------------------------------------------
  { id: 'potters-wheel', name: "the potter's wheel", era: 0, jobs: ['potter'], boosts: { goods: 0.2 },
    note: 'Pots made faster and finer',
    text: '{p} set a flat stone spinning on a peg and drew a pot up out of the clay in the time it took to sing a song. By the next spring every potter in {town} had a wheel.',
    likes: (s) => workers(s, 'potter') },
  { id: 'ard', name: 'the ox-drawn plough', era: 0, jobs: ['farmer'], boosts: { food: 0.1 },
    note: 'Fields yield more',
    text: '{p} yoked two oxen to a hooked branch and scratched a furrow straighter and deeper than any hoe. The fields of {town} were never quite the same.',
    likes: (s) => workers(s, 'farmer') * 0.5 },
  { id: 'loom', name: 'the upright loom', era: 0, jobs: ['herder', 'none', 'elder'], boosts: { goods: 0.1 },
    note: 'Cloth from wool, and warmer winters',
    text: '{p} hung warp threads from a beam and weighted them with stones, and wove cloth wider than a man\'s arms.',
    likes: (s) => count(s, 'pen') * 2 },
  { id: 'calendar', name: 'the stone calendar', era: 0, jobs: ['elder', 'farmer'], boosts: { food: 0.05 },
    note: 'Planting at the right time',
    text: '{p} noticed that the sun rose over the same notch in the hills each midsummer, and set stones to mark it. Now {town} knew when to sow.' },
  { id: 'brewing', name: 'barley beer', era: 0, jobs: ['farmer', 'potter'], unlocks: ['alehouse'],
    note: 'An alehouse can be built',
    text: '{p} left wet barley too long in a pot, tasted it out of curiosity, and called the neighbors. It was the start of a long tradition.' },
  { id: 'herbals', name: 'the healing herbs', era: 0, jobs: ['healer', 'elder', 'gatherer'], boosts: { health: 0.15 }, unlocks: ['healer'],
    note: "Fewer die of sickness; a healer's hut can be built",
    text: '{p} walked the woods for years learning which leaves eased a fever and which roots stopped bleeding, and began to teach it.',
    likes: (s) => workers(s, 'healer') * 2 + workers(s, 'gatherer') * 0.3 },
  { id: 'wheel', name: 'the wheel', era: 0, age: 'The Age of the Wheel', jobs: ['builder', 'smith', 'potter'], boosts: { build: 0.2 },
    note: 'Carts: building goes faster',
    text: '{p} watched a log roll down the riverbank, and thought about it for a whole winter. In spring {p:they} cut two slices from a trunk, joined them with an axle, and loaded a whole tree on top. Children rode the first cart up and down {town} all afternoon.',
    likes: (s) => workers(s, 'builder') * 0.5 + (s.flags.knowledge ?? 0) },
  { id: 'writing', name: 'writing', era: 0, age: 'The Age of Writing', jobs: ['elder', 'potter', 'none'], boosts: { knowledge: 0.25 }, unlocks: ['scribes'],
    note: 'Knowledge is kept; a house of scribes can be built',
    text: "{p} began pressing little marks into clay to keep count of the granary, then to keep names, then to keep stories. For the first time, {town} could remember things nobody alive had seen.",
    likes: (s) => count(s, 'stall') * 1.5 + count(s, 'granary') },

  // --- Iron and Marble ----------------------------------------------------
  { id: 'iron', name: 'iron', era: 1, age: 'The Age of Iron', jobs: ['smith'], boosts: { food: 0.1, wood: 0.15 },
    note: 'Iron tools: more food and wood',
    text: '{p} built the furnace hotter than any before and drew out a grey, spongy lump that could be hammered into a blade harder than bronze.',
    likes: (s) => workers(s, 'smith') * 2 },
  { id: 'law', name: 'written law', era: 1, age: 'The Age of Law', jobs: ['elder'], boosts: { health: 0.05 },
    note: 'Laws are written down',
    text: '{p} had the laws of {town} cut into a standing stone beside the hearth, so that no chief could ever say they had been different.',
    likes: (s) => s.laws.length * 2 },
  { id: 'coin', name: 'coin', era: 1, age: 'The Age of Coin', jobs: ['smith', 'potter'], boosts: { goods: 0.25 },
    note: 'Trade flourishes',
    text: '{p} stamped little discs of metal with the mark of {town}, and soon traders came from three valleys to use them.',
    likes: (s) => count(s, 'stall') * 2 },
  { id: 'mortar', name: 'lime mortar', era: 1, jobs: ['builder'], boosts: { build: 0.15 },
    note: 'Stronger walls, built faster',
    text: '{p} burned limestone in the kiln and mixed it with sand and water into a paste that set as hard as the stones it held.' },
  { id: 'aqueduct', name: 'the aqueduct', era: 1, jobs: ['builder', 'elder'], boosts: { health: 0.15 },
    note: 'Clean water: less sickness',
    text: '{p} worked out how to carry clean water from the hills on a channel of stone, falling a finger\'s width for every hundred paces.' },
  { id: 'terraces', name: 'terraced fields', era: 1, jobs: ['farmer'], boosts: { food: 0.12 },
    note: 'Fields on the slopes',
    text: '{p} cut steps into the hillside and walled them with stones, and grew barley where only goats had walked.' },
  { id: 'medicine', name: 'the art of medicine', era: 1, jobs: ['healer'], boosts: { health: 0.15, births: 0.05 },
    note: 'Fewer die in sickness and childbirth',
    text: '{p} spent a lifetime learning every illness and what helped it, and taught it all to anyone who would sit still long enough to listen.' },

  { id: 'roads', name: 'paved roads', era: 1, jobs: ['builder'], boosts: { build: 0.05, goods: 0.05 },
    note: 'Roads that last',
    text: '{p} laid the road to the river with fitted stones over a bed of gravel, and it was still there a hundred years later.' },
  { id: 'glassblowing', name: 'glassblowing', era: 1, jobs: ['potter'], boosts: { goods: 0.1 },
    note: 'Glass vessels and beads',
    text: '{p} blew through a hollow reed into a blob of molten sand and ash, and it swelled into a bubble that cooled clear.' },

  // --- Stone and Timber ---------------------------------------------------
  { id: 'faith', name: 'the great faith', era: 2, age: 'The Age of Faith', jobs: ['elder', 'healer'], boosts: { health: 0.05 },
    note: 'Faith shapes the city',
    text: 'The teachings of {p} spread far beyond {town}; pilgrims came, and the faiths of the city raised their first great houses.',
    likes: (s) => s.faiths.filter((f) => !f.gone).length * 3 },
  { id: 'plow', name: 'the heavy plough', era: 2, age: 'The Age of the Plow', jobs: ['farmer', 'smith'], boosts: { food: 0.2 },
    note: 'Heavy soil turned: much more food',
    text: '{p} fitted a heavy share and a mouldboard to a plough that took eight oxen to pull, and turned the heavy valley clay that had beaten every farmer before.',
    likes: (s) => workers(s, 'farmer') * 0.4 },
  { id: 'castles', name: 'the castle', era: 2, age: 'The Age of Castles', jobs: ['builder'], boosts: { build: 0.1 },
    note: 'Walls of stone',
    text: '{p} drew a plan for walls of stone with towers at every corner, and {town} spent a generation building them.',
    likes: (s) => (s.walls ? 3 : 0) },
  { id: 'watermill', name: 'the watermill', era: 2, jobs: ['builder', 'farmer'], boosts: { food: 0.1, goods: 0.1 },
    note: 'The river grinds the grain',
    text: '{p} built a wheel the river could turn, and the river ground more grain in a day than ten people in a week.' },
  { id: 'guild-charter', name: 'the guild charter', era: 2, jobs: ['potter', 'smith', 'builder'], boosts: { goods: 0.15 },
    note: 'Crafts pass on their secrets',
    text: '{p} set down the rules of the craft and the oath of the apprentice, and the guilds of {town} have kept them ever since.' },
  { id: 'clock', name: 'the clock', era: 2, jobs: ['smith'], boosts: { goods: 0.05, knowledge: 0.1 },
    note: 'The hours are kept',
    text: '{p} built a machine of weights and wheels that rang a bell every hour, and the whole of {town} started keeping time by it.' },

  { id: 'windmill', name: 'the windmill', era: 2, jobs: ['builder', 'farmer'], boosts: { food: 0.08 },
    note: 'The wind grinds the grain',
    text: '{p} built a mill on the ridge that turned its sails to face the wind, and it ground grain even in the dry months when the river ran low.' },
  { id: 'paper', needs: ['writing'], name: 'paper', era: 2, jobs: ['potter', 'elder'], boosts: { knowledge: 0.15 },
    note: 'Cheap pages for writing',
    text: '{p} pounded rags to pulp and dried it in thin sheets, and suddenly writing things down cost almost nothing.' },

  // --- Sail and Dome ------------------------------------------------------
  { id: 'print', needs: ['writing'], name: 'the printing press', era: 3, age: 'The Age of Print', jobs: ['smith', 'elder'], boosts: { knowledge: 0.35 },
    note: 'Books for everyone',
    text: '{p} cast letters in metal and pressed them onto paper, a whole page at once. Within a year there were more books in {town} than there had ever been.' },
  { id: 'sail', name: 'the tall ship', era: 3, age: 'The Age of Sail', jobs: ['fisher', 'builder'], boosts: { food: 0.1, goods: 0.2 },
    note: 'Ships to far places',
    text: '{p} built a ship with three masts that could sail against the wind, and came home a year later with spices nobody in {town} had a name for.',
    likes: (s) => count(s, 'dock') * 3 + workers(s, 'fisher') },
  { id: 'gunpowder', name: 'gunpowder', era: 3, age: 'The Age of Gunpowder', jobs: ['smith', 'potter'], boosts: { build: 0.05 },
    note: 'Powder and cannon',
    text: '{p} mixed saltpetre, sulphur and charcoal, and the bang was heard in the next valley.' },
  { id: 'compass', name: 'the compass', era: 3, jobs: ['fisher', 'smith'], boosts: { goods: 0.1 },
    note: 'Sailors find their way',
    text: '{p} floated a magnetized needle on a cork in a bowl of water, and it pointed north every time.' },
  { id: 'banking', needs: ['coin'], name: 'banking', era: 3, jobs: ['potter', 'smith', 'elder'], boosts: { goods: 0.2 },
    note: 'Money lent and borrowed',
    text: '{p} opened a counting house in the square, and soon half of {town} owed it money and the other half was owed.' },
  { id: 'lens', name: 'the lens', era: 3, jobs: ['potter', 'healer'], boosts: { knowledge: 0.15, health: 0.05 },
    note: 'Spectacles and telescopes',
    text: '{p} ground glass into a curve and looked through it at the moon, then at a drop of pond water, and was astonished both times.' },
  { id: 'dome', name: 'the dome', era: 3, jobs: ['builder'], boosts: { build: 0.15 },
    note: 'Great roofs without beams',
    text: '{p} worked out how to raise a dome of brick without any frame to hold it up, and the people of {town} came to watch it close.' },

  // --- Steam and Brick ----------------------------------------------------
  { id: 'steam', needs: ['iron'], name: 'the steam engine', era: 4, age: 'The Age of Steam', jobs: ['smith'], boosts: { goods: 0.35 },
    note: 'Engines do the work',
    text: '{p} built an engine that boiled water to push a piston, and it pumped, hammered and spun day and night without tiring.' },
  { id: 'coal', name: 'coal', era: 4, age: 'The Age of Coal', jobs: ['smith', 'woodcutter'], boosts: { goods: 0.2, wood: 0.3 },
    note: 'Black stone burns hotter than wood',
    text: '{p} dug into the black seam in the hillside, and {town} burned it in every hearth. The sky above the city was never quite as blue again.' },
  { id: 'rail', needs: ['steam'], name: 'the railway', era: 4, age: 'The Age of Rail', jobs: ['smith', 'builder'], boosts: { goods: 0.2, build: 0.1 },
    note: 'Trains link the cities',
    text: '{p} set an engine on iron rails, and the journey to the coast that had taken a week took an afternoon.' },
  { id: 'vaccination', name: 'vaccination', era: 4, jobs: ['healer'], boosts: { health: 0.3 },
    note: 'The great plagues end',
    text: '{p} scratched a little cowpox into a child\'s arm, and the child never caught the spotted fever that killed so many.' },
  { id: 'gaslight', name: 'gaslight', era: 4, jobs: ['smith', 'builder'], boosts: { knowledge: 0.1 },
    note: 'The streets are lit at night',
    text: '{p} piped gas under the streets of {town} and lit lamps on every corner, and the night was never quite dark again.' },
  { id: 'sewers', name: 'the sewers', era: 4, jobs: ['builder'], boosts: { health: 0.2 },
    note: 'Clean streets, less sickness',
    text: '{p} dug great brick tunnels under the city to carry its filth away, and the summer fevers faded.' },

  { id: 'telegraph', name: 'the telegraph', era: 4, jobs: ['smith'], boosts: { knowledge: 0.1 },
    note: 'Messages down a wire',
    text: '{p} tapped a message into a key in {town}, and it was read in the capital before {p:they} had taken a breath.' },

  // --- Electric and Deco --------------------------------------------------
  { id: 'lightning', name: 'electricity', era: 5, age: 'The Age of Lightning', jobs: ['smith'], boosts: { goods: 0.3, knowledge: 0.15 },
    note: 'Power down a wire',
    text: '{p} caught lightning in a wire, more or less, and by the end of the decade every street in {town} had electric light.' },
  { id: 'radio', needs: ['lightning'], name: 'the radio', era: 5, age: 'The Age of Radio', jobs: ['smith', 'elder'], boosts: { knowledge: 0.2 },
    note: 'Voices through the air',
    text: '{p} heard a voice from a city a hundred miles away coming out of a box of wires, and wept.' },
  { id: 'flight', name: 'flight', era: 5, age: 'The Age of Flight', jobs: ['builder', 'smith'], boosts: { goods: 0.15 },
    note: 'Machines that fly',
    text: '{p} flew a machine of canvas and wire over the rooftops of {town}, and landed it, mostly.' },
  { id: 'antibiotics', name: 'antibiotics', era: 5, jobs: ['healer'], boosts: { health: 0.35, births: 0.1 },
    note: 'Infections cured',
    text: '{p} noticed that a mould growing on a forgotten dish had killed the sickness around it.' },
  { id: 'tram', needs: ['lightning'], name: 'the tram', era: 5, jobs: ['builder', 'smith'], boosts: { build: 0.1 },
    note: 'Trams along the avenues',
    text: '{p} laid rails down the main street of {town}, and the trams ran from dawn to midnight.' },
  { id: 'telephone', needs: ['lightning'], name: 'the telephone', era: 5, jobs: ['smith'], boosts: { knowledge: 0.1 },
    note: 'Talking across the city',
    text: '{p} spoke into a horn on one side of {town} and was heard on the other.' },

  { id: 'film', needs: ['lightning'], name: 'moving pictures', era: 5, jobs: ['smith', 'elder'], boosts: { knowledge: 0.05 },
    note: 'Cinemas open',
    text: '{p} projected pictures that moved onto a sheet in the square, and half of {town} screamed when the train came toward them.' },

  // --- Glass and Steel ----------------------------------------------------
  { id: 'atom', name: 'the atom', era: 6, age: 'The Age of the Atom', jobs: ['smith', 'healer'], boosts: { goods: 0.2 },
    note: 'Power from the smallest things',
    text: '{p} split the atom in a basement laboratory, and the world changed in ways nobody was ready for.' },
  { id: 'silicon', needs: ['lightning'], name: 'the microchip', era: 6, age: 'The Age of Silicon', jobs: ['smith'], boosts: { knowledge: 0.3 },
    note: 'Thinking machines',
    text: '{p} etched a thousand switches onto a sliver of sand smaller than a fingernail.' },
  { id: 'networks', needs: ['silicon'], name: 'the network', era: 6, age: 'The Age of Networks', jobs: ['smith', 'elder'], boosts: { knowledge: 0.3, goods: 0.15 },
    note: 'Everyone connected',
    text: '{p} linked the machines of {town} to every other city in the world, and nobody was ever quite alone, or quite at peace, again.' },
  { id: 'vaccines', name: 'modern medicine', era: 6, jobs: ['healer'], boosts: { health: 0.3 },
    note: 'Long lives',
    text: '{p} and a hundred others wiped out a sickness that had haunted {town} since its founding.' },
  { id: 'greenhouse', name: 'the glasshouse farm', era: 6, jobs: ['farmer'], boosts: { food: 0.3 },
    note: 'Food grown in glass',
    text: '{p} grew a year of vegetables in a tower of glass on a single street corner.' },
  { id: 'satellite', name: 'the satellite', era: 6, jobs: ['smith', 'builder'], boosts: { knowledge: 0.1 },
    note: 'Eyes in orbit',
    text: '{p} helped put a machine in the sky that circled the world every ninety minutes, and on clear nights {town} watched for it.' },
];

const BY_ID = new Map(DISCOVERIES.map((d) => [d.id, d]));
export const discovery = (id: string) => BY_ID.get(id);

/** Ages that come from events rather than discoveries, when the sliders allow. */
export const SIDE_AGES = {
  plague: { name: 'The Age of Plague', dark: true, note: 'After the great sickness' },
  ash: { name: 'The Age of Ash', dark: true, note: 'After the great fire' },
  omens: { name: 'The Age of Omens', weird: 2, note: 'Strange signs everywhere' },
  comet: { name: 'The Age of the Comet', weird: 2, note: 'A fire in the sky' },
  alchemy: { name: 'The Age of Alchemy', weird: 3, note: 'Gold from lead, nearly' },
} as const;
export type SideAge = keyof typeof SIDE_AGES;

export function eraIndex(s: GameState): number {
  return Math.max(0, ERAS.indexOf(s.age.era));
}

export function knows(s: GameState, id: string): boolean {
  return s.lore.known.some((k) => k.id === id);
}

const boostCache = new WeakMap<object, { n: number; values: Record<Boost, number> }>();

/** The combined effect of everything discovered so far: 1 = none. */
export function boost(s: GameState, kind: Boost): number {
  let c = boostCache.get(s.lore);
  if (!c || c.n !== s.lore.known.length) {
    const values: Record<Boost, number> = { food: 1, goods: 1, build: 1, health: 1, knowledge: 1, wood: 1, births: 1 };
    for (const k of s.lore.known) {
      for (const [b, v] of Object.entries(discovery(k.id)?.boosts ?? {})) values[b as Boost] *= 1 + (v ?? 0);
    }
    c = { n: s.lore.known.length, values };
    boostCache.set(s.lore, c);
  }
  return c.values[kind];
}

export function unlocked(s: GameState, kind: BuildingKind): boolean {
  const needs = DISCOVERIES.filter((d) => d.unlocks?.includes(kind));
  return !needs.length || needs.some((d) => knows(s, d.id));
}

function adultsHere(s: GameState): number {
  let n = 0;
  for (const p of present(s)) if (ageOf(s, p) >= 16) n++;
  return n;
}

/** What any settlement this size learns in a day, just by living. */
function baseRate(adults: number): number {
  return 0.004 + Math.sqrt(adults) * 0.0035;
}

/** Knowledge gathered per day: more with crafters, elders, curious minds, markets and scribes. */
export function knowledgeRate(s: GameState): number {
  let adults = 0, crafters = 0, elders = 0, curious = 0;
  for (const p of present(s)) {
    if (ageOf(s, p) < 16) continue;
    adults++;
    if (p.job === 'potter' || p.job === 'smith' || p.job === 'healer') crafters++;
    if (p.job === 'elder') elders++;
    if (p.traits.includes('curious') || p.traits.includes('clever')) curious++;
  }
  let stalls = 0, scribes = 0, hall = 0;
  for (const b of s.buildings) {
    if (!b.built || b.removed) continue;
    if (b.kind === 'stall') stalls++;
    else if (b.kind === 'scribes') scribes++;
    else if (b.kind === 'hall') hall = 1;
  }
  const r = baseRate(adults) + Math.sqrt(crafters) * 0.004 + Math.sqrt(elders) * 0.003 + Math.sqrt(curious) * 0.002
    + Math.min(4, scribes) * 0.01 + hall * 0.002 + Math.min(6, stalls) * 0.001;
  return r * boost(s, 'knowledge');
}

/**
 * What a discovery usually costs. It grows with the city, so over the centuries discoveries
 * come about every five years on average; scribes, curious people and Inspire speed them.
 */
export function nextCost(s: GameState): number {
  return Math.max(30, baseRate(adultsHere(s)) * DAYS_PER_YEAR * 15);
}

/**
 * How hard the next discovery turns out to be, as a share of the usual cost: drawn afresh after
 * each one. Mostly near the usual, but sometimes two come within a year, and sometimes nothing
 * new for fifteen. (A clamped exponential, so the average stays about 1.)
 */
export function drawDifficulty(s: GameState): number {
  return Math.min(3.5, Math.max(0.12, -Math.log(1 - rand(s.rng))));
}

/** Knowledge needed for the next discovery. */
export function discoveryThreshold(s: GameState): number {
  return nextCost(s) * (s.lore.need ?? 1);
}

/** How far along the next discovery is, 0..1. */
export function discoveryProgress(s: GameState): number {
  return Math.min(1, s.lore.points / discoveryThreshold(s));
}

/** The least number of years an era lasts, a little different for every city. */
function eraYears(s: GameState, era: number): number {
  return 42 + ((s.seed * 7 + era * 13) % 17);
}

/** Discoveries that could come next. The next era's great discoveries open once this era is well along. */
export function candidates(s: GameState): Discovery[] {
  const era = eraIndex(s);
  const knownHere = s.lore.known.filter((k) => discovery(k.id)?.era === era).length;
  const hereLeft = DISCOVERIES.filter((d) => d.era === era && !knows(s, d.id)).length;
  const eraStart = s.ages.find((a) => a.era === ERAS[era])?.from ?? 0;
  const ripe = s.day - eraStart >= eraYears(s, era) * DAYS_PER_YEAR && (knownHere >= 5 || hereLeft === 0);
  return DISCOVERIES.filter((d) => {
    if (knows(s, d.id)) return false;
    if (d.needs && !d.needs.every((n) => knows(s, n))) return false;
    if (d.era <= era) return true;
    return d.era === era + 1 && !!d.age && ripe;
  });
}

function discoverer(s: GameState, d: Discovery, nudged?: Person): Person | undefined {
  const adults = present(s).filter((p) => ageOf(s, p) >= 16);
  if (nudged && nudged.alive && nudged.away === undefined) return nudged;
  const options = adults.map((p) => {
    let w = d.jobs.includes(p.job) ? 6 : 0.4;
    if (p.traits.includes('curious')) w *= 2;
    if (p.traits.includes('clever')) w *= 2;
    if (p.skill === p.job) w *= 1.5;
    return [p, w] as const;
  });
  return options.length ? weighted(s.rng, options) : undefined;
}

/** Every day: knowledge gathers, and when there's enough, someone discovers something. */
export function loreDay(s: GameState) {
  s.lore.need ??= drawDifficulty(s);
  s.lore.points += knowledgeRate(s);
  const need = discoveryThreshold(s);
  if (s.lore.points < need || s.day - (s.lore.last ?? -999) < 30) return;
  const options = candidates(s);
  if (!options.length) { s.lore.points = Math.min(s.lore.points, need); return; }
  const nudge = s.lore.nudge && s.lore.nudge.until >= s.day ? s.people[s.lore.nudge.person] : undefined;
  const d = weighted(s.rng, options.map((o) => {
    let w = 1 + (o.likes?.(s) ?? 0) * 0.3;
    if (o.era < eraIndex(s)) w *= 2; // catching up on old knowledge comes easily
    if (nudge && o.jobs.includes(nudge.job)) w *= 4;
    return [o, w] as const;
  }));
  const by = discoverer(s, d, nudge && d.jobs.includes(nudge.job) ? nudge : undefined);
  if (nudge && by === nudge) s.lore.nudge = undefined;
  s.lore.points = Math.max(0, s.lore.points - need);
  s.lore.need = drawDifficulty(s);
  discover(s, d, by);
}

export function discover(s: GameState, d: Discovery, by?: Person) {
  s.lore.known.push({ id: d.id, day: s.day, by: by?.id });
  s.lore.last = s.day;
  const text = d.text
    .replace(/\{p\}/g, by ? P(by.id) : 'Someone')
    .replace(/\{p:they\}/g, by ? (by.sex === 'f' ? 'she' : 'he') : 'they')
    .replace(/\{town\}/g, s.name);
  if (by) by.renown += d.age ? 40 : 15;
  const ids = by ? [by.id] : [];
  const era = eraIndex(s);
  // A great discovery starts an age: always when it opens a new era; within an era, it ends a
  // side age, or starts a second age if this one has run long enough.
  const startsAge = !!d.age && (d.era > era || (d.era === era && (s.age.side
    || (s.day - s.age.since >= 15 * DAYS_PER_YEAR && s.ages.filter((a) => a.era === s.age.era && !a.side).length < 2))));
  if (startsAge) {
    log(s, 'discovery', text, ids, 8);
    beginAge(s, { name: d.age!, era: ERAS[Math.max(d.era, era)], discovery: d.id });
  } else {
    log(s, 'discovery', text, ids, d.age ? 7 : 6, `The Year of ${titleCase(d.name)}`);
  }
}

/** An idea's name as a title: "the potter's wheel" → "Potter's Wheel". */
export function ideaTitle(d: Discovery): string {
  return titleCase(d.name.replace(/^the /, ''));
}

/** "the potter's wheel" → "the Potter's Wheel" */
export function titleCase(t: string): string {
  return t.split(' ').map((w, i) => (i > 0 || w !== 'the') && !['of', 'a'].includes(w) ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

export function beginAge(s: GameState, a: { name: string; era: Era; discovery?: string; side?: SideAge }, text?: string) {
  const prevEra = s.age.era;
  const last = s.ages[s.ages.length - 1];
  if (last && last.to === undefined) last.to = s.day;
  const back = s.age.side ? s.age.back : !a.side ? undefined : { name: s.age.name, era: s.age.era };
  s.age = { name: a.name, era: a.era, since: s.day, side: !!a.side, back: a.side ? back : undefined };
  s.ages.push({ name: a.name, era: a.era, from: s.day, discovery: a.discovery, side: a.side });
  const newEra = a.era !== prevEra;
  const lines: string[] = [];
  if (a.side) lines.push(`People began to call it ${a.name.replace(/^The/, 'the')}.`);
  else if (newEra) lines.push(`${a.name} had begun. In time, ${s.name} would be rebuilt in a new way, one house at a time.`);
  else lines.push(`${a.name} had begun.`);
  log(s, 'age', text ?? lines.join(' '), [], text ? 5 : 10, a.side || text ? undefined : `The Year of ${a.name.replace(/^The Age of /, '')}`);
  if (!text) s.flags.ceremony = { kind: 'age', day: s.day };
}

/** An age that comes from events: plague, fire, omens, a comet. Only if the sliders allow it. */
export function beginSideAge(s: GameState, kind: SideAge, text?: string): boolean {
  const def = SIDE_AGES[kind];
  if ('dark' in def && darkFactor(s) < 1.1) return false;
  if ('weird' in def && s.settings.weirdness < def.weird) return false;
  if (s.age.side || s.day - s.age.since < 8 * DAYS_PER_YEAR) return false;
  beginAge(s, { name: def.name, era: s.age.era, side: kind }, text);
  s.flags.ceremony = { kind: 'age', day: s.day };
  s.age.until = s.day + int(s.rng, 12, 20) * DAYS_PER_YEAR;
  return true;
}

/** Once a year: side ages fade; in a new era, old buildings are rebuilt in the new way. */
export function agesYear(s: GameState) {
  if (s.age.side && s.age.until !== undefined && s.day >= s.age.until && s.age.back) {
    const back = s.age.back;
    beginAge(s, { name: back.name, era: back.era }, `${s.age.name} passed, and people spoke of ${back.name.replace(/^The/, 'the')} again.`);
  }
  // The Comet: a rare sight, if the world is strange enough.
  if (s.settings.weirdness >= 2 && chance(s.rng, 1 / 70)) {
    beginSideAge(s, 'comet', `A comet hung over ${s.name} for a whole season, a smear of green fire with a tail that pointed at the hearth. People began to call it the Age of the Comet.`);
  }
}

/** How a building should look: the era it was (re)built in. Old ones are slowly rebuilt. */
export function rebuildOld(s: GameState, queueRebuild: (b: GameState['buildings'][number]) => boolean) {
  const era = eraIndex(s);
  if (era === 0) return;
  const old = s.buildings.filter((b) => b.built && !b.removed && b.kind !== 'hearth' && b.kind !== 'stone' && b.kind !== 'field' && b.kind !== 'graveyard' && !isSite(b.kind)
    && ERAS.indexOf(b.era ?? 'bronze') < era && s.day - (b.completed ?? 0) > 25 * DAYS_PER_YEAR);
  if (!old.length) return;
  const n = Math.max(1, Math.round(old.length * 0.04));
  let done = 0;
  for (const b of old.sort(() => rand(s.rng) - 0.5)) {
    if (done >= n) break;
    if (queueRebuild(b)) done++;
  }
}

