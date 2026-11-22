// Traditions: how a village honors its dead, and how it governs itself.
// Neither is fixed in advance. The first death decides the first custom,
// shaped by the land, the people and their beliefs; the first contested
// choice of leader decides the first form of rule. Both can change, rarely,
// when a faith grows strong, a plague comes, or a crisis tests the old way.
import { deadWayHere } from './culture';
import { log, P } from './chronicle';
import { chance, pick, weighted } from './rng';
import { TERRAIN, type Building, type GameState, type Person, type TenetId } from './types';
import { ageOf, present } from './world';
import { addBuilding, findSite } from './planner';
import { isWater } from './mapgen';

export type DeathCustom = 'burial' | 'cremation' | 'sky' | 'tomb' | 'river';
export type RuleForm = 'eldest' | 'chief' | 'council' | 'assembly' | 'guilds';

export const CUSTOM_LABEL: Record<DeathCustom, string> = {
  burial: 'bury their dead', cremation: 'burn their dead on a pyre', sky: 'give their dead to the sky, on a platform for the birds',
  tomb: 'lay their dead in family tombs', river: 'give their dead to the river',
};
export const RULE_LABEL: Record<RuleForm, string> = {
  eldest: 'People bring their quarrels to the eldest, who speaks for everyone.',
  chief: 'A chief rules, and makes the laws.',
  council: 'A council of elders governs, led by a chief elder. Laws need the council’s agreement.',
  assembly: 'Every household has a voice at the assembly by the hearth, and a speaker keeps order. Laws need the assembly’s agreement.',
  guilds: 'The masters of the guilds govern together, led by the first among them.',
};

/** Where each custom keeps (or sends off) its dead. */
export const CUSTOM_SITE: Record<DeathCustom, Building['kind']> = {
  burial: 'graveyard', cremation: 'pyre', sky: 'skyplatform', tomb: 'tomb', river: 'landing',
};

const tenetsHeld = (s: GameState): Set<TenetId> => {
  const out = new Set<TenetId>();
  for (const f of s.faiths) if (!f.gone) for (const t of f.tenets) out.add(t);
  return out;
};

/** The village's character, as it bears on how to treat the dead. */
function customWeights(s: GameState): [DeathCustom, number][] {
  const { map } = s;
  let rock = 0, forest = 0, water = 0, n = 0;
  const R = 12;
  for (let y = Math.max(0, s.hearth.y - R); y < Math.min(map.h, s.hearth.y + R); y++) {
    for (let x = Math.max(0, s.hearth.x - R); x < Math.min(map.w, s.hearth.x + R); x++) {
      const i = y * map.w + x;
      n++;
      if (map.terrain[i] === TERRAIN.ROCK) rock++;
      if (map.trees[i]) forest++;
      if (isWater(map.terrain[i])) water++;
    }
  }
  const tenets = tenetsHeld(s);
  const people = present(s);
  const share = (t: string) => people.filter((p) => p.traits.includes(t as never)).length / Math.max(1, people.length);
  // The way most of them grew up with, in the homeland they came from.
  const home = deadWayHere(s);
  const grew = (way: DeathCustom) => (home?.way === way ? 8 * home.share : 0);
  return [
    ['burial', 3 + share('content') * 4 + share('homebody') * 3 + grew('burial')],
    ['cremation', 1 + (forest / Math.max(1, n)) * 6 + (tenets.has('hearth') ? 4 : 0) + (s.plague ? 3 : 0) + grew('cremation')],
    ['sky', 0.4 + (rock / Math.max(1, n)) * 12 + (tenets.has('comet') ? 2 : 0) + s.settings.weirdness * 0.3 + grew('sky')],
    ['tomb', 0.8 + (tenets.has('ancestors') ? 4 : 0) + (rock / Math.max(1, n)) * 5 + (s.buildings.some((b) => b.kind === 'barrow' && !b.removed) ? 3 : 0) + grew('tomb')],
    ['river', 0.4 + (water / Math.max(1, n)) * 8 + (tenets.has('river') ? 5 : 0) + grew('river')],
  ];
}

