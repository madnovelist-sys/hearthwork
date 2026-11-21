// Tales: everyday scenes written from what's actually going on. A scene is
// built from parts (who, why, what was said, how it ended) chosen by the
// people involved (their traits, work, family, faith and history with each
// other) and by the village (season, weather, hunger, laws, how it is
// governed, what it has discovered, what happened lately). People remember:
// quarrels leave grudges with a reason, and friendships grow, so later scenes
// call back to earlier ones.
import { log, P } from './chronicle';
import { chance, pick, rand } from './rng';
import { DAYS_PER_YEAR, type GameState, type Person, type TraitId } from './types';
import { ageOf, darkFactor, isCloseKin, present } from './world';
import { knows } from './ages';
import { LAW } from './society';
import { ruleForm } from './traditions';
import { itemsOf } from './items';
import { sitesOf } from './places';
import { temperature } from './weather';

// ---------------------------------------------------------------------------
// Bonds: what two people are to each other, and why.

export interface Bond { v: number; why?: string; day: number; n: number }

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
export function bond(s: GameState, a: Person, b: Person): Bond | undefined {
  return s.bonds?.[key(a.id, b.id)];
}
function touch(s: GameState, a: Person, b: Person, dv: number, why?: string): Bond {
  const bonds = (s.bonds ??= {});
  const k = key(a.id, b.id);
  const cur = bonds[k] ?? { v: 0, day: s.day, n: 0 };
  cur.v = Math.max(-100, Math.min(100, cur.v + dv));
  if (why) cur.why = why;
  cur.day = s.day;
  cur.n++;
  bonds[k] = cur;
  return cur;
}

/** Once a year: forget the bonds of the dead and the departed. */
export function bondsYear(s: GameState) {
  if (!s.bonds) return;
  for (const k of Object.keys(s.bonds)) {
    const [a, b] = k.split('-').map(Number);
    const pa = s.people[a], pb = s.people[b];
    if (!pa?.alive || !pb?.alive || pa.left || pb.left) delete s.bonds[k];
    else s.bonds[k].v *= 0.93; // feelings soften with the years
  }
}

// ---------------------------------------------------------------------------
// Words

const he = (p: Person) => (p.sex === 'f' ? 'she' : 'he');
const him = (p: Person) => (p.sex === 'f' ? 'her' : 'him');
const his = (p: Person) => (p.sex === 'f' ? 'her' : 'his');
const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const has = (p: Person, t: TraitId) => p.traits.includes(t);
const NUM = ['', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const years = (days: number) => { const y = Math.max(1, Math.round(days / DAYS_PER_YEAR)); return y < NUM.length ? `${NUM[y]} year${y === 1 ? '' : 's'}` : 'many years'; };
/** "Things" → "Things'", "Pip" → "Pip's" */
const poss = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);

/** Choose among lines, never the same line twice in a row for the village. */
function choose(s: GameState, slot: string, lines: string[]): string {
  const recent = (s.flags.recentLines ??= []);
  const fresh = lines.filter((l) => !recent.includes(`${slot}:${l.slice(0, 24)}`));
  const line = pick(s.rng, fresh.length ? fresh : lines);
  recent.push(`${slot}:${line.slice(0, 24)}`);
  if (recent.length > 60) recent.splice(0, recent.length - 60);
  return line;
}

