// A town: the charter and its coat of arms, a paved square, a wall with gates,
// a bridge to the far bank, two-storey houses near the middle, guilds, temples,
// alehouses, healers and scribes.
import { log, P } from './chronicle';
import { chance, pick, rand, weighted } from './rng';
import { TERRAIN, DAYS_PER_YEAR, type Arms, type Building, type BuildingKind, type GameState, type Guild, type JobId, type Person } from './types';
import { ageOf, isDwelling, population, present, wallTile } from './world';
import { addBuilding, invalidateRegion, queueBuilding, queueUpgrade, settlementRegion, projects } from './planner';
import { knows, rebuildOld, unlocked } from './ages';
import { isBuildable, isWater } from './mapgen';

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const STAGE_RANK = { settlement: 0, village: 1, town: 2, city: 3, metropolis: 4 } as const;
export const isTown = (s: GameState) => STAGE_RANK[s.stage] >= 2;

// ---------------------------------------------------------------------------
// The charter

const FIELDS: [string, string][] = [['#A8322B', 'red'], ['#2C5A8C', 'blue'], ['#3D7240', 'green'], ['#6B3F78', 'purple'], ['#2A2522', 'black']];
const METALS: [string, string][] = [['#D8AB3C', 'gold'], ['#ECE4D2', 'silver']];
export const CHARGE_LABEL: Record<string, string> = {
  flame: 'flame', spiral: 'spiral', oak: 'oak tree', pot: 'pot', hammer: 'hammer', fish: 'fish', wheat: 'sheaf of barley',
  ram: "ram's head", axe: 'axe', star: 'star', wave: 'wavy river',
};
const MOTTOES = [
  'By the fire', 'We stayed', 'Hands together', 'From one fire, many', 'Root and branch', 'The river remembers',
  'Ever the hearth', 'Work, and wait', 'A light in the valley', 'Others will follow', 'Nothing wasted', 'Slow and sure',
];

export function makeArms(s: GameState): Arms {
  const r = s.rng;
  const people = present(s);
  const share = (job: JobId) => people.filter((p) => p.job === job).length / Math.max(1, people.length) * 20;
  const charge = weighted(r, [
    ['flame', 3], ['spiral', 2], ['oak', 2],
    ['pot', share('potter')], ['hammer', share('smith')], ['fish', share('fisher') + (s.buildings.some((b) => b.kind === 'dock') ? 1 : 0)],
    ['wheat', share('farmer') * 0.5], ['ram', share('herder') * 2], ['axe', share('woodcutter')],
    ['star', s.faiths.some((f) => !f.gone) ? 1.5 : 0], ['wave', 1],
  ] as [string, number][]);
  return {
    field: pick(r, FIELDS)[0],
    tincture: pick(r, METALS)[0],
    division: weighted(r, [['plain', 4], ['pale', 1], ['fess', 1], ['bend', 2], ['chevron', 2], ['chief', 2]] as const),
    charge,
    motto: pick(r, MOTTOES),
  };
}

export function describeArms(a: Arms): string {
  const field = FIELDS.find(([c]) => c === a.field)?.[1] ?? 'red';
  const metal = METALS.find(([c]) => c === a.tincture)?.[1] ?? 'gold';
  const div: Record<Arms['division'], string> = {
    plain: '', pale: ', split down the middle', fess: ', with a band across', bend: ', with a slanting band',
    chevron: ', under a chevron', chief: ', under a band across the top',
  };
  return `a ${metal} ${CHARGE_LABEL[a.charge] ?? a.charge} on ${field}${div[a.division]}`;
}

export function grantCharter(s: GameState) {
  s.arms = makeArms(s);
  paveSquare(s, 2.8);
  const how = knows(s, 'writing') ? 'A charter was written down at last, pressed into clay and fired so it would last'
    : 'A charter was sung at the hearth, and a stone was raised beside the square so that no one would forget the day';
  log(s, 'stage', `${s.name} had become a town. ${how}. The town took arms, ${describeArms(s.arms)}, and a motto: "${s.arms.motto}."`, [], 10, 'The Year of the Town Charter');
  s.flags.ceremony = { kind: 'charter', day: s.day };
}

