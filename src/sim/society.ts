// Society: who speaks for the settlement, the laws they make, the faiths
// that grow among the people, and the businesses with names over the door.
import { agreesTo, councilOf, fillCouncil, leaderTitleFor, ruleForm } from './traditions';
import { F, log, P } from './chronicle';
import { chance, int, pick, rand, weighted } from './rng';
import type { Faith, GameState, Law, LawId, Person, TenetId, TraitId } from './types';
import { ageOf, hasTrait, present, seasonIndex } from './world';

// ---------------------------------------------------------------------------
// Laws

export interface LawInfo {
  id: LawId;
  name: string;
  /** How the Chronicle phrases it: "declared that …". */
  decree: string;
  effect: string;
  likes: TraitId[];
  dislikes: TraitId[];
}

export const LAWS: LawInfo[] = [
  { id: 'share-harvest', name: 'Share the Harvest', decree: 'in a hungry season, the stores belong to everyone', effect: 'Hunger hurts less, and fewer families give up and leave.', likes: ['generous', 'kind'], dislikes: ['greedy', 'ambitious'] },
  { id: 'open-gates', name: 'Open Gates', decree: 'any traveler who asks may stay', effect: 'More people come to stay.', likes: ['kind', 'gregarious', 'curious'], dislikes: ['timid', 'cruel'] },
  { id: 'fever-huts', name: 'The Fever Huts', decree: 'the sick must sleep apart until they are well', effect: 'Fevers and plague spread more slowly and kill fewer.', likes: ['clever', 'skeptical'], dislikes: ['stubborn', 'gregarious'] },
  { id: 'feast-days', name: 'Feast Days', decree: 'the turn of every season is a feast day', effect: 'Everyone is happier; a little more food is eaten.', likes: ['cheerful', 'gregarious', 'generous'], dislikes: ['greedy', 'gloomy'] },
  { id: 'work-dawn', name: 'Work from Dawn', decree: 'every able hand works from dawn to dusk', effect: 'Everyone produces more, and likes it less.', likes: ['diligent', 'ambitious'], dislikes: ['lazy', 'content'] },
  { id: 'no-blades', name: 'No Blades at the Fire', decree: 'no blade may be drawn within sight of the hearth', effect: 'Fewer quarrels; a calmer settlement.', likes: ['kind', 'timid', 'honest'], dislikes: ['cruel', 'brave'] },
  { id: 'elders-voice', name: "The Elders' Voice", decree: 'no decision is made without the elders', effect: 'Elders are honored and happier; leaders are chosen older.', likes: ['content', 'pious'], dislikes: ['ambitious', 'restless'] },
  { id: 'tithe', name: 'The Hearth Tithe', decree: 'a share of every craft is given to the keepers of the hearth', effect: 'Faith spreads faster; fewer goods to go around.', likes: ['pious'], dislikes: ['greedy', 'skeptical'] },
];
export const LAW = Object.fromEntries(LAWS.map((l) => [l.id, l])) as Record<LawId, LawInfo>;

export const hasLaw = (s: GameState, id: LawId) => s.laws.some((l) => l.id === id);

/** How someone feels about a law: positive likes it. */
export function opinion(p: Person, id: LawId): number {
  const l = LAW[id];
  return l.likes.filter((t) => hasTrait(p, t)).length - l.dislikes.filter((t) => hasTrait(p, t)).length;
}

/** The mood laws in force put someone in. */
export function lawMood(s: GameState, p: Person): number {
  let m = 0;
  for (const l of s.laws) m += opinion(p, l.id) * 4;
  if (hasLaw(s, 'feast-days')) m += 5;
  if (hasLaw(s, 'work-dawn')) m -= 5;
  if (hasLaw(s, 'elders-voice') && ageOf(s, p) >= 55) m += 8;
  return m;
}