/** Something someone says, in their own voice. */
function says(s: GameState, p: Person, gist: 'refuse' | 'accuse' | 'joke' | 'regret' | 'warn' | 'offer'): string {
  const lines: Record<string, Partial<Record<TraitId | 'any', string[]>>> = {
    refuse: {
      stubborn: ["I've said all I'm going to say", "No. And I'll say no again tomorrow", "I'm not the one who should be sorry"],
      cunning: ["Funny, I remember it differently. Who else saw?", "Maybe we could come to some arrangement"],
      brave: ['Make me', "Say that again, closer"],
      timid: ["I didn't mean anything by it", "I'll think about it"],
      any: ["That's not how I see it", 'You are mistaken', 'Ask anyone'],
    },
    accuse: {
      cruel: ['You were always a thief, like your mother', 'Everyone knows what you are'],
      honest: ["I saw you do it, and so did you", "Just say you did it"],
      gloomy: ['It was always going to come to this', 'Of course it was you'],
      ambitious: ['When I have a say in things, this will stop', 'This is why nothing works here'],
      any: ['You did this', "Don't pretend you don't know", "That's the second time"],
    },
    joke: {
      cheerful: ["If we're going to fight about it, we may as well eat first", "Next time, let's argue about something worth it"],
      clever: ["At this rate our grandchildren will still be arguing about it", "The stone's the only one of us not talking"],
      gregarious: ['Come to the fire. Bring your anger, I want to see it in the light'],
      any: ['Well. That was loud'],
    },
    regret: {
      kind: ["I'm sorry. I shouldn't have said it", "I've been thinking about what I said"],
      honest: ['I was wrong, and I knew it at the time'],
      shy: ['...sorry'],
      any: ['Let it go. Life is short'],
    },
    warn: {
      brave: ["Come near my family again and you'll see"],
      cruel: ["You'll be sorry, and so will yours"],
      any: ["This isn't over"],
    },
    offer: {
      generous: ['Take it. I have more than I need', "Here. Don't argue"],
      kind: ['Come in, the fire is warm', "You shouldn't be alone tonight"],
      any: ['We look after each other here'],
    },
  };
  const bank = lines[gist];
  const voices = p.traits.filter((t) => bank[t]);
  const pool = voices.length && chance(s.rng, 0.8) ? bank[pick(s.rng, voices)]! : bank.any!;
  return `“${choose(s, `say-${gist}`, pool)},” ${P(p.id)} said`;
}

// ---------------------------------------------------------------------------
// What people fall out over, given who they are and what's going on.

interface Cause { why: string; text: string; heat: number; /** What the angrier one says, if this quarrel has its own words. */ retort?: string[] }

function homeOf(s: GameState, p: Person) { return p.home !== undefined ? s.buildings[p.home] : undefined; }
function neighbours(s: GameState, a: Person, b: Person): boolean {
  const ha = homeOf(s, a), hb = homeOf(s, b);
  return !!ha && !!hb && ha.id !== hb.id && Math.abs(ha.x - hb.x) + Math.abs(ha.y - hb.y) <= 4;
}
const inLaws = (s: GameState, a: Person, b: Person) => {
  const sp = a.spouse !== undefined ? s.people[a.spouse] : undefined;
  return !!sp && sp.parents.includes(b.id) || (b.spouse !== undefined && s.people[b.spouse]?.parents.includes(a.id));
};