/** The open ground around the hearth becomes a paved square. */
export function paveSquare(s: GameState, radius: number) {
  const { map, hearth } = s;
  for (let y = Math.floor(hearth.y - radius); y <= Math.ceil(hearth.y + radius); y++) {
    for (let x = Math.floor(hearth.x - radius); x <= Math.ceil(hearth.x + radius); x++) {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      if (Math.hypot(x - hearth.x, y - hearth.y) > radius) continue;
      const i = y * map.w + x;
      if (map.occ[i] || !isBuildable(map.terrain[i])) continue;
      map.terrain[i] = TERRAIN.PLAZA;
      map.trees[i] = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Buildings a town wants

const count = (s: GameState, kind: BuildingKind) => s.buildings.filter((b) => b.kind === kind && !b.removed).length;

/** The next shared building the town should put up, if any. */
export function townWant(s: GameState): BuildingKind | null {
  const pop = population(s);
  if (s.stage === 'settlement') return null;
  if (pop >= 40 && unlocked(s, 'healer') && count(s, 'healer') < 1 + Math.floor(pop / 250)) return 'healer';
  if (unlocked(s, 'alehouse') && count(s, 'alehouse') < 1 + Math.floor(pop / 200)) return 'alehouse';
  if (pop >= 60 && unlocked(s, 'scribes') && count(s, 'scribes') < 1 + Math.floor(pop / 600)) return 'scribes';
  return null;
}

// ---------------------------------------------------------------------------
// The wall

export function planWalls(s: GameState, kind: 'palisade' | 'stone') {
  const { hearth, map } = s;
  const homes = s.buildings.filter((b) => !b.removed && b.built && isDwelling(b.kind))
    .map((b) => Math.hypot(b.x + b.w / 2 - hearth.x - 0.5, b.y + b.h / 2 - hearth.y - 0.5)).sort((a, b) => a - b);
  if (homes.length < 20) return;
  const old = s.walls;
  let r = homes[Math.floor(homes.length * 0.8)] + 2.5;
  if (old) r = Math.max(r, old.r);
  r = Math.max(9, Math.min(r, (map.w >> 1) - 3));
  const cx = hearth.x + 0.5;
  const cy = hearth.y + 0.5;
  // Gates go where the paths already cross the line of the wall.
  const n = Math.ceil(Math.PI * 2 * r * 2);
  const worn: boolean[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const x = Math.floor(cx + Math.cos(a) * r);
    const y = Math.floor(cy + Math.sin(a) * r);
    const i = y * map.w + x;
    worn.push(x >= 0 && y >= 0 && x < map.w && y < map.h && map.wear[i] > 1 && !isWater(map.terrain[i]));
  }
  let gates: number[] = old?.gates.slice() ?? [];
  if (!old) {
    for (let k = 0; k < n; k++) {
      if (!worn[k] || worn[(k + n - 1) % n]) continue;
      let e = k;
      while (worn[(e + 1) % n] && e - k < n) e++;
      const a = (((k + e) / 2) / n) * Math.PI * 2;
      if (!gates.some((g) => Math.abs(Math.atan2(Math.sin(g - a), Math.cos(g - a))) < 3 / r)) gates.push(a);
    }
    if (gates.length < 2) gates = [0.4, 0.4 + Math.PI / 2, 0.4 + Math.PI, 0.4 + Math.PI * 1.5];
    gates = gates.slice(0, 8);
  }
  const perimeter = Math.PI * 2 * r;
  s.walls = {
    cx, cy, r, kind, gates, progress: 0, required: Math.round(perimeter * (kind === 'stone' ? 14 : 5)),
    built: false, founded: s.day,
  };
  // Mark the line, so nothing is built on it.
  const line = new Array<number>(map.w * map.h).fill(0);
  for (let y = Math.max(0, Math.floor(cy - r - 2)); y < Math.min(map.h, Math.ceil(cy + r + 2)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r - 2)); x < Math.min(map.w, Math.ceil(cx + r + 2)); x++) line[y * map.w + x] = wallTile(s, x, y);
  }
  map.walls = line;
  map.wallsUp = kind === 'stone' ? true : false;
  log(s, 'build', kind === 'stone'
    ? `Work began on walls of stone around ${s.name}, following the line of the old palisade.`
    : `Work began on a palisade around ${s.name}: a ring of sharpened stakes, with ${gates.length} gates where the paths ran out to the fields.`, [], 5);
}

/** Builders' work on the wall, a share of each day's. Returns the work left over. */
export function progressWalls(s: GameState, work: number): number {
  const w = s.walls;
  if (!w || w.built || work <= 0) return work;
  const perWood = w.kind === 'stone' ? 0.3 : 1;
  const done = Math.min(work, w.required - w.progress, s.stores.wood / perWood);
  if (done <= 0) return work;
  w.progress += done;
  s.stores.wood -= done * perWood;
  if (w.progress >= w.required - 1e-6) {
    w.built = true;
    w.completed = s.day;
    s.map.wallsUp = true;
    log(s, 'build', w.kind === 'stone'
      ? `The stone walls of ${s.name} were finished, with towers at the gates. Children walked the top of them on summer evenings.`
      : `The palisade was finished. For the first time, ${s.name} had an inside and an outside, and the gates were shut at night.`, [], 6, w.kind === 'stone' ? 'The Year of the Walls' : 'The Year of the Palisade');
  }
  return work - done;
}

// ---------------------------------------------------------------------------
// A bridge to the far bank

export function planBridge(s: GameState): boolean {
  const { map, hearth } = s;
  const region = settlementRegion(s);
  let best: { x: number; y: number; dx: number; dy: number; span: number; score: number } | null = null;
  const R = 26;
  for (let y = Math.max(1, hearth.y - R); y < Math.min(map.h - 1, hearth.y + R); y++) {
    for (let x = Math.max(1, hearth.x - R); x < Math.min(map.w - 1, hearth.x + R); x++) {
      const i = y * map.w + x;
      if (!region[i] || map.occ[i] || isWater(map.terrain[i])) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let k = 1;
        while (k <= 8) {
          const tx = x + dx * k, ty = y + dy * k;
          if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) { k = 99; break; }
          const t = map.terrain[ty * map.w + tx];
          if (!isWater(t)) break;
          if (map.occ[ty * map.w + tx]) { k = 99; break; }
          k++;
        }
        if (k < 2 || k > 8) continue;
        const fx = x + dx * k, fy = y + dy * k;
        const fi = fy * map.w + fx;
        if (region[fi] || !isBuildable(map.terrain[fi]) || map.occ[fi]) continue;
        const span = k - 1;
        const score = span * 3 + Math.hypot(x - hearth.x, y - hearth.y) * 0.6 - Math.min(3, map.wear[i]) + rand(s.rng);
        if (!best || score < best.score) best = { x, y, dx, dy, span, score };
      }
    }
  }
  if (!best) return false;
  const { x, y, dx, dy, span } = best;
  const bx = dx < 0 ? x - span : dx > 0 ? x + 1 : x;
  const by = dy < 0 ? y - span : dy > 0 ? y + 1 : y;
  addBuilding(s, 'bridge', bx, by, { size: dx !== 0 ? [span, 1] : [1, span] });
  log(s, 'build', `${s.name} had run out of room on its own bank. Work began on a bridge across the river.`, [], 4);
  return true;
}

