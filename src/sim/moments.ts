// Small moments: the everyday texture of life between the big events.
// Quarrels, friendships, children's games, stories at the fire. They're
// minor entries in the Chronicle, but they make the place feel lived in.
import { log, P } from './chronicle';
import { chance, pick } from './rng';
import type { GameState, Person } from './types';
import { tellTale } from './tales';
import { leaderTitle } from './society';
import { ageOf, hasTrait, possessive, present, pronoun, seasonIndex } from './world';

type Moment = (s: GameState, people: Person[]) => { text: string; who: Person[]; weight?: number } | null;

const adults = (s: GameState, ps: Person[]) => ps.filter((p) => ageOf(s, p) >= 16 && !p.sick && !p.injured);
const kids = (s: GameState, ps: Person[]) => ps.filter((p) => { const a = ageOf(s, p); return a >= 4 && a < 14; });
const elders = (s: GameState, ps: Person[]) => ps.filter((p) => ageOf(s, p) >= 55);
const withTrait = (ps: Person[], ...t: Person['traits'][number][]) => ps.filter((p) => t.some((x) => hasTrait(p, x)));
const two = (s: GameState, ps: Person[]): [Person, Person] | null => {
  if (ps.length < 2) return null;
  const a = pick(s.rng, ps);
  const b = pick(s.rng, ps.filter((x) => x.id !== a.id));
  return [a, b];
};
const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

