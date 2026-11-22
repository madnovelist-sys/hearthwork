// Culture that comes with people. Everyone comes from somewhere, and every
// homeland has its own ways: its feasts, crafts, food, rites, songs and
// beliefs, and often its own way with the dead. Newcomers carry their ways in
// with them; husbands and wives, neighbours and friends pick them up; children
// grow up in them. When enough of the town keeps a way, it becomes the town's
// own, and a way nobody keeps any more fades. People follow their kin, so
// homelands that sent people once tend to send more, and a town comes to be
// shaped by where its people came from. The player can call people from
// homelands they'd like to hear from, and spend a Spark to encourage a way
// (or discourage one) for a few years.
import { F, log, P } from './chronicle';
import { chance, int, pick, shuffle, weighted } from './rng';
import type { Culture, GameState, Homeland, Person } from './types';
import { ageOf, present } from './world';
import type { DeathCustom } from './traditions';

export type CustomKind = 'feast' | 'craft' | 'food' | 'rite' | 'song' | 'belief';

export interface Custom {
  id: string;
  kind: CustomKind;
  /** As it reads in a sentence: "the midsummer fires". */
  name: string;
  /** For the Society panel. */
  blurb: string;
  /** When it takes root (with {town}, {land}, {p} for whoever brought it). */
  took: string;
  /** Now and then, in its season (or any season if none): small scenes with {p} and {q}. */
  season?: number;
  scenes: string[];
  /** When nobody keeps it any more. */
  faded: string;
  /** What keeping it does for the town (small). */
  effect?: { mood?: number; food?: number; goods?: number; health?: number };
  needs?: (s: GameState) => boolean;
}