/** When a bridge is finished, the far bank is part of the town. */
export function bridgeFinished(s: GameState, b: Building) {
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) s.map.terrain[y * s.map.w + x] = TERRAIN.BRIDGE;
  invalidateRegion(s);
  log(s, 'build', `The bridge was finished, ${b.w * b.h + 1} paces of timber over the water. Within a month someone had built a house on the far side.`, [], 6, 'The Year of the Bridge');
}

// ---------------------------------------------------------------------------
// Guilds

const GUILD_TRADES: JobId[] = ['potter', 'smith', 'builder', 'fisher', 'farmer', 'herder', 'woodcutter'];
const GUILD_NAMES: Partial<Record<JobId, string[]>> = {
  potter: ["the Potters' Guild", 'the Fellowship of the Kiln'],
  smith: ["the Smiths' Guild", 'the Brotherhood of the Hammer'],
  builder: ["the Builders' Guild", 'the Lodge of Masons'],
  fisher: ["the Fishers' Guild", 'the Company of the Net'],
  farmer: ["the Sowers' Guild", 'the Fellowship of the Furrow'],
  herder: ["the Herders' Guild", 'the Company of the Fleece'],
  woodcutter: ["the Woodcutters' Guild", 'the Brotherhood of the Axe'],
};

export function guildOf(s: GameState, job: JobId): Guild | undefined {
  return s.guilds.find((g) => g.trade === job && !g.gone);
}