export function enactLaw(s: GameState, id: LawId, opts: { patron?: boolean } = {}): void {
  const leader = s.leader ? s.people[s.leader.person] : undefined;
  if (!leader || hasLaw(s, id)) return;
  const law: Law = { id, since: s.day, by: leader.id, patron: opts.patron };
  s.laws.push(law);
  const adults = present(s).filter((p) => ageOf(s, p) >= 16);
  const against = adults.filter((p) => opinion(p, id) < 0).length;
  const for_ = adults.filter((p) => opinion(p, id) > 0).length;
  const reaction = against > for_ * 1.5 ? ' There was grumbling around the fire for weeks.'
    : for_ > against * 1.5 ? ' Most people nodded; some cheered.' : '';
  const how = opts.patron ? `After a sleepless night, ${P(leader.id)} declared` : `${P(leader.id)} declared`;
  log(s, 'law', `${how} that ${LAW[id].decree}: ${LAW[id].name}.${reaction}`, [leader.id], 4, `The Year of ${LAW[id].name}`);
}

export function repealLaw(s: GameState, id: LawId, opts: { patron?: boolean } = {}): void {
  const leader = s.leader ? s.people[s.leader.person] : undefined;
  if (!leader || !hasLaw(s, id)) return;
  s.laws = s.laws.filter((l) => l.id !== id);
  log(s, 'law', `${opts.patron ? 'To everyone\'s surprise, ' : ''}${P(leader.id)} did away with ${LAW[id].name}.`, [leader.id], 3);
}

// ---------------------------------------------------------------------------
// Leadership

export function leaderTitle(s: GameState): string {
  return leaderTitleFor(s);
}

/** Someone always speaks for the settlement: a leader who dies or leaves is replaced at once. */
export function ensureLeader(s: GameState) {
  const cur = s.leader ? s.people[s.leader.person] : undefined;
  if (cur && cur.alive && !cur.left && cur.away === undefined) return;
  if (!s.leader && present(s).length < 3) return;
  chooseLeader(s, cur);
}

function leaderScore(s: GameState, p: Person): number {
  const age = ageOf(s, p);
  let v = p.renown + rand(s.rng) * 15;
  if (hasTrait(p, 'ambitious')) v += 25;
  if (hasTrait(p, 'gregarious')) v += 6;
  if (hasTrait(p, 'clever')) v += 6;
  if (hasTrait(p, 'honest')) v += 4;
  if (hasTrait(p, 'shy') || hasTrait(p, 'timid')) v -= 12;
  if (p.dream === 'lead') v += 15;
  v += s.stage === 'settlement' || hasLaw(s, 'elders-voice') ? age * 0.8 : -Math.abs(age - 42) * 0.4;
  return v;
}

function candidates(s: GameState): Person[] {
  const form = ruleForm(s);
  // Under a council (or the guilds), the leader comes from among its members.
  if (form === 'council' || form === 'guilds') {
    fillCouncil(s);
    const members = councilOf(s).filter((p) => p.away === undefined && !p.preparing);
    if (members.length) return members;
  }
  return present(s).filter((p) => { const a = ageOf(s, p); return a >= 22 && a <= 78 && !p.preparing; });
}

/** Each season: make sure someone speaks for the settlement, and let them govern. */
export function societySeason(s: GameState) {
  const cur = s.leader ? s.people[s.leader.person] : undefined;
  if (!cur || !cur.alive || cur.away !== undefined || cur.left) {
    chooseLeader(s, cur);
  } else if (ruleForm(s) === 'chief' && s.day - s.leader!.since > 360 * 3) {
    challenge(s, cur);
  } else if (ruleForm(s) === 'assembly' && s.day - s.leader!.since > 360 * 7) {
    chooseLeader(s, cur); // the assembly chooses its speaker again every few years
  }
  govern(s);
  holyDays(s);
}

function chooseLeader(s: GameState, previous?: Person) {
  const list = candidates(s);
  if (!list.length) { s.leader = undefined; return; }
  const ranked = list.map((p) => ({ p, v: leaderScore(s, p) })).sort((a, b) => b.v - a.v);
  const winner = ranked[0].p;
  const rival = ranked[1];
  s.leader = { person: winner.id, since: s.day };
  winner.renown += 15;
  if (winner.dream === 'lead') winner.dreamMet = true;
  const before = previous && !previous.alive ? `With ${F(previous.id)} gone, ` : previous ? `With ${F(previous.id)} away, ` : '';
  if (s.stage === 'settlement') {
    log(s, 'leader', `${before}people began bringing their quarrels to ${P(winner.id)}, and listening to the answers.`, [winner.id], 4, `The Year ${winner.first} Spoke for Us`);
  } else if (rival && hasTrait(rival.p, 'ambitious') && rival.v > ranked[0].v * 0.85) {
    log(s, 'leader', `${before}${P(winner.id)} and ${P(rival.p.id)} both claimed the chief's seat. The village gathered at the fire and, after a long night, chose ${F(winner.id)}.`, [winner.id, rival.p.id], 6, `The Year ${winner.first} Became Chief`);
    rival.p.mood -= 25;
  } else {
    log(s, 'leader', `${before}${P(winner.id)} took the chief's seat by the fire. Nobody stood up to argue.`, [winner.id], 5, `The Year ${winner.first} Became Chief`);
  }
}