export const CUSTOMS: Custom[] = [
  // Feasts
  { id: 'midsummer-fires', kind: 'feast', name: 'the midsummer fires', season: 1, effect: { mood: 3 },
    blurb: 'On the shortest night, fires on the high ground, and the young jump the flames for luck.',
    took: 'That summer, {town} lit fires on the high ground on the shortest night, the way {p} said they did in {land}, and the young jumped the flames until dawn. Nobody had to be asked the next year.',
    scenes: ['{p} jumped the midsummer fire higher than anyone, and singed {his} eyebrows doing it.', '{p} and {q} jumped the midsummer fire together, holding hands, and everyone said what that meant.'],
    faded: 'Nobody climbed the high ground on the shortest night any more. The midsummer fires had gone out of {town}.' },
  { id: 'first-snow', kind: 'feast', name: 'the first-snow feast', season: 3, effect: { mood: 2 },
    blurb: 'When the first snow falls, every house brings out what it has saved, and nobody eats alone.',
    took: 'When the first snow fell, {p} carried a pot of stew to the hearth and called everyone out, as they did in {land}. By the next winter it was simply what {town} did.',
    scenes: ['At the first-snow feast, {p} brought a pot of stew so good that {q} asked for the secret, and was refused.', 'The first snow fell in the night, and by morning half of {town} was at the hearth with bowls.'],
    faded: 'The first snow came and went, and nobody called a feast. The old winter feast had been forgotten.' },
  { id: 'harvest-masks', kind: 'feast', name: 'the harvest masks', season: 2, effect: { mood: 2 },
    blurb: 'At the end of harvest, straw masks are made from the last sheaf and worn to frighten off the hungry months.',
    took: '{p} plaited a mask from the last sheaf of the harvest, as they did in {land}, and danced in it at the hearth. Soon every field in {town} gave up its last sheaf for masks.',
    scenes: ['{p} made a straw mask so frightening that small children hid from it for days.', 'The harvest masks came out, and {p} danced in one until it fell apart.'],
    faded: 'Nobody made masks from the last sheaf any more. The old harvest dance was gone.' },
  { id: 'night-of-lamps', kind: 'feast', name: 'the night of lamps', season: 2, effect: { mood: 1 },
    blurb: 'One autumn night, clay lamps are floated on the river, one for each of the year\'s dead.',
    took: 'On an autumn night, {p} set a little clay lamp on the river for the dead, as they did in {land}. The next year the river was full of them.',
    scenes: ['On the night of lamps, {p} set three lamps on the water and watched them out of sight.', '{p} shaped lamps for the night of lamps for everyone who had lost someone that year, and would take nothing for them.'],
    faded: 'The river stayed dark in autumn now. The night of lamps had been forgotten.',
    needs: (s) => s.map.terrain.some((t) => t === 3) },
  { id: 'driving-the-herds', kind: 'feast', name: 'driving the herds between fires', season: 0, effect: { health: 0.02 },
    blurb: 'In spring the herds are driven between two fires, to keep them well through the year.',
    took: 'In spring, {p} built two fires and drove the goats between them, as they did in {land}. The herders of {town} have done it every spring since.',
    scenes: ['The goats went between the spring fires, and one of them went round instead, to {p}\'s despair.'],
    faded: 'The herds went out in spring without passing between the fires. The old way was forgotten.',
    needs: (s) => s.buildings.some((b) => b.kind === 'pen' && !b.removed) },
  // Crafts
  { id: 'spiral-cloth', kind: 'craft', name: 'spiral-patterned cloth', effect: { goods: 0.04 },
    blurb: 'Cloth woven with spirals and running borders, each family keeping its own pattern.',
    took: 'The spiral cloth of {land} that {p} wove became the cloth of {town}: soon every family had its own border, and could tell its own washing at a glance.',
    scenes: ['{p} wove a spiral border so fine that {q} offered a goat for the cloth.', '{p} taught {q} the family border, as {his} mother had taught {him}.'],
    faded: 'The old spiral borders had gone out of fashion. Cloth in {town} was plain now.' },
  { id: 'painted-doorposts', kind: 'craft', name: 'painted doorposts', effect: { mood: 1 },
    blurb: 'Each household paints its sign on its doorposts, freshened every spring.',
    took: 'One spring {p} painted the family sign on the doorposts, as everyone did in {land}. Within a few years every door in {town} had its sign.',
    scenes: ['{p} repainted the family sign on the doorposts, and got more on {him}self than on the door.'],
    faded: 'The signs on the doorposts were left to fade, and nobody repainted them.' },
  { id: 'coiled-baskets', kind: 'craft', name: 'coiled-reed baskets', effect: { goods: 0.03, food: 0.01 },
    blurb: 'Baskets coiled tight from reeds, close enough to hold grain, even water for a while.',
    took: 'The tight-coiled baskets {p} brought from {land} were so much better than the old ones that soon all of {town} was coiling reeds in the evenings.',
    scenes: ['{p} coiled a basket so tight it held water, and won a bet with {q} about it.'],
    faded: 'Nobody coiled the old reed baskets any more.' },
  { id: 'hand-marks', kind: 'craft', name: 'marked hands', effect: { mood: 1 },
    blurb: 'At their coming of age, the young have their hands marked with soot and a bone needle.',
    took: 'The young of {town} began to have their hands marked when they came of age, the way {p} had in {land}. Their parents grumbled, and then had their own done.',
    scenes: ['{p} had {his} hands marked, and showed everyone the pattern for a month.'],
    faded: 'The young of {town} no longer had their hands marked. Only the old ones still wore the patterns.' },
  // Food
  { id: 'stone-bread', kind: 'food', name: 'bread baked on hot stones', effect: { food: 0.03 },
    blurb: 'Flat bread baked on stones from the fire, eaten hot with everything.',
    took: 'The flat bread {p} baked on hot stones, as in {land}, was the bread of all {town} within a few years.',
    scenes: ['{p} burned the stone-bread again, and {q} ate it anyway, to be kind.'],
    faded: 'Nobody baked bread on the stones any more.' },
  { id: 'smoked-fish', kind: 'food', name: 'smoking fish over alder', effect: { food: 0.03 },
    blurb: 'Fish split and smoked over alder wood, to keep through the winter.',
    took: 'The alder smoke that {p} brought from {land} hung over {town} every autumn after, and there was fish in the stores all winter.',
    scenes: ['{p} smoked a whole basket of fish over alder, and the whole street smelled of it for days.'],
    faded: 'The smoking racks were empty now. Nobody smoked fish the old way.',
    needs: (s) => s.map.terrain.some((t) => t === 3) },
  { id: 'leaf-cheese', kind: 'food', name: 'soft cheese in leaves', effect: { food: 0.02 },
    blurb: 'Soft cheese wrapped in dock leaves to keep, the herders\' way.',
    took: 'The soft cheese in leaves that {p} made, as in {land}, was soon on every table in {town}.',
    scenes: ['{p} wrapped the new cheeses in dock leaves and hid the best one from {q}.'],
    faded: 'Nobody made the soft leaf cheese any more.',
    needs: (s) => s.buildings.some((b) => b.kind === 'pen' && !b.removed) },
  { id: 'acorn-flour', kind: 'food', name: 'acorn flour in hungry years', effect: { food: 0.02 },
    blurb: 'In lean years, acorns are leached and ground into flour. It isn\'t good, but it\'s food.',
    took: 'In a lean year {p} showed {town} how they made acorn flour in {land}. It was bitter, and it kept children alive, and nobody forgot how.',
    scenes: ['{p} leached a basket of acorns in the stream for a week, and {q} said the bread still tasted of bark.'],
    faded: 'Nobody remembered how to make acorn flour any more.' },
  { id: 'wedding-mead', kind: 'food', name: 'mead at weddings', effect: { mood: 1 },
    blurb: 'A jar of honey mead set aside at a birth, and drunk at that child\'s wedding.',
    took: 'At a wedding, {p} opened a jar of mead sealed at the bride\'s birth, as they did in {land}. After that every family in {town} sealed a jar when a child was born.',
    scenes: ['{p} opened the jar sealed at {his} birth, and it had gone to vinegar, and everyone laughed until they cried.'],
    faded: 'Nobody sealed a jar of mead at a birth any more.' },
  // Rites
  { id: 'ninth-day-naming', kind: 'rite', name: 'naming on the ninth day', effect: { health: 0.02 },
    blurb: 'A baby is named on its ninth day, carried round the hearth three times.',
    took: '{p} carried a baby three times round the hearth on its ninth day and named it, as they did in {land}. Now every child of {town} is named that way.',
    scenes: ['{p} carried the baby round the hearth on its ninth day, and it slept through its own naming.'],
    faded: 'Babies were named whenever their parents liked now. The ninth-day naming was forgotten.' },
  { id: 'night-in-the-woods', kind: 'rite', name: 'a night alone in the woods', effect: { mood: 1 },
    blurb: 'At their coming of age, the young spend a night alone in the woods, and come back grown.',
    took: 'The young of {town} began to spend a night alone in the woods when they came of age, as {p} had done in {land}. Some of them even admitted afterward that they had been afraid.',
    scenes: ['{p} spent {his} night alone in the woods, and came back insisting {he} had not been afraid at all.'],
    faded: 'The young no longer went alone into the woods. That rite was gone from {town}.' },
  { id: 'handfasting', kind: 'rite', name: 'handfasting', effect: { mood: 1 },
    blurb: 'At a wedding, the couple\'s hands are tied together with a cord for a day and a night.',
    took: 'At a wedding, {p} bound the couple\'s hands with a cord, as they did in {land}. Since then nobody in {town} counts themselves married without it.',
    scenes: ['{p} and {q} were handfasted, and spent the whole day trying to eat with one hand each.'],
    faded: 'The cords were not tied at weddings any more.' },
  { id: 'grandparent-names', kind: 'rite', name: 'naming children for grandparents',
    blurb: 'A first child takes the name of a grandparent, living or dead.',
    took: 'More and more children in {town} were named for their grandparents, as {p} said was right in {land}. Old names came back into use that nobody had heard in years.',
    scenes: ['{p} was delighted to have a granddaughter named for {him}, and told {q} about it every day for a month.'],
    faded: 'Children were given new names now, not their grandparents\'.' },
  // Songs and stories
  { id: 'frame-drums', kind: 'song', name: 'frame drums', effect: { mood: 2 },
    blurb: 'Hide drums on wooden hoops, played at every feast and most evenings.',
    took: 'The drums {p} brought from {land} were heard at the hearth most evenings after that, and {town} learned to dance to them.',
    scenes: ['{p} played the drum until {his} hands hurt, and {q} danced until {p} gave up.'],
    faded: 'The drums were quiet now. Nobody played them at the hearth.' },
  { id: 'winter-riddles', kind: 'song', name: 'riddle contests in winter', effect: { mood: 1 },
    blurb: 'Long winter evenings spent trading riddles, with a prize for the one nobody can answer.',
    took: 'Winter evenings in {town} turned into riddle contests, the way {p} said they passed the winter in {land}.',
    scenes: ['{p} asked a riddle at the winter fire that nobody could answer, and refused to tell even {q}.'],
    faded: 'The winter fires were quieter now. Nobody asked riddles any more.' },
  { id: 'ancestor-songs', kind: 'song', name: 'the long songs of the ancestors', effect: { mood: 1 },
    blurb: 'The old sing every family\'s line back to its beginning, and the young learn them by heart.',
    took: '{p} sang the long song of {his} family back to its beginning in {land}, and soon every family in {town} wanted its own song.',
    scenes: ['{p} sang the long song of the family, and {q} fell asleep somewhere around the fortieth name.'],
    faded: 'The long songs had been forgotten. Few in {town} could name their great-grandparents now.' },
  // Beliefs
  { id: 'holed-stones', kind: 'belief', name: 'holed stones over the door', effect: { mood: 1 },
    blurb: 'A stone with a hole worn through it hangs over the door to keep bad luck out.',
    took: '{p} hung a holed stone over the door, as everyone did in {land}. Soon the children of {town} were combing the river for them.',
    scenes: ['{p} found a holed stone in the river and gave it to {q}, which meant more than either of them said.'],
    faded: 'The holed stones came down from the doors, one by one.' },
  { id: 'bird-omens', kind: 'belief', name: 'reading the birds',
    blurb: 'Nothing important is begun without watching which way the birds fly.',
    took: 'Before long, nobody in {town} would start a house or a journey without watching the birds first, as {p} did in {land}.',
    scenes: ['{p} watched the birds all morning and decided not to plant that day, and {q} planted anyway.'],
    faded: 'People in {town} began things without watching the birds now.' },
  { id: 'first-bite', kind: 'belief', name: 'the first bite for the fire',
    blurb: 'The first bite of every meal is thrown in the fire, for the hearth.',
    took: 'Everyone in {town} began throwing the first bite of their meal into the fire, as {p} did in {land}. The hearth, they said, was always hungry.',
    scenes: ['{p} threw the first bite of the feast into the fire, and it was the only good piece.'],
    faded: 'People in {town} ate their first bite themselves now.' },
  { id: 'dressing-the-well', kind: 'belief', name: 'dressing the well', season: 0, effect: { health: 0.02 },
    blurb: 'Each spring the well is dressed with flowers, so it stays sweet.',
    took: 'In spring, {p} dressed the well with flowers, as they did in {land}. The next spring half of {town} came to help.',
    scenes: ['{p} and {q} dressed the well with blossom, and argued all morning about the colours.'],
    faded: 'The well went undressed in spring now.',
    needs: (s) => s.buildings.some((b) => b.kind === 'well' && !b.removed) },
];
export const CUSTOM_BY_ID = new Map(CUSTOMS.map((c) => [c.id, c]));