function guildMaster(s: GameState, members: Person[]): Person | undefined {
  return members.slice().sort((a, b) => (b.skill === b.job ? 30 : 0) + b.renown + ageOf(s, b) * 0.5 - ((a.skill === a.job ? 30 : 0) + a.renown + ageOf(s, a) * 0.5))[0];
}

function guildsYear(s: GameState) {
  if (!isTown(s)) return;
  const people = present(s).filter((p) => ageOf(s, p) >= 16);
  for (const trade of GUILD_TRADES) {
    const members = people.filter((p) => p.job === trade);
    let g = guildOf(s, trade);
    if (!g) {
      if (members.length < (trade === 'farmer' ? 14 : 6) || !chance(s.rng, 0.5)) continue;
      const master = guildMaster(s, members);
      g = { id: s.nextId.guild++, trade, name: pick(s.rng, GUILD_NAMES[trade] ?? [`the ${cap(trade)}s' Guild`]), founded: s.day, master: master?.id };
      s.guilds.push(g);
      if (master) master.renown += 15;
      log(s, 'guild', `The ${trade}s of ${s.name} swore an oath together and founded ${g.name}.${master ? ` ${P(master.id)} was chosen as its first master.` : ''}`, master ? [master.id] : [], 5);
      continue;
    }
    if (!members.length) {
      g.gone = true;
      log(s, 'guild', `${cap(g.name)} met for the last time, and nobody came.`, [], 2);
      continue;
    }
    const m = g.master !== undefined ? s.people[g.master] : undefined;
    if (!m || !m.alive || m.left || m.job !== trade) {
      const next = guildMaster(s, members);
      if (next) {
        g.master = next.id;
        next.renown += 10;
        log(s, 'guild', `${P(next.id)} became master of ${g.name}.`, [next.id], 2);
      }
    }
    // A hall of their own, once there are enough of them.
    if (members.length >= 10 && !s.buildings.some((b) => b.kind === 'guildhall' && b.guild === g!.id && !b.removed) && !projects(s).some((b) => !isDwelling(b.kind) && b.kind !== 'field')) {
      const hall = queueBuilding(s, 'guildhall');
      if (hall) { hall.guild = g.id; hall.name = `the hall of ${g.name}`; }
    }
    if (chance(s.rng, 0.12)) guildMoment(s, g, members);
  }
}

function guildMoment(s: GameState, g: Guild, members: Person[]) {
  const a = pick(s.rng, members);
  const lines = [
    `${cap(g.name)} held its feast. ${P(a.id)} ${knows(s, 'brewing') ? 'drank too much' : 'stayed up singing far too late'} and swore to make a masterwork before the year was out.`,
    `${cap(g.name)} argued all winter over who could call themselves a master, and in the end nobody was satisfied.`,
    `${P(a.id)} took an apprentice, a sullen youngster who turned out to have a gift for the work.`,
    `${cap(g.name)} gathered goods for the widows of its members, and put up a stone in their memory.`,
  ];
  log(s, 'guild', pick(s.rng, lines), [a.id], 2);
}

/** Guild members work a little better: they teach each other. */
export function guildRate(s: GameState, p: Person): number {
  return s.guilds.length && guildOf(s, p.job) ? 1.08 : 1;
}

// ---------------------------------------------------------------------------
// Temples