/** An ambitious rival may challenge a chief who's grown unpopular. */
function challenge(s: GameState, chief: Person) {
  const unhappy = present(s).filter((p) => ageOf(s, p) >= 16 && p.mood < 0).length / Math.max(1, present(s).length);
  if (!chance(s.rng, 0.05 + unhappy * 0.4)) return;
  const rival = candidates(s).filter((p) => p.id !== chief.id && hasTrait(p, 'ambitious')).sort((a, b) => leaderScore(s, b) - leaderScore(s, a))[0];
  if (!rival) return;
  if (leaderScore(s, rival) + unhappy * 40 > leaderScore(s, chief)) {
    s.leader = { person: rival.id, since: s.day };
    rival.renown += 15;
    chief.mood -= 30;
    log(s, 'leader', `${P(rival.id)} stood up at the fire and said ${F(chief.id)} had led long enough. Enough people agreed. ${P(rival.id)} became chief.`, [rival.id, chief.id], 7, `The Year ${rival.first} Took the Seat`);
  } else {
    rival.mood -= 20;
    log(s, 'leader', `${P(rival.id)} challenged ${P(chief.id)} for the chief's seat, and lost. The two did not speak for a year.`, [rival.id, chief.id], 5);
  }
}

/** Leaders make (and unmake) laws according to who they are. */
function govern(s: GameState) {
  if (!s.leader || s.stage === 'settlement' && population(s) < 20) return;
  const leader = s.people[s.leader.person];
  let rate = 0.07;
  if (hasTrait(leader, 'ambitious')) rate += 0.05;
  if (hasTrait(leader, 'stubborn')) rate += 0.03;
  if (!chance(s.rng, rate)) return;
  const disliked = s.laws.filter((l) => opinion(leader, l.id) < 0 && !l.patron);
  if (disliked.length && chance(s.rng, 0.4)) { repealLaw(s, pick(s.rng, disliked).id); return; }
  if (s.laws.length >= 5) return;
  const options = LAWS.filter((l) => !hasLaw(s, l.id)).map((l) => [l.id, Math.max(0.2, 1 + opinion(leader, l.id) * 2 + situational(s, l.id))] as const);
  if (!options.length) return;
  const pickId = weighted(s.rng, options);
  if (opinion(leader, pickId) < 0) return;
  // A council or an assembly has to agree.
  if (!agreesTo(s, (p) => opinion(p, pickId))) {
    if (chance(s.rng, 0.3)) log(s, 'law', `${P(leader.id)} wanted ${LAW[pickId].name}, but the ${ruleForm(s) === 'assembly' ? 'assembly' : 'council'} would not agree to it.`, [leader.id], 3);
    return;
  }
  enactLaw(s, pickId);
}

function situational(s: GameState, id: LawId): number {
  if (id === 'share-harvest' && s.flags.hungerSince !== undefined) return 3;
  if (id === 'fever-huts' && s.plague) return 4;
  if (id === 'tithe' && s.faiths.some((f) => !f.gone)) return 1;
  return 0;
}

function population(s: GameState) { return present(s).length; }

// ---------------------------------------------------------------------------
// Faith