function causes(s: GameState, a: Person, b: Person): Cause[] {
  const out: Cause[] = [];
  const temp = temperature(s);
  const sky = s.weather?.sky;
  const season = Math.floor((s.day % DAYS_PER_YEAR) / 90);
  if (neighbours(s, a, b)) {
    out.push(
      { why: 'the boundary stones', text: `the stones that marked where ${P(a.id)}'s plot ended and ${P(b.id)}'s began, which one of them had moved in the night`, heat: 2, retort: ["I'll move them back when the river runs uphill", "Those stones were there before you were born"] },
      { why: 'the smoke', text: `the smoke from ${P(b.id)}'s fire, which blew straight into ${P(a.id)}'s door every evening`, heat: 1 },
      { why: 'the wall', text: `the wall between their houses, which was leaning, and whose fault that was`, heat: 1 },
    );
    if (s.pets.some((p) => p.alive && p.owner === b.id && p.kind === 'dog')) out.push({ why: 'the dog', text: `${P(b.id)}'s dog, which had dug up ${P(a.id)}'s beans for the third time`, heat: 2 });
  }
  if (a.job === b.job) {
    const work: Partial<Record<Person['job'], Cause[]>> = {
      farmer: season === 1 && (s.weather?.dry ?? 0) > 10
        ? [{ why: 'the water', text: `who was taking more than their share of the stream for their fields, in a dry month`, heat: 3 }]
        : [{ why: 'the ox', text: `the ox they shared, and who had worked it lame`, heat: 2 }],
      herder: [{ why: 'a missing goat', text: `a goat that had gone missing from one flock and turned up, strangely, in the other`, heat: 2 }],
      fisher: [{ why: 'the fishing spot', text: `the best pool on the river, which both of them had fished since they were children`, heat: 1 }, { why: 'a torn net', text: `a net that had come back torn, and who had borrowed it`, heat: 2 }],
      potter: [{ why: 'the kiln', text: `whose turn it was at the kiln, when both of them had a firing ready`, heat: 1 }],
      smith: [{ why: 'the charcoal', text: `the last of the charcoal, which both of them needed for the same morning`, heat: 1 }],
      builder: [{ why: 'how to build', text: `the right way to set a roof beam, which they had argued about for years`, heat: 1 }],
      woodcutter: [{ why: 'a felled tree', text: `a tree one of them had felled across the other's path`, heat: 1 }],
      gatherer: [{ why: 'the hazel thicket', text: `the hazel thicket, and who had found it first`, heat: 1 }],
    };
    out.push(...(work[a.job] ?? []));
  }
  if (inLaws(s, a, b)) out.push({ why: 'the children', text: `how the children should be raised, which was nobody's business but the parents', as ${P(a.id)} put it`, heat: 2 });
  if (a.faith !== undefined && b.faith !== undefined && a.faith !== b.faith && s.faiths[a.faith] && s.faiths[b.faith]) {
    out.push({ why: 'the holy day', text: `${poss(s.faiths[a.faith].name)} holy day, which ${P(b.id)} had spent loudly in the doorway`, heat: 2 });
  }
  const law = s.laws.find((l) => l.since > s.day - 3 * DAYS_PER_YEAR);
  if (law) out.push({ why: LAW[law.id].name, text: `${LAW[law.id].name}, which one of them thought was the best thing to happen to ${s.name} and the other thought would ruin it`, heat: 1 });
  if (s.flags.hungerSince !== undefined) out.push({ why: 'the hidden barley', text: `a basket of barley ${P(a.id)} said ${P(b.id)} was hiding while children went hungry`, heat: 4 });
  const heirloom = [...itemsOf(s, a.id), ...itemsOf(s, b.id)].find((it) => it.history.some((h) => h.how === 'inherited'));
  if (heirloom && isCloseKin(s, a, b)) out.push({ why: heirloom.name, text: `${heirloom.name}, and who should rightly have inherited it`, heat: 3 });
  if (temp < -3 || sky === 'snow') out.push({ why: 'the firewood', text: `a few logs from the woodpile, which in that cold were worth more than they should have been`, heat: 2 });
  if (temp > 24) out.push({ why: 'nothing much', text: `nothing much at all: it was too hot, and everyone's temper was short`, heat: 1 });
  if (!out.length) out.push({ why: 'an old remark', text: `something one of them had said about the other's mother, years ago`, heat: 1 }, { why: 'a borrowed pot', text: `a cooking pot borrowed and never brought back`, heat: 1 });
  return out;
}

/** Who settles a quarrel depends on how the village governs itself. */
function arbiter(s: GameState, a: Person, b: Person): string | null {
  const leader = s.leader ? s.people[s.leader.person] : undefined;
  if (!leader || leader.id === a.id || leader.id === b.id || !leader.alive) return null;
  switch (ruleForm(s)) {
    case 'council': return `the council, who listened to both and gave the matter to ${P(leader.id)} to decide`;
    case 'assembly': return `the assembly, where half the village had an opinion and ${P(leader.id)}, as speaker, had to shout to be heard`;
    case 'guilds': return `the masters, who settled it the way the guilds settle things, with a fine for both`;
    case 'chief': return `${P(leader.id)}, who listened to both and ruled for neither`;
    default: return `${P(leader.id)}, who was old enough to have seen it all before`;
  }
}