const FIRST_FUNERAL: Record<DeathCustom, string> = {
  burial: '{town} buried {p} in the ground at the edge of the meadow, with a stone to mark the place. That became the way.',
  cremation: '{town} built a pyre for {p} at dusk and watched the sparks go up into the dark. From then on, that was how the dead of {town} were sent on.',
  sky: '{town} carried {p} up to the high ground and laid {them} on a platform of poles under the open sky, for the birds. It seemed right to them, and it became the way.',
  tomb: '{town} built {p} a chamber of stones and earth, big enough for {their} family to join {them} one day. From then on, the dead of {town} were laid with their kin.',
  river: '{town} laid {p} on a raft of reeds with flowers and a little fire, and pushed {them} out onto the river at dawn. That became the way.',
};

/** A line for a child's rites, by the village's custom (or none, before there is one). */
export function smallRites(s: GameState, them: string): string {
  switch (s.traditions.dead?.custom) {
    case 'burial': return 'A tiny grave was dug at the edge of the burial ground.';
    case 'cremation': return `The pyre they built for ${them} was a small one.`;
    case 'sky': return `${them === 'him' ? 'His' : 'Her'} father carried ${them} up to the platform alone.`;
    case 'tomb': return `A small bundle was laid in the family tomb.`;
    case 'river': return `The raft they made for ${them} was hardly bigger than a basket.`;
    default: return `${them === 'him' ? 'His' : 'Her'} mother would not let anyone else carry ${them}.`;
  }
}

/** Someone has died at home: lay them to rest by the village's custom (deciding it, the first time). */
export function layToRest(s: GameState, p: Person) {
  const t = s.traditions;
  if (!t.dead) {
    const custom = weighted(s.rng, customWeights(s));
    t.dead = { custom, since: s.day };
    log(s, 'death', fill(FIRST_FUNERAL[custom], s, p), [p.id], 6, `The Year of the First Funeral`);
  }
  const custom = t.dead.custom;
  const site = siteFor(s, custom, p);
  if (custom === 'burial' && site) {
    // Graves fill the burial ground in rows; a full ground spills into a new one later.
    const n = s.graves.filter((g) => g.x >= site.x && g.x < site.x + 3 && g.y >= site.y && g.y < site.y + 3).length;
    const slot = n % 16;
    s.graves.push({ id: s.nextId.grave++, x: site.x + (slot % 4) * 0.72 + 0.25, y: site.y + Math.floor(slot / 4) * 0.72 + 0.25, person: p.id, day: s.day });
    if (n >= 15) s.flags.graveyard = undefined;
  } else if (site) {
    // No grave to mark: the place keeps a list of the dead it has seen off.
    (site.dead ??= []).push(p.id);
    if (custom === 'cremation') site.lastFire = s.day;
  }
}

function siteFor(s: GameState, custom: DeathCustom, p: Person): Building | undefined {
  const kind = CUSTOM_SITE[custom];
  if (custom === 'burial') {
    let yard = s.flags.graveyard !== undefined ? s.buildings[s.flags.graveyard] : undefined;
    if (!yard || yard.removed) {
      const at = findSite(s, 'graveyard');
      if (!at) return undefined;
      yard = addBuilding(s, 'graveyard', at.x, at.y, { built: true });
      s.flags.graveyard = yard.id;
    }
    return yard;
  }
  if (custom === 'tomb') {
    // Each family line has its tomb, by family name.
    const existing = s.buildings.find((b) => b.kind === 'tomb' && !b.removed && b.name === `the tomb of the ${p.family}s`);
    if (existing) return existing;
    const shared = s.buildings.filter((b) => b.kind === 'tomb' && !b.removed);
    if (shared.length >= 8) return pick(s.rng, shared);
  } else {
    const existing = s.buildings.find((b) => b.kind === kind && !b.removed);
    if (existing) return existing;
  }
  const at = findSite(s, kind);
  if (!at) return undefined;
  const b = addBuilding(s, kind, at.x, at.y, { built: true });
  if (custom === 'tomb') b.name = `the tomb of the ${p.family}s`;
  return b;
}

const fill = (t: string, s: GameState, p: Person) => t
  .replace(/\{town\}/g, s.name).replace(/\{p\}/g, P(p.id))
  .replace(/\{them\}/g, p.sex === 'f' ? 'her' : 'him').replace(/\{their\}/g, p.sex === 'f' ? 'her' : 'his');

const NEW_CUSTOM: Record<DeathCustom, string> = {
  burial: 'From then on, {town} buried its dead.',
  cremation: 'From then on, {town} burned its dead.',
  sky: 'From then on, {town} gave its dead to the sky.',
  tomb: 'From then on, {town} laid its dead in family tombs.',
  river: 'From then on, {town} gave its dead to the river.',
};