export const TENETS: Record<TenetId, { name: string; text: string }> = {
  hearth: { name: 'The Unseen Keeper', text: 'Someone unseen tends the first fire, and watches over those who keep it.' },
  ancestors: { name: 'The Ancestors', text: 'The dead watch over the living, and are owed a place at the meal.' },
  river: { name: 'The River', text: 'The river gives and the river takes; it must be thanked for both.' },
  peace: { name: 'Peace', text: 'No hand raised in anger. Ever.' },
  feasting: { name: 'Feasting', text: 'Joy shared is holy. Every harvest is a sacrament.' },
  austerity: { name: 'Austerity', text: 'Want little. Waste nothing. Fast at the turn of the year.' },
  comet: { name: 'The Wandering Star', text: 'The comet will return, and it will bring an ending, or a beginning.' },
  relics: { name: 'The Relics', text: 'Things from the far places carry power, and must be kept.' },
  land: { name: 'The Old Places', text: 'The stones, the groves and the springs were holy before anyone came here. They must be kept.' },
};

const FAITH_NAMES: Record<TenetId, string[]> = {
  hearth: ['the Keepers of the Flame', 'the Way of the Hearth', 'the Children of the Fire'],
  ancestors: ['the Long Remembering', 'the Way of the Grandmothers', 'the Kin of the Barrow'],
  river: ['the River Folk', 'the Way of the Water', 'the Followers of the Current'],
  peace: ['the Open Hands', 'the Gentle Way'],
  feasting: ['the Table of Plenty', 'the Harvest Kin'],
  austerity: ['the Bare Path', 'the Little Bowl'],
  comet: ['the Watchers of the Star', 'the Comet Kin'],
  relics: ['the Keepers of the Warm Stone', 'the Way of Far Things'],
  land: ['the Keepers of the Grove', 'the Way of the Old Places', 'the Ring Folk'],
};

/** Something happened that might inspire a faith. */
export function plantFaithSeed(s: GameState, kind: TenetId) {
  s.flags.faithSeeds = (s.flags.faithSeeds ?? 0) + 1;
  s.flags.faithSeedKind = kind;
}

export function followers(s: GameState, faithId: number): number {
  let n = 0;
  for (const p of s.people) if (p.alive && !p.left && p.faith === faithId) n++;
  return n;
}

/** A name no living faith already uses (a split takes a name of its own). */
function freshFaithName(s: GameState, tenets: TenetId[]): string {
  const taken = new Set(s.faiths.filter((f) => !f.gone).map((f) => f.name));
  const options = tenets.flatMap((t) => FAITH_NAMES[t]).filter((n) => !taken.has(n));
  if (options.length) return pick(s.rng, options);
  const base = pick(s.rng, FAITH_NAMES[tenets[0]]);
  return base.replace(/^the /, 'the New ');
}

export function foundFaith(s: GameState, founder: Person, tenets: TenetId[], name?: string, opts: { patron?: boolean; parent?: number } = {}): Faith {
  const faith: Faith = {
    id: s.nextId.faith++,
    name: name?.trim() || freshFaithName(s, tenets), // 'the Way of …': capitalized where shown
    founder: founder.id,
    founded: s.day,
    tenets,
    season: int(s.rng, 0, 3),
    parent: opts.parent,
  };
  s.faiths.push(faith);
  founder.faith = faith.id;
  founder.renown += 20;
  // The first followers: the prophet's household, and a few pious neighbours.
  const household = present(s).filter((p) => p.id !== founder.id && p.home !== undefined && p.home === founder.home && !hasTrait(p, 'skeptical'));
  const seekers = present(s).filter((p) => ageOf(s, p) >= 16 && hasTrait(p, 'pious') && (p.faith === undefined || s.faiths[p.faith]?.gone)).slice(0, opts.patron ? 4 : 2);
  for (const p of [...household, ...seekers]) p.faith = faith.id;
  const parent = opts.parent !== undefined ? s.faiths[opts.parent] : undefined;
  const text = parent
    ? `${P(founder.id)} broke with ${parent.name}, saying they had forgotten ${TENETS[tenets[0]].name.toLowerCase()}. Those who followed called themselves ${faith.name}.`
    : opts.patron
      ? `${P(founder.id)} woke before dawn certain of something, and by nightfall was preaching it by the fire: ${TENETS[tenets[0]].text} Those who listened called themselves ${faith.name}.`
      : `${P(founder.id)} began to teach: ${TENETS[tenets[0]].text} Those who listened called themselves ${faith.name}.`;
  log(s, 'faith', text, [founder.id], 7, `The Year of ${faith.name}`);
  return faith;
}

const capitalize = (t: string) => t[0].toUpperCase() + t.slice(1);