// ---------------------------------------------------------------------------
// Scenes

type Scene = (s: GameState, people: Person[]) => { text: string; who: number[]; weight: number; kind?: 'season' | 'injury' } | null;

const adults = (s: GameState, ps: Person[]) => ps.filter((p) => ageOf(s, p) >= 16 && !p.sick && !p.injured && p.away === undefined);
const kidsOf = (s: GameState, ps: Person[]) => ps.filter((p) => { const a = ageOf(s, p); return a >= 5 && a < 14; });

/** Two people likely to have something between them: neighbours, workmates, in-laws, old rivals. */
function pairFor(s: GameState, ps: Person[], want: 'quarrel' | 'friend'): [Person, Person] | null {
  const pool = adults(s, ps);
  if (pool.length < 2) return null;
  // Old bonds first: a grudge or a friendship already there.
  if (s.bonds && chance(s.rng, 0.45)) {
    const ks = Object.keys(s.bonds).filter((k) => want === 'quarrel' ? s.bonds![k].v < -15 : s.bonds![k].v > 15 || s.bonds![k].v < -40);
    if (ks.length) {
      const [x, y] = pick(s.rng, ks).split('-').map(Number);
      const a = s.people[x], b = s.people[y];
      if (a?.alive && b?.alive && a.away === undefined && b.away === undefined) return rand(s.rng) < 0.5 ? [a, b] : [b, a];
    }
  }
  const a = pick(s.rng, pool);
  const close = pool.filter((b) => b.id !== a.id && (neighbours(s, a, b) || b.job === a.job || inLaws(s, a, b)));
  const b = pick(s.rng, close.length ? close : pool.filter((x) => x.id !== a.id));
  return b ? [a, b] : null;
}