/** How many ways of each kind a town keeps at once. */
const ROOM: Record<CustomKind, number> = { feast: 2, craft: 2, food: 2, rite: 2, song: 1, belief: 1 };

export const KIND_LABEL: Record<CustomKind, string> = { feast: 'Feasts', craft: 'Crafts', food: 'Food', rite: 'Rites', song: 'Songs and stories', belief: 'Beliefs' };

const LAND_NAMES = ['the salt marshes', 'the high moors', 'the hill country', 'the coast', 'the river mouth', 'the oak valleys', 'the lake villages', 'the reed country', 'the stony uplands', 'the plains', 'the far forest', 'the islands'];
const DIRECTIONS = ['to the south', 'to the east', 'over the hills', 'downriver', 'upriver', 'far to the north', 'beyond the forest', 'to the west'];
const DEAD_WAYS: DeathCustom[] = ['burial', 'cremation', 'sky', 'tomb', 'river'];

export type { Culture, Homeland } from './types';

const culture = (s: GameState): Culture => (s.culture ??= { lands: [], kept: [] });
export const landOf = (s: GameState, id?: number) => (id === undefined ? undefined : culture(s).lands[id]);
export const keeps = (s: GameState, id: string) => culture(s).kept.some((k) => k.id === id);

/** A new homeland, with two or three ways of its own. */
export function newLand(s: GameState, avoid: string[] = []): Homeland {
  const c = culture(s);
  const r = s.rng;
  const used = new Set(c.lands.map((l) => l.name));
  let name = '';
  for (let i = 0; i < 12 && (!name || used.has(name)); i++) name = `${pick(r, LAND_NAMES)} ${pick(r, DIRECTIONS)}`;
  const pool = shuffle(r, CUSTOMS.filter((x) => !avoid.includes(x.id) && (x.needs?.(s) ?? true)).map((x) => x.id));
  // Different kinds of ways, so a homeland has a character, not three feasts.
  const customs: string[] = [];
  const kinds = new Set<CustomKind>();
  for (const id of pool) {
    const k = CUSTOM_BY_ID.get(id)!.kind;
    if (kinds.has(k)) continue;
    customs.push(id); kinds.add(k);
    if (customs.length >= (chance(r, 0.5) ? 3 : 2)) break;
  }
  const land: Homeland = { id: c.lands.length, name, customs, dead: chance(r, 0.6) ? pick(r, DEAD_WAYS) : undefined };
  c.lands.push(land);
  return land;
}