/** Once a year: faiths are founded, spread, split and fade. */
export function faithYear(s: GameState) {
  const people = present(s);
  const live = s.faiths.filter((f) => !f.gone);
  // A new faith, if something has stirred people and someone is ready to speak.
  if ((s.flags.faithSeeds ?? 0) > 0 && people.length >= 15 && live.length < 1 + Math.floor(people.length / 70)) {
    const prophet = people.filter((p) => ageOf(s, p) >= 18 && hasTrait(p, 'pious') && (hasTrait(p, 'gregarious') || hasTrait(p, 'ambitious') || hasTrait(p, 'clever') || hasTrait(p, 'restless')));
    if (prophet.length && chance(s.rng, 0.45)) {
      s.flags.faithSeeds = Math.max(0, (s.flags.faithSeeds ?? 1) - 1);
      const first = s.flags.faithSeedKind ?? pick(s.rng, Object.keys(TENETS) as TenetId[]);
      const second = pick(s.rng, (Object.keys(TENETS) as TenetId[]).filter((t) => t !== first));
      foundFaith(s, pick(s.rng, prophet), [first, second]);
    }
  }
  // Spreading through families and friends. Young faiths spread with extra zeal,
  // and can win over the kin of believers from older faiths.
  const tithe = hasLaw(s, 'tithe') ? 1.4 : 1;
  for (const p of people) {
    if (p.faith !== undefined && !s.faiths[p.faith]?.gone) {
      const kinFaiths = [p.spouse, ...p.parents, ...p.children].map((id) => (id === undefined ? undefined : s.people[id]?.faith))
        .filter((f): f is number => f !== undefined && f !== p.faith && !s.faiths[f]?.gone && s.day - s.faiths[f].founded < 360 * 5);
      if (kinFaiths.length && !hasTrait(p, 'stubborn') && chance(s.rng, 0.12)) p.faith = pick(s.rng, kinFaiths);
      continue;
    }
    const kin = [p.spouse, ...p.parents].map((id) => (id === undefined ? undefined : s.people[id])).filter((k) => k?.alive && k.faith !== undefined && !s.faiths[k.faith]?.gone) as Person[];
    let rate = 0.04 + kin.length * 0.18;
    if (kin.some((k) => s.day - s.faiths[k.faith!].founded < 360 * 5)) rate *= 1.6;
    if (hasTrait(p, 'pious')) rate += 0.15;
    if (hasTrait(p, 'skeptical')) rate *= 0.3;
    if (!live.length) break;
    if (!chance(s.rng, Math.min(0.8, rate * tithe))) continue;
    p.faith = kin.length ? pick(s.rng, kin).faith : weightedFaith(s);
  }
  for (const f of live) {
    const n = followers(s, f.id);
    if (n === 0 && s.day - f.founded > 360 * 3) {
      f.gone = true;
      log(s, 'faith', `The last of ${f.name} died or drifted away, and its prayers were no longer said.`, [], 3);
      continue;
    }
    // A schism, now and then, in a large faith.
    if (n >= 25 && chance(s.rng, 0.06)) {
      const rebel = people.filter((p) => p.faith === f.id && hasTrait(p, 'pious') && (hasTrait(p, 'ambitious') || hasTrait(p, 'stubborn')) && p.id !== f.founder)[0];
      if (rebel) {
        const tenet = pick(s.rng, (Object.keys(TENETS) as TenetId[]).filter((t) => !f.tenets.includes(t)));
        const offshoot = foundFaith(s, rebel, [tenet, f.tenets[0]], undefined, { parent: f.id });
        for (const p of people) if (p.faith === f.id && p.id !== rebel.id && (hasTrait(p, 'stubborn') || chance(s.rng, 0.2))) p.faith = offshoot.id;
      }
    }
  }
}

function weightedFaith(s: GameState): number | undefined {
  const live = s.faiths.filter((f) => !f.gone);
  if (!live.length) return undefined;
  return weighted(s.rng, live.map((f) => [f.id, 1 + followers(s, f.id)] as const));
}