const quarrel: Scene = (s, ps) => {
  const pair = pairFor(s, ps, 'quarrel');
  if (!pair) return null;
  let [a, b] = pair;
  // The more hot-headed one starts it.
  const heat = (p: Person) => (has(p, 'stubborn') ? 2 : 0) + (has(p, 'cruel') ? 2 : 0) + (has(p, 'brave') ? 1 : 0) - (has(p, 'kind') ? 2 : 0) - (has(p, 'timid') ? 2 : 0) + (p.mood < 0 ? 1 : 0);
  if (heat(b) > heat(a)) [a, b] = [b, a];
  const old = bond(s, a, b);
  const options = causes(s, a, b);
  const cause = old?.why && chance(s.rng, 0.6) ? options.find((c) => c.why === old.why) ?? pick(s.rng, options) : pick(s.rng, options);
  const again = old?.why === cause.why && old.v < 0;
  const where = choose(s, 'where', [
    'at the well', 'in front of half the village', 'at the fire after dark', 'in the middle of the path', 'over the fence', 'at the edge of the fields',
    ...(s.weather?.sky === 'rain' ? ['in the pouring rain, neither willing to be the first to go in'] : []),
    ...(s.weather?.sky === 'snow' ? ['out in the snow, their breath steaming'] : []),
  ]);
  const opening = again
    ? choose(s, 'again', [
      `It was ${cause.why} again. ${cap(years(s.day - old!.day))} on, ${P(a.id)} and ${P(b.id)} were back at it ${where}`,
      `Nobody was surprised when ${P(a.id)} and ${P(b.id)} fell out over ${cause.why} again, ${where}`,
    ])
    : choose(s, 'open', [
      `${cap(where)}, ${P(a.id)} and ${P(b.id)} fell out over ${cause.text}`,
      `${P(a.id)} had words with ${P(b.id)} ${where}, about ${cause.text}`,
      `There was shouting ${where}: ${P(a.id)} and ${P(b.id)}, over ${cause.text}`,
    ]);
  const said = cause.retort && cause.heat < 3 && chance(s.rng, 0.5)
    ? `“${choose(s, 'retort', cause.retort)},” ${P(a.id)} said.`
    : `${says(s, a, cause.heat >= 3 ? 'accuse' : 'refuse')}.`;
  // How it ended, by who they are.
  const dark = darkFactor(s);
  let end: string;
  let dv = -15 - cause.heat * 5;
  let kind: 'season' | 'injury' = 'season';
  const judge = arbiter(s, a, b);
  if (has(b, 'kind') || has(b, 'generous')) { end = `${says(s, b, 'regret')}, and that was the end of it.`; dv = -3; }
  else if (has(a, 'cheerful') || has(b, 'cheerful')) { const c = has(a, 'cheerful') ? a : b; end = `${says(s, c, 'joke')}, and in the end they both laughed.`; dv = -4; }
  else if (has(b, 'cunning') && chance(s.rng, 0.5)) { end = `${says(s, b, 'refuse')}. Somehow, by the end of the week, ${P(b.id)} had come out of it better off, and nobody could say how.`; dv -= 10; }
  else if (judge && cause.heat >= 2 && chance(s.rng, 0.6)) { end = `They took it to ${judge}. Neither of them was happy, which most people agreed meant it was fair.`; dv = -8; }
  else if ((has(a, 'cruel') || (has(a, 'brave') && has(b, 'brave'))) && chance(s.rng, 0.25 * dark)) {
    end = `It came to blows, and ${P(b.id)} was carried home with a bloody face. ${says(s, a, 'warn')}.`;
    b.injured = { until: s.day + 15 };
    dv = -45; kind = 'injury';
  } else if (has(a, 'stubborn') && has(b, 'stubborn')) { end = choose(s, 'stuck', [`Neither would give way. They stopped speaking to each other that day.`, `Neither would give an inch, and the matter was left exactly where it was, which is to say, between them.`]); dv -= 15; }
  else end = choose(s, 'end', [`It was settled with a handshake, eventually.`, `By the next morning both of them were pretending it hadn't happened.`, `${P(b.id)} gave way in the end, and didn't forget it.`, `Their families didn't sit together at the fire for a month.`]);
  touch(s, a, b, dv, cause.why);
  a.mood -= 4; b.mood -= 6;
  return { text: `${opening}. ${said} ${end}`, who: [a.id, b.id], weight: again || kind === 'injury' ? 2 : 1, kind };
};

const kindness: Scene = (s, ps) => {
  const pair = pairFor(s, ps, 'friend');
  if (!pair) return null;
  let [a, b] = pair;
  if (!(has(a, 'kind') || has(a, 'generous')) && (has(b, 'kind') || has(b, 'generous'))) [a, b] = [b, a];
  const old = bond(s, a, b);
  const temp = temperature(s);
  const sky = s.weather?.sky;
  const deeds: string[] = [];
  if (b.sick) deeds.push(`${P(a.id)} sat up three nights with ${P(b.id)} through the fever`);
  if (temp < 0) deeds.push(`${P(a.id)} carried firewood to ${P(b.id)}'s door every morning through the cold`);
  if (sky === 'storm') deeds.push(`after the storm tore the thatch off ${P(b.id)}'s roof, ${P(a.id)} was up the ladder before the rain had stopped`);
  if (s.flags.hungerSince !== undefined) deeds.push(`${P(a.id)} shared ${his(a)} family's last bread with ${P(b.id)}'s children`);
  if (b.spouse === undefined && b.widowed !== undefined && s.day - b.widowed < DAYS_PER_YEAR * 2) deeds.push(`${P(a.id)} made sure ${P(b.id)} never ate alone that winter, after ${his(b)} loss`);
  if (b.job === a.job) deeds.push(`${P(a.id)} showed ${P(b.id)} a trick of the trade ${he(a)} had never shown anyone`);
  deeds.push(`${P(a.id)} helped ${P(b.id)} rebuild a fallen wall, and wouldn't take anything for it`, `${P(a.id)} and ${P(b.id)} spent a whole evening at the fire, talking until the embers died`);
  const deed = choose(s, 'deed', deeds);
  let text: string;
  if (old && old.v < -20) {
    text = `${cap(deed)}. They had not spoken since the business with ${old.why ?? 'the old quarrel'}. ${says(s, a, 'offer')}, and something mended.`;
    touch(s, a, b, 45);
  } else if (old && old.v > 40) {
    text = `${cap(deed)}, as ${he(a)} had for ${P(b.id)} before, and would again. People had stopped remarking on how close the two of them were.`;
    touch(s, a, b, 8);
  } else {
    text = `${cap(deed)}. ${says(s, a, 'offer')}.`;
    touch(s, a, b, 20);
  }
  a.mood += 3; b.mood += 6;
  return { text, who: [a.id, b.id], weight: old && old.v < -20 ? 2 : 1 };
};