/**
 * Where a new party comes from: often a homeland that has sent people before (they follow their
 * kin, more the more of them are here), sometimes somewhere new.
 */
export function pickLand(s: GameState): Homeland {
  const c = culture(s);
  const people = present(s);
  const from = new Map<number, number>();
  for (const p of people) if (p.land !== undefined && p.land !== c.home) from.set(p.land, (from.get(p.land) ?? 0) + 1);
  const options: [Homeland | null, number][] = [[null, 6]];
  for (const [id, n] of from) options.push([c.lands[id], 1 + Math.sqrt(n) * 1.5]);
  return weighted(s.rng, options) ?? newLand(s);
}

/** Someone new carries most of their homeland's ways. */
export function waysOf(s: GameState, land: Homeland): string[] {
  return land.customs.filter(() => chance(s.rng, 0.85));
}

/** A child grows up in most of the ways their parents keep. */
export function inheritWays(s: GameState, mother: Person, father: Person | undefined): string[] {
  const all = new Set([...(mother.customs ?? []), ...(father?.customs ?? [])]);
  return [...all].filter(() => chance(s.rng, 0.85));
}

/** The founders' homeland: every settlement begins with ways of its own. */
export function foundingWays(s: GameState) {
  const land = newLand(s);
  culture(s).home = land.id;
  for (const p of s.people) { p.land = land.id; p.customs = [...land.customs]; }
  for (const id of land.customs) culture(s).kept.push({ id, since: s.day, land: land.id });
  return land;
}