/** Each faith keeps a holy day in its season. */
function holyDays(s: GameState) {
  const season = seasonIndex(s.day);
  for (const f of s.faiths) {
    if (f.gone || f.season !== season) continue;
    const n = followers(s, f.id);
    if (n < 5) continue;
    for (const p of present(s)) if (p.faith === f.id) p.mood += 8;
    // Holy days are kept every year; the Chronicle notes them now and then.
    if ((n < 12 && s.day - f.founded > 360 * 2) || (Math.floor(s.day / 360) + f.id) % 3) continue;
    const how = f.tenets.includes('feasting') ? 'feasted until dawn' : f.tenets.includes('austerity') ? 'fasted and kept silent for a day' : f.tenets.includes('river') ? 'floated lamps down the river' : f.tenets.includes('ancestors') ? 'set out bowls for the dead' : 'gathered at the Old Stone and sang';
    log(s, 'faith', `${capitalize(f.name)} ${how} for their holy day. ${n} kept it.`, [], 1);
  }
}

// ---------------------------------------------------------------------------
// Businesses

const ADJ = ['Red', 'Crooked', 'Smoking', 'Golden', 'Old', 'Singing', 'Tall', 'Lucky', 'Patient', 'Bright'];
export function businessName(s: GameState, kind: string, owner: Person): string {
  const adj = pick(s.rng, ADJ);
  switch (kind) {
    case 'kiln': return pick(s.rng, [`${owner.first}'s Pots`, `The ${adj} Kiln`, `The ${owner.family} Kiln`]);
    case 'furnace': return pick(s.rng, [`${owner.first}'s Forge`, `The ${adj} Anvil`, `${owner.family} Bronze`]);
    case 'alehouse': return pick(s.rng, [`The ${adj} Cup`, `The ${pick(s.rng, ['Crooked Ox', 'Sleeping Dog', 'Barley Sheaf', 'Three Jugs', 'Leaky Roof', 'Drowned Goat'])}`, `${owner.first}'s Alehouse`]);
    default: return pick(s.rng, [`${owner.first}'s Stall`, `The ${adj} Basket`, `${owner.family} & Kin`]);
  }
}

const TRADE_OF: Record<string, Person['job'] | undefined> = { kiln: 'potter', furnace: 'smith', stall: undefined, alehouse: undefined };

/** Give a business an owner (and a name, the first time). */
export function openBusiness(s: GameState, b: { id: number; kind: string; name?: string; owner?: number }) {
  if (!(b.kind in TRADE_OF)) return;
  const trade = TRADE_OF[b.kind];
  const pool = present(s).filter((p) => ageOf(s, p) >= 18 && (trade ? p.job === trade || p.skill === trade : true));
  if (!pool.length) return;
  pool.sort((a, c) => score(c) - score(a));
  const owner = pool[0];
  const heir = b.owner !== undefined;
  b.owner = owner.id;
  owner.renown += 5;
  if (!b.name) {
    b.name = businessName(s, b.kind, owner);
    log(s, 'business', `${P(owner.id)} opened ${b.name}.`, [owner.id], 2);
  } else if (heir) {
    log(s, 'business', `${P(owner.id)} took over ${b.name}.`, [owner.id], 2);
  }
  function score(p: Person) {
    return (p.job === trade ? 10 : 0) + (hasTrait(p, 'ambitious') ? 5 : 0) + (hasTrait(p, 'greedy') ? 3 : 0) + p.renown / 10;
  }
}

/** Once a year: businesses whose owners are gone pass to family, or to someone in the trade. */
export function businessYear(s: GameState) {
  for (const b of s.buildings) {
    if (b.removed || !b.built || !(b.kind in TRADE_OF)) continue;
    const owner = b.owner !== undefined ? s.people[b.owner] : undefined;
    if (owner && owner.alive && !owner.left) continue;
    const heirs = owner ? owner.children.map((c) => s.people[c]).filter((c) => c?.alive && !c.left && c.away === undefined && ageOf(s, c) >= 16) : [];
    if (heirs.length) {
      const heir = heirs.sort((a, c) => Number(c.job === TRADE_OF[b.kind]) - Number(a.job === TRADE_OF[b.kind]))[0];
      b.owner = heir.id;
      log(s, 'business', `${P(heir.id)} inherited ${b.name ?? 'the family business'} from ${F(owner!.id)}.`, [heir.id], 2);
    } else {
      openBusiness(s, b);
    }
  }
}