function templesYear(s: GameState) {
  if (!isTown(s)) return;
  if (projects(s).some((b) => b.kind === 'temple')) return;
  const people = present(s);
  // Only the larger faiths raise temples, and a town has room for only so many.
  const temples = s.buildings.filter((b) => b.kind === 'temple' && !b.removed).length;
  if (temples >= 1 + Math.floor(people.length / 400)) return;
  const sized = s.faiths.filter((f) => !f.gone).map((f) => ({ f, n: people.filter((p) => p.faith === f.id).length })).sort((a, b) => b.n - a.n);
  for (const { f, n: followers } of sized) {
    if (followers < Math.max(30, people.length * 0.12)) break;
    if (s.buildings.some((b) => b.kind === 'temple' && b.faith === f.id && !b.removed)) continue;
    const t = queueBuilding(s, 'temple');
    if (t) {
      t.faith = f.id;
      t.name = `the temple of ${f.name.replace(/^the /, 'the ')}`;
      log(s, 'faith', `The followers of ${f.name} began a temple, carrying earth up by the basketful to raise it above the roofs of ${s.name}.`, [], 5);
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// Every day and every year

export function townDay(s: GameState) {
  if (!isTown(s)) return;
  // Two-storey houses near the middle, where room is short.
  if (s.day % 90 === 60) {
    const { hearth } = s;
    const nBuilt = s.buildings.filter((b) => !b.removed && b.kind !== 'field').length;
    const inner = (2.6 + Math.sqrt(nBuilt) * 0.85) * 0.75;
    const upgrading = new Set(projects(s).map((b) => b.replaces).filter((x) => x !== undefined));
    let n = 0;
    for (const b of s.buildings) {
      if (n >= 2) break;
      if (b.removed || !b.built || b.kind !== 'house' || upgrading.has(b.id)) continue;
      if (s.day - (b.completed ?? 0) < 8 * DAYS_PER_YEAR) continue;
      if (Math.hypot(b.x - hearth.x, b.y - hearth.y) > inner) continue;
      queueUpgrade(s, b, 'townhouse');
      n++;
    }
  }
}

export function townYear(s: GameState) {
  if (!isTown(s)) return;
  guildsYear(s);
  templesYear(s);
  const pop = population(s);
  if (!s.walls && pop >= 320 && s.stores.wood >= 120) planWalls(s, 'palisade');
  else if (s.walls?.built && s.walls.kind === 'palisade' && knows(s, 'castles')) planWalls(s, 'stone');
  const bridges = count(s, 'bridge');
  if (pop >= 300 && bridges < (s.stage === 'town' ? 1 : 3) && chance(s.rng, 0.5)) planBridge(s);
  if (s.stage !== 'town' && s.day % (DAYS_PER_YEAR * 5) < DAYS_PER_YEAR) paveSquare(s, 4.2);
  rebuildOld(s, (b) => {
    if (b.kind === 'bridge' || b.burned || projects(s).some((p) => p.replaces === b.id)) return false;
    queueUpgrade(s, b, b.kind);
    return true;
  });
}

/** How town life lifts (or doesn't) someone's mood. */
export function townMood(s: GameState, p: Person): number {
  if (s.stage === 'settlement') return 0;
  const c = moodCache(s);
  let m = 0;
  if (c.alehouses) m += p.traits.includes('gregarious') ? 4 : 2;
  if (p.faith !== undefined && c.temples.has(p.faith)) m += 3;
  if (c.walls) m += p.traits.includes('timid') ? 4 : 1;
  return m;
}

const moodCaches = new WeakMap<object, { day: number; alehouses: number; temples: Set<number>; walls: boolean }>();
function moodCache(s: GameState) {
  let c = moodCaches.get(s);
  if (!c || c.day !== s.day) {
    const temples = new Set<number>();
    let alehouses = 0;
    for (const b of s.buildings) {
      if (!b.built || b.removed) continue;
      if (b.kind === 'alehouse') alehouses++;
      if (b.kind === 'temple' && b.faith !== undefined) temples.add(b.faith);
    }
    c = { day: s.day, alehouses, temples, walls: !!s.walls?.built };
    moodCaches.set(s, c);
  }
  return c;
}