/** Once a year: a strong faith, or the memory of a plague, can change how the dead are treated. */
export function traditionsYear(s: GameState) {
  const t = s.traditions;
  if (t.dead && s.day - t.dead.since > 30 * 360 && chance(s.rng, 0.04)) {
    const people = present(s);
    // A faith most people hold can bring its own way with the dead.
    for (const f of s.faiths) {
      if (f.gone) continue;
      const share = people.filter((p) => p.faith === f.id).length / Math.max(1, people.length);
      if (share < 0.5) continue;
      const want: DeathCustom | undefined = f.tenets.includes('hearth') ? 'cremation' : f.tenets.includes('river') ? 'river' : f.tenets.includes('ancestors') ? 'tomb' : f.tenets.includes('land') ? 'burial' : undefined;
      if (want && want !== t.dead.custom) {
        changeCustom(s, want, `${capFirst(f.name)} had grown until most of ${s.name} followed it, and its people would not ${CUSTOM_LABEL[t.dead.custom]} any longer.`);
        return;
      }
    }
  }
  // Newcomers who mostly grew up with another way with the dead, and are now most of the town.
  if (t.dead && s.day - t.dead.since > 15 * 360 && chance(s.rng, 0.05)) {
    const home = deadWayHere(s);
    if (home && home.share >= 0.55 && home.way !== t.dead.custom) {
      changeCustom(s, home.way, `Most of ${s.name} had come from places where people ${CUSTOM_LABEL[home.way]}, and in time the old way of the first settlers gave way to theirs.`);
      return;
    }
  }
  // Leadership: a village that has outgrown its old ways of deciding things.
  rulesYear(s);
}

function changeCustom(s: GameState, custom: DeathCustom, why: string) {
  const t = s.traditions;
  t.history.push({ day: s.day, kind: 'dead', from: t.dead!.custom, to: custom });
  t.dead = { custom, since: s.day };
  log(s, 'faith', `${why} ${NEW_CUSTOM[custom].replace('{town}', s.name)}`, [], 7, 'The Year the Old Way Changed');
}

/** After a plague: the sick dead were burned, and some villages keep to it afterwards. */
export function afterPlague(s: GameState, deaths: number) {
  const t = s.traditions;
  if (!t.dead || t.dead.custom === 'cremation' || deaths < 6) return;
  if (chance(s.rng, 0.35)) changeCustom(s, 'cremation', `During the sickness the dead were burned, for fear of it spreading, and afterwards nobody wanted to go back.`);
}

const capFirst = (x: string) => x[0].toUpperCase() + x.slice(1);

// ---------------------------------------------------------------------------
// Rule

/** How the village is governed now. A settlement listens to its eldest. */
export function ruleForm(s: GameState): RuleForm {
  return s.traditions.rule?.form ?? 'eldest';
}

export function leaderTitleFor(s: GameState): string {
  switch (ruleForm(s)) {
    case 'eldest': return 'Eldest';
    case 'chief': return s.stage === 'city' || s.stage === 'metropolis' ? 'Lord' : 'Chief';
    case 'council': return 'Chief Elder';
    case 'assembly': return 'Speaker';
    case 'guilds': return 'First Master';
  }
}

/** The village's character, as it bears on how to govern itself. */
function ruleWeights(s: GameState): [RuleForm, number][] {
  const people = present(s).filter((p) => ageOf(s, p) >= 16);
  const share = (t: string) => people.filter((p) => p.traits.includes(t as never)).length / Math.max(1, people.length);
  const old = people.filter((p) => ageOf(s, p) >= 50).length / Math.max(1, people.length);
  const leader = s.leader ? s.people[s.leader.person] : undefined;
  return [
    ['chief', 2 + share('ambitious') * 8 + share('brave') * 4 + (leader?.traits.includes('ambitious') ? 3 : 0)],
    ['council', 2 + old * 8 + share('content') * 4 + (s.laws.some((l) => l.id === 'elders-voice') ? 5 : 0)],
    ['assembly', 1 + share('gregarious') * 6 + share('kind') * 4 + share('honest') * 4 + (s.laws.some((l) => l.id === 'open-gates') ? 2 : 0)],
    ['guilds', s.guilds.filter((g) => !g.gone).length >= 3 ? 4 : 0],
  ];
}