const MOMENTS: Moment[] = [
  (s, ps) => {
    const k = kids(s, ps);
    const e = pick(s.rng, [...elders(s, ps), ...adults(s, ps)]);
    if (!k.length || !e) return null;
    const c = pick(s.rng, k);
    return { text: pick(s.rng, [
      `${P(e.id)} taught ${P(c.id)} to skip stones on the river. ${cap(pronoun(c))} managed seven.`,
      `${P(c.id)} followed ${P(e.id)} around all day, asking why the sky was blue.`,
      `${P(e.id)} carved a little wooden horse for ${P(c.id)}.`,
    ]), who: [e, c] };
  },
  (s, ps) => {
    const e = elders(s, ps);
    if (!e.length) return null;
    const p = pick(s.rng, e);
    return { text: pick(s.rng, [
      `${P(p.id)} told the old story of the drowned king by the fire, and the children didn't sleep for a week.`,
      `One night by the fire, ${P(p.id)} sang the song of ${possessive(p)} grandmother's village. Nobody else knew the words.`,
      `${P(p.id)} predicted rain from the ache in ${possessive(p)} knees. It rained.`,
    ]), who: [p] };
  },
  (s, ps) => {
    const pair = two(s, adults(s, ps));
    if (!pair) return null;
    const [a, b] = pair;
    if (!hasTrait(a, 'kind') && !hasTrait(a, 'generous') && !hasTrait(a, 'gregarious')) return null;
    return { text: pick(s.rng, [
      `${P(a.id)} helped ${P(b.id)} rethatch a leaking roof, and the two became fast friends.`,
      `When ${P(b.id)} was down to nothing, ${P(a.id)} left a basket of bread on the doorstep and never mentioned it.`,
      `${P(a.id)} and ${P(b.id)} spent the evening laughing by the river. Nobody could hear what was so funny.`,
    ]), who: [a, b] };
  },
  (s, ps) => {
    const k = kids(s, ps);
    if (k.length < 2) return null;
    const pair = two(s, k)!;
    return { text: pick(s.rng, [
      `${P(pair[0].id)} and ${P(pair[1].id)} built a dam across the stream and flooded the path.`,
      `${P(pair[0].id)} dared ${P(pair[1].id)} to walk to the edge of the dark woods at night. ${cap(pronoun(pair[1]))} did, and ran all the way home.`,
      `The children played at founding a village of their own, with ${P(pair[0].id)} as ${leaderTitle(s).toLowerCase()}.`,
    ]), who: pair };
  },
  (s, ps) => {
    const p = pick(s.rng, withTrait(adults(s, ps), 'curious', 'clever'));
    if (!p) return null;
    return { text: pick(s.rng, [
      `${P(p.id)} spent a whole season trying to work out why some clay cracks in the fire and some doesn't.`,
      `${P(p.id)} found a strange shell in the riverbank, far from any sea, and kept it on a string.`,
      `${P(p.id)} counted the stars over the river for three nights running, and gave up at four hundred.`,
    ]), who: [p] };
  },
  (s, ps) => {
    const p = pick(s.rng, withTrait(adults(s, ps), 'lazy', 'content'));
    if (!p) return null;
    return { text: `${P(p.id)} was found asleep in the sun when ${pronoun(p)} should have been working. Nobody had the heart to wake ${p.sex === 'f' ? 'her' : 'him'}.`, who: [p] };
  },
  (s, ps) => {
    const p = pick(s.rng, withTrait(adults(s, ps), 'pious'));
    if (!p) return null;
    return { text: pick(s.rng, [
      `${P(p.id)} left a bowl of milk beside the hearth every night that season, and swore something drank it.`,
      `${P(p.id)} said the fire spoke to ${p.sex === 'f' ? 'her' : 'him'} in the night. Some people laughed. Some didn't.`,
    ]), who: [p] };
  },
  (s, ps) => {
    const season = seasonIndex(s.day);
    const p = pick(s.rng, adults(s, ps));
    if (!p) return null;
    const lines = [
      [`${P(p.id)} found the first violets of spring by the river and brought them to the fire.`, `The geese came back up the river, and ${P(p.id)} counted them in.`],
      [`On the hottest day of the summer, half of ${s.name} spent the afternoon in the river. ${P(p.id)} was first in.`, `A thunderstorm rolled through, and ${P(p.id)} danced in the rain.`],
      [`${P(p.id)} found a hollow tree full of honey and came home stung and grinning.`, `The leaves turned, and ${P(p.id)} said it was the most beautiful autumn ${pronoun(p)} could remember.`],
      [`${P(p.id)} slipped on the frozen river and lay laughing on the ice.`, `The snow came deep, and ${P(p.id)} dug a path from every door to the fire.`],
    ][season];
    return { text: pick(s.rng, lines), who: [p] };
  },
  (s, ps) => {
    const p = pick(s.rng, withTrait(adults(s, ps), 'ambitious'));
    if (!p) return null;
    return { text: `${P(p.id)} gave a long speech at the fire about how ${s.name} should be run. A few people nodded.`, who: [p] };
  },
  (s, ps) => {
    const p = pick(s.rng, withTrait(adults(s, ps), 'restless'));
    if (!p) return null;
    return { text: `${P(p.id)} climbed the tallest tree on the ridge to see what was beyond the hills. ${cap(pronoun(p))} came down very quiet.`, who: [p] };
  },
  (s) => {
    if (s.settings.weirdness < 1) return null;
    return { text: pick(s.rng, [
      `For one night the river ran silent, without a sound, and everyone noticed and nobody said.`,
      `A white stag was seen at the edge of the woods. It looked at the fire for a long time, then left.`,
    ]), who: [], weight: 2 };
  },
];

/** A few times a season, something small happens. */
export function momentsDay(s: GameState) {
  if (s.day % 3 !== 1) return;
  const people = present(s);
  if (people.length < 3) return;
  if (!chance(s.rng, Math.min(0.45, 0.14 + people.length / 220))) return;
  // Most small things are told fresh, from who's involved and what's going on.
  if (chance(s.rng, 0.7) && tellTale(s)) return;
  // Don't repeat any of the last few kinds of moment.
  const recent = (s.flags.recentMoments ??= []);
  const choices = MOMENTS.map((_, i) => i).filter((i) => !recent.includes(i));
  const index = pick(s.rng, choices);
  const m = MOMENTS[index](s, people);
  if (!m) return;
  // The same small moment doesn't happen to the same people twice in a few years.
  const since = s.day - 8 * 360;
  for (let i = s.chronicle.length - 1; i >= 0 && s.chronicle[i].day >= since; i--) {
    if (s.chronicle[i].kind === 'season' && s.chronicle[i].text === m.text) return;
  }
  recent.push(index);
  if (recent.length > 5) recent.shift();
  log(s, 'season', m.text, m.who.map((p) => p.id), m.weight ?? 1);
}