const childsPlay: Scene = (s, ps) => {
  const k = kidsOf(s, ps);
  if (k.length < 2) return null;
  const a = pick(s.rng, k);
  const b = pick(s.rng, k.filter((x) => x.id !== a.id));
  const games: string[] = [];
  if (s.weather?.ice) games.push(`${P(a.id)} and ${P(b.id)} slid on the frozen river until ${P(b.id)} went through the ice at the edge, up to the knees, and had to be carried home blue and laughing`);
  if ((s.weather?.snow ?? 0) > 1) games.push(`${P(a.id)} built a snow giant by the hearth, and ${P(b.id)} knocked its head off, and there was a war`);
  if (temperature(s) > 18) games.push(`${P(a.id)} and ${P(b.id)} built a raft of reeds and sailed it a whole bend downriver before it sank under them`);
  const site = sitesOf(s).find((x) => (x.sacred ?? 0) > 20);
  if (site) games.push(`${P(a.id)} dared ${P(b.id)} to touch ${site.name} after dark. ${cap(he(b))} ${has(b, 'brave') ? 'did, and walked home slowly to show ' + he(b) + ' wasn\'t afraid' : has(b, 'timid') ? 'got halfway, and ran' : 'did, and ran all the way home'}`);
  if (s.buildings.some((x) => x.kind === 'pen' && !x.removed)) games.push(`${P(a.id)} and ${P(b.id)} let the goats out of the pen to see what would happen, and found out`);
  if (knows(s, 'wheel')) games.push(`${P(a.id)} took a cart wheel and rolled it down the hill with ${P(b.id)} chasing it, all the way into the river`);
  games.push(`${P(a.id)} and ${P(b.id)} played at founding a village of their own, with ${P(a.id)} as ${ruleForm(s) === 'chief' ? 'chief' : ruleForm(s) === 'council' ? 'the whole council' : 'the eldest'}, and ${P(b.id)} as everybody else`);
  return { text: `${cap(choose(s, 'play', games))}.`, who: [a.id, b.id], weight: 1 };
};