const NEW_RULE: Record<RuleForm, string> = {
  eldest: '',
  chief: 'From then on, {town} had a chief, and the chief made the laws.',
  council: 'From then on, {town} was governed by a council of its elders, with a chief elder to speak for them.',
  assembly: 'From then on, every household in {town} had a voice at the assembly by the hearth, and a speaker kept order.',
  guilds: 'From then on, the masters of the guilds governed {town} together.',
};

/** A settlement becoming a village decides how it will govern itself. */
export function chooseRule(s: GameState, why: string) {
  const form = weighted(s.rng, ruleWeights(s));
  setRule(s, form, why);
}

function setRule(s: GameState, form: RuleForm, why: string) {
  const t = s.traditions;
  if (t.rule) t.history.push({ day: s.day, kind: 'rule', from: t.rule.form, to: form });
  t.rule = { form, since: s.day };
  s.council = [];
  fillCouncil(s);
  log(s, 'leader', `${why} ${NEW_RULE[form].replace('{town}', s.name)}`.trim(), [], 7, form === 'eldest' ? undefined : 'The Year of the New Way');
}

/** Council members: elders and the respected (or, for the guilds, their masters). */
export function fillCouncil(s: GameState) {
  const form = ruleForm(s);
  if (form !== 'council' && form !== 'guilds') { s.council = []; return; }
  const size = Math.min(7, 3 + Math.floor(present(s).length / 120));
  s.council = (s.council ?? []).filter((id) => { const p = s.people[id]; return p?.alive && !p.left && p.away === undefined; });
  const pool = form === 'guilds'
    ? s.guilds.filter((g) => !g.gone && g.master !== undefined).map((g) => s.people[g.master!]).filter((p) => p?.alive)
    : present(s).filter((p) => ageOf(s, p) >= 45).sort((a, b) => b.renown + ageOf(s, b) * 0.5 - (a.renown + ageOf(s, a) * 0.5));
  for (const p of pool) {
    if (s.council.length >= size) break;
    if (!s.council.includes(p.id)) s.council.push(p.id);
  }
}

/** Does the village agree to a law its leader wants? Under a council or assembly, it has to. */
export function agreesTo(s: GameState, approve: (p: Person) => number): boolean {
  const form = ruleForm(s);
  if (form === 'eldest' || form === 'chief') return true;
  const voters = form === 'assembly'
    ? present(s).filter((p) => ageOf(s, p) >= 16)
    : (s.council ?? []).map((id) => s.people[id]).filter((p): p is Person => !!p && p.alive);
  if (!voters.length) return true;
  const yes = voters.filter((p) => approve(p) >= 0).length;
  return yes > voters.length / 2;
}

/** Once a year: forms of rule meet their tests. */
function rulesYear(s: GameState) {
  const t = s.traditions;
  if (!t.rule) return;
  fillCouncil(s);
  const form = t.rule.form;
  const years = (s.day - t.rule.since) / 360;
  if (years < 20 || !chance(s.rng, 0.05)) return;
  const people = present(s);
  const unhappy = people.filter((p) => p.mood < 0).length / Math.max(1, people.length);
  const leader = s.leader ? s.people[s.leader.person] : undefined;
  if (form === 'assembly' && people.length > 400) {
    setRule(s, 'council', `The assembly had grown too big to hear everyone, and the meetings went on for days.`);
  } else if (form === 'chief' && unhappy > 0.35) {
    setRule(s, pick(s.rng, ['council', 'assembly'] as const), `${s.name} had had enough of being ruled by one person.`);
  } else if ((form === 'council' || form === 'assembly') && leader?.traits.includes('ambitious') && leader.renown > 80) {
    setRule(s, 'chief', `${P(leader.id)} had grown more powerful than the ${form === 'council' ? 'council' : 'assembly'}, and in the end people stopped pretending otherwise.`);
  } else if (form !== 'guilds' && s.guilds.filter((g) => !g.gone).length >= 4 && chance(s.rng, 0.3)) {
    setRule(s, 'guilds', `The guilds held most of the wealth of ${s.name}, and in time they held the power too.`);
  }
}

/** For the Society panel: who sits on the council. */
export const councilOf = (s: GameState) => (s.council ?? []).map((id) => s.people[id]).filter((p): p is Person => !!p && p.alive);