/** "the midsummer fires and frame drums" */
export function waysPhrase(ids: string[]): string {
  const names = ids.map((id) => CUSTOM_BY_ID.get(id)?.name).filter(Boolean) as string[];
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** How many of the town (6 and older) keep a way, 0..1. */
export function shareOf(s: GameState, id: string, people = present(s).filter((p) => ageOf(s, p) >= 6)): number {
  return people.filter((p) => p.customs?.includes(id)).length / Math.max(1, people.length);
}

/** The ways being kept by anyone here, with how widely, most widely kept first. */
export function waysHere(s: GameState): { id: string; share: number; kept: boolean; land?: number }[] {
  const people = present(s).filter((p) => ageOf(s, p) >= 6);
  const ids = new Set<string>();
  for (const p of people) for (const id of p.customs ?? []) ids.add(id);
  for (const k of culture(s).kept) ids.add(k.id);
  return [...ids].map((id) => {
    const kept = culture(s).kept.find((k) => k.id === id);
    const land = kept?.land ?? culture(s).lands.find((l) => l.customs.includes(id))?.id;
    return { id, share: shareOf(s, id, people), kept: !!kept, land };
  }).sort((a, b) => Number(b.kept) - Number(a.kept) || b.share - a.share);
}

export type NudgeResult = { ok: true } | { ok: false; reason: string };

/** Spend a Spark to encourage a way (or discourage it) for three years. */
export function nudgeWay(s: GameState, id: string, up: boolean): NudgeResult {
  if (!CUSTOM_BY_ID.has(id)) return { ok: false, reason: 'No such custom.' };
  if ((s.sparks ?? 0) < 1) return { ok: false, reason: 'That takes a Spark.' };
  s.sparks -= 1;
  culture(s).nudge = { id, until: s.day + 3 * 360, up };
  const c = CUSTOM_BY_ID.get(id)!;
  log(s, 'patron', up
    ? `For no reason anyone could name, everyone in ${s.name} was talking about ${c.name} that year.`
    : `For no reason anyone could name, people in ${s.name} began to find ${c.name} a little old-fashioned.`, [], 2);
  return { ok: true };
}

/** Once a year: ways spread, take root, or fade, and the feasts are kept. */
export function cultureYear(s: GameState) {
  const c = culture(s);
  const r = s.rng;
  const people = present(s);
  if (!people.length) return;
  const nudge = c.nudge && c.nudge.until > s.day ? c.nudge : undefined;
  if (c.nudge && !nudge) c.nudge = undefined;
  const pull = (id: string) => (nudge?.id === id ? (nudge.up ? 2.2 : 0.3) : 1);
  const kept = new Set(c.kept.map((k) => k.id));

  // Spreading: from husband to wife and back, from the town's own ways, and between neighbours.
  // Ways the town doesn't share are slowly let go, unless family keeps them up.
  for (const p of people) {
    if (ageOf(s, p) < 6) continue;
    const has = (p.customs ??= []);
    const spouse = p.spouse !== undefined ? s.people[p.spouse] : undefined;
    for (const id of spouse?.customs ?? []) if (!has.includes(id) && chance(r, 0.2 * pull(id))) has.push(id);
    for (const id of kept) if (!has.includes(id) && chance(r, 0.06 * pull(id))) has.push(id);
    const other = people[int(r, 0, people.length - 1)];
    for (const id of other.customs ?? []) if (!has.includes(id) && chance(r, 0.025 * pull(id))) has.push(id);
    for (let i = has.length - 1; i >= 0; i--) {
      const id = has[i];
      const family = spouse?.customs?.includes(id);
      const drop = kept.has(id) ? 0.01 : family ? 0.02 : 0.05;
      if (chance(r, drop / pull(id))) has.splice(i, 1);
    }
  }

  // Taking root, and fading. A town keeps only so many ways of each kind (a couple of feasts,
  // a couple of crafts...): a new way that more people keep than the least-kept of its kind
  // takes that one's place.
  const ages6 = people.filter((p) => ageOf(s, p) >= 6);
  const shares = new Map(CUSTOMS.map((x) => [x.id, shareOf(s, x.id, ages6)]));
  for (const custom of shuffle(r, CUSTOMS.slice())) {
    const share = shares.get(custom.id)!;
    if (!c.kept.some((k) => k.id === custom.id)) {
      const bar = nudge?.id === custom.id && nudge.up ? 0.2 : 0.3;
      if (share < bar || !chance(r, 0.5)) continue;
      const sameKind = c.kept.filter((k) => CUSTOM_BY_ID.get(k.id)?.kind === custom.kind);
      let displaced: Custom | undefined;
      if (sameKind.length >= ROOM[custom.kind]) {
        const weakest = sameKind.reduce((a, b) => ((shares.get(a.id) ?? 0) <= (shares.get(b.id) ?? 0) ? a : b));
        if ((shares.get(weakest.id) ?? 0) >= share) continue;
        displaced = CUSTOM_BY_ID.get(weakest.id);
        c.kept = c.kept.filter((k) => k !== weakest);
      }
      const land = c.lands.find((l) => l.customs.includes(custom.id) && l.id !== c.home);
      const carriers = ages6.filter((p) => p.customs?.includes(custom.id) && p.origin !== 'born');
      const by = carriers.find((p) => p.land === land?.id) ?? carriers[0] ?? ages6.find((p) => p.customs?.includes(custom.id));
      c.kept.push({ id: custom.id, since: s.day, land: land?.id, by: by?.id });
      if (by) {
        const instead = displaced ? ` ${cap(displaced.name)}, which ${s.name} had kept before, slowly gave way to it.` : '';
        log(s, 'season', fill(custom.took, s, by, undefined, land) + instead, [by.id], 4, yearName(custom));
      }
    } else if (share < 0.06 && chance(r, 0.4)) {
      c.kept = c.kept.filter((k) => k.id !== custom.id);
      log(s, 'season', fill(custom.faded, s, undefined, undefined, undefined), [], 2);
    }
  }

  // The town's ways, kept: now and then a little scene.
  for (const k of c.kept) {
    const custom = CUSTOM_BY_ID.get(k.id);
    if (!custom || !chance(r, 0.25)) continue;
    const keepers = ages6.filter((p) => p.customs?.includes(k.id));
    if (keepers.length < 2) continue;
    const a = pick(r, keepers);
    const b = pick(r, keepers.filter((p) => p !== a));
    log(s, 'season', fill(pick(r, custom.scenes), s, a, b, landOf(s, k.land)), [a.id, b.id], 1);
  }

  // Kept feasts and songs lift everyone a little; a way of their own lifts those who keep it.
  const lift = c.kept.reduce((n, k) => n + (CUSTOM_BY_ID.get(k.id)?.effect?.mood ?? 0), 0);
  for (const p of people) p.mood += Math.min(8, lift) + Math.min(3, (p.customs?.length ?? 0) * 0.5);
}

/** What the town's ways do for it (as multipliers), for the economy and health. */
export function cultureBoost(s: GameState, kind: 'food' | 'goods' | 'health'): number {
  let v = 1;
  for (const k of s.culture?.kept ?? []) v += CUSTOM_BY_ID.get(k.id)?.effect?.[kind] ?? 0;
  return Math.min(1.12, v);
}

/** The way with the dead that most people here grew up with, and how many, if any. */
export function deadWayHere(s: GameState): { way: DeathCustom; share: number } | undefined {
  const people = present(s).filter((p) => ageOf(s, p) >= 16);
  const count = new Map<DeathCustom, number>();
  for (const p of people) {
    const way = landOf(s, p.land)?.dead;
    if (way) count.set(way, (count.get(way) ?? 0) + 1);
  }
  let best: { way: DeathCustom; share: number } | undefined;
  for (const [way, n] of count) if (!best || n > best.share) best = { way, share: n };
  return best ? { way: best.way, share: best.share / Math.max(1, people.length) } : undefined;
}

function yearName(c: Custom): string | undefined {
  return c.kind === 'feast' ? `The Year of ${cap(c.name)}` : undefined;
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

function fill(text: string, s: GameState, p?: Person, q?: Person, land?: Homeland): string {
  const he = p?.sex === 'f' ? 'she' : 'he', him = p?.sex === 'f' ? 'her' : 'him', his = p?.sex === 'f' ? 'her' : 'his';
  return cap(text
    .replace(/\{town\}/g, s.name)
    .replace(/\{land\}/g, land?.name ?? 'the old country')
    .replace(/\{p\}/g, p ? P(p.id) : 'someone')
    .replace(/\{q\}/g, q ? F(q.id) : 'a neighbour')
    .replace(/\{he\}/g, he).replace(/\{him\}/g, him).replace(/\{his\}/g, his));
}

/** Older villages: everyone keeps the ways of a homeland they no longer remember. */
export function migrateCulture(s: GameState) {
  if (s.culture) return;
  s.culture = { lands: [], kept: [] };
  const land = newLand(s);
  s.culture.home = land.id;
  for (const p of s.people) { p.land ??= land.id; p.customs ??= [...land.customs]; }
  for (const id of land.customs) s.culture.kept.push({ id, since: 0, land: land.id });
}