const remembering: Scene = (s, ps) => {
  const elders = ps.filter((p) => ageOf(s, p) >= 55 && !p.sick);
  const k = kidsOf(s, ps);
  if (!elders.length || !k.length) return null;
  const e = pick(s.rng, elders);
  const c = pick(s.rng, k);
  // Something real from the elder's own life, or the village's history.
  const memories = e.memories.map((id) => s.chronicle.find((x) => x.id === id)).filter((x) => x && x.weight >= 4 && x.day < s.day - 5 * DAYS_PER_YEAR);
  const named = Object.entries(s.yearNames).filter(([y]) => Number(y) * DAYS_PER_YEAR < s.day - 10 * DAYS_PER_YEAR && Number(y) * DAYS_PER_YEAR > e.born + 8 * DAYS_PER_YEAR);
  const lost = e.memories.map((id) => s.chronicle.find((x) => x.id === id)).filter((x) => x?.kind === 'death').map((x) => s.people[x!.people[0]]).filter((p) => p && p.id !== e.id);
  const options: string[] = [];
  if (named.length) {
    const [y, name] = pick(s.rng, named);
    options.push(`${P(e.id)} told ${P(c.id)} about ${name.replace(/^The /, 'the ')}, ${s.day / DAYS_PER_YEAR - Number(y) > 30 ? 'long before the child\'s parents were born' : `when ${he(e)} was young`}. ${P(c.id)} didn't believe half of it.`);
  }
  if (lost.length) {
    const p = pick(s.rng, lost);
    options.push(`${P(e.id)} told ${P(c.id)} about ${P(p.id)}, who had died before the child was born. "You have ${his(p)} way of frowning," ${he(e)} said.`);
  }
  const lived = memories.filter((m) => m!.yearName);
  if (lived.length) {
    const m = pick(s.rng, lived)!;
    options.push(`${P(e.id)} told the children at the fire what it had really been like in ${m.yearName!.replace(/^The /, 'the ')}. ${cap(he(e))} had been there.`);
  }
  if (!options.length) return null;
  return { text: choose(s, 'remember', options), who: [e.id, c.id], weight: 1 };
};

const atWork: Scene = (s, ps) => {
  const p = pick(s.rng, adults(s, ps));
  if (!p) return null;
  const lines: string[] = [];
  if (p.job === 'potter' && knows(s, 'potters-wheel')) lines.push(`${P(p.id)} tried to throw a pot on the wheel with ${his(p)} eyes shut, to prove ${he(p)} could. ${has(p, 'clever') ? 'It was the best pot of the season' : 'It was not a good pot'}.`);
  if (p.job === 'farmer' && Math.floor((s.day % DAYS_PER_YEAR) / 90) === 2) lines.push(`${P(p.id)} brought in the last of the barley on the day before the rain, and stood in the stubble with ${his(p)} arms raised while everyone cheered.`);
  if (p.job === 'fisher' && s.weather?.ice) lines.push(`${P(p.id)} cut a hole in the river ice and sat over it all day, and came home with one small fish and a terrible cold.`);
  if (p.job === 'smith') lines.push(`${P(p.id)} cast a ${knows(s, 'iron') ? 'blade' : 'bronze blade'} so fine that ${he(p)} couldn't bring ${him(p)}self to sell it.`);
  if (p.job === 'builder' && knows(s, 'wheel')) lines.push(`${P(p.id)} loaded the new cart so high with stones that it tipped over at the first turn, in front of everyone.`);
  if (p.job === 'woodcutter' && temperature(s) < 0) lines.push(`${P(p.id)} worked all day in the frozen woods and came home with ice in ${his(p)} beard and enough wood for three houses.`);
  if (p.job === 'herder' && Math.floor((s.day % DAYS_PER_YEAR) / 90) === 0) lines.push(`${P(p.id)} sat up through a cold night with a ewe that was struggling to lamb, and saved both.`);
  if (!lines.length) return null;
  return { text: choose(s, 'work', lines), who: [p.id], weight: 1 };
};

const SCENES: [Scene, number][] = [[quarrel, 3], [kindness, 3], [childsPlay, 2], [remembering, 2], [atWork, 2]];

/** A tale, if the day has one: returns true if something was told. */
export function tellTale(s: GameState): boolean {
  const people = present(s);
  if (people.length < 4) return false;
  for (let tries = 0; tries < 4; tries++) {
    const total = SCENES.reduce((t, [, w]) => t + w, 0);
    let roll = rand(s.rng) * total;
    let scene = SCENES[0][0];
    for (const [f, w] of SCENES) { roll -= w; if (roll < 0) { scene = f; break; } }
    const t = scene(s, people);
    if (!t) continue;
    log(s, t.kind ?? 'season', t.text, t.who, t.weight);
    return true;
  }
  return false;
}
