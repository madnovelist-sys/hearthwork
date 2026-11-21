// Just enough economy to make stories: food through the seasons, wood for
// building, pots and bronze for comfort. And who does which job.
import { log, P } from './chronicle';
import { pick, range } from './rng';
import { DAYS_PER_YEAR, type GameState, type JobId, type Person } from './types';
import { chopWood, forestMonth } from './forest';
import { herdYield } from './animals';
import { ageOf, isBlessed, present, seasonIndex, tone } from './world';
import { hasLaw } from './society';
import { boost } from './ages';
import { guildRate } from './town';
import { fieldsAsleep, firewoodPerPerson, temperature } from './weather';

// Daily food per worker, by season: spring, summer, autumn, winter.
const FOOD_RATE: Partial<Record<JobId, number[]>> = {
  farmer: [1.2, 1.5, 5.4, 0], // spring: sowing, and foraging wild greens through the hungry gap
  gatherer: [1.2, 1.5, 1.4, 0.8], // winter: hunting, the mainstay of the cold months
  fisher: [1.4, 1.6, 1.4, 0.9],
};

/** Firewood burned per person per day: see firewoodPerPerson (it follows the temperature). */

export function consumption(s: GameState, p: Person): number {
  const a = ageOf(s, p);
  return a < 5 ? 0.4 : a < 16 ? 0.7 : a >= 60 ? 0.8 : 1;
}

function workRate(s: GameState, p: Person): number {
  if (p.sick || p.injured) return 0;
  let m = 1;
  if (p.traits.includes('diligent')) m *= 1.15;
  if (p.traits.includes('lazy')) m *= 0.85;
  if (p.skill === p.job) m *= 1.15; else m *= 0.92;
  if (isBlessed(s, p)) m *= 1.1;
  if (hasLaw(s, 'work-dawn')) m *= 1.08;
  if (p.health < 50) m *= 0.7;
  return m * guildRate(s, p);
}

export function economyDay(s: GameState) {
  const season = seasonIndex(s.day);
  const people = present(s);
  const hasDock = s.buildings.some((b) => b.kind === 'dock' && b.built && !b.removed);
  const hasKiln = s.buildings.some((b) => b.kind === 'kiln' && b.built && !b.removed);
  const hasFurnace = s.buildings.some((b) => b.kind === 'furnace' && b.built && !b.removed);
  const hasGranary = s.buildings.some((b) => b.kind === 'granary' && b.built && !b.removed);
  const knowledge = (1 + Math.min(0.3, s.flags.knowledge * 0.05)) * boost(s, 'food');
  const craft = boost(s, 'goods');
  const axes = boost(s, 'wood');
  const worked = new Set<number>();
  for (const b of s.buildings) if (b.kind === 'field' && b.built && !b.removed && b.worker !== undefined) worked.add(b.worker);

  let food = 0;
  let wood = 0;
  let cutTotal = 0;
  let cutters = 0;
  let goods = 0;
  let need = 0;
  const pop = people.length;
  const feast = hasLaw(s, 'feast-days') ? 1.03 : 1;
  // Nobody farms in winter: farmers hunt and gather with everyone else until spring.
  const asleep = fieldsAsleep(s);
  const frozen = !!s.weather?.ice;
  for (const p of people) {
    need += consumption(s, p) * feast;
    const rate = workRate(s, p);
    if (!rate) continue;
    const job = p.job === 'farmer' && asleep ? 'gatherer' : p.job;
    const foodRate = FOOD_RATE[job];
    if (foodRate) {
      let f = foodRate[season] * rate * knowledge;
      if (job === 'farmer' && season === 2) f *= (s.flags.harvest ?? 1) * (1 - (s.flags.harvestHurt ?? 0));
      if (job === 'farmer' && !worked.has(p.id)) f *= 0.6;
      if (job === 'fisher' && hasDock) f *= 1.2;
      if (job === 'fisher' && frozen) f *= 0.6; // fishing through holes in the ice
      food += f;
    } else if (p.job === 'woodcutter') {
      // Wood comes from real trees: the nearest grown ones, farther as the woods thin.
      const cut = chopWood(s, (season === 3 ? 1.0 : 1.6) * rate * axes);
      wood += cut;
      cutTotal += cut;
      cutters++;
    } else if (p.job === 'potter') {
      goods += (hasKiln ? 1 : 0.4) * rate * craft;
    } else if (p.job === 'smith') {
      goods += (hasFurnace ? 0.8 : 0.2) * rate * craft;
    } else if (p.job === 'none' && ageOf(s, p) >= 16) {
      food += 0.5 * rate; // forage a little
    }
    // When the stores run low, older children go out gathering too.
    if (p.job === 'child' && s.stores.food < need * 30 && ageOf(s, p) >= 10) food += 0.35;
    // In the first days everyone gathers some firewood.
    if (pop < 12 && ageOf(s, p) >= 14) wood += 0.25;
  }

  const [milk, wool] = herdYield(s, people.filter((p) => p.job === 'herder' && !p.sick && !p.injured).length);
  food += milk;
  goods += wool;
  s.stores.food += food;
  s.stores.wood += wood;
  // How much a woodcutter actually brings home, now that the woods are where they are.
  if (cutters) s.flags.woodYield = (s.flags.woodYield ?? 1.2) * 0.97 + (cutTotal / cutters) * 0.03;
  s.stores.goods += goods;
  s.stores.food *= hasGranary ? 0.9993 : 0.998;

  // Keeping warm. Running out of firewood in winter is miserable.
  const burn = firewoodPerPerson(s) * pop;
  if (s.stores.wood >= burn) s.stores.wood -= burn;
  else {
    s.stores.wood = 0;
    if (temperature(s) < 3) {
      if (s.flags.coldSince === undefined) {
        s.flags.coldSince = s.day;
        log(s, 'hunger', `The firewood ran out in the depth of winter. Families slept huddled together around the last embers.`, [], 4, 'The Cold Year');
      }
      for (const p of people) { p.health = Math.max(20, p.health - 0.25); p.mood -= 0.5; }
    }
  }
  if (temperature(s) >= 3) s.flags.coldSince = undefined;
  s.stores.goods *= hasLaw(s, 'tithe') ? 0.997 : 0.9995;

  if (s.stores.food >= need) {
    s.stores.food -= need;
    if (s.flags.hungerSince !== undefined && s.stores.food > need * 20) {
      s.flags.hungerSince = undefined;
      s.flags.hungerEnded = s.day;
      log(s, 'hunger', `The hunger in ${s.name} finally eased.`, [], 2);
    }
  } else {
    const shortfall = 1 - s.stores.food / Math.max(need, 0.01);
    s.stores.food = 0;
    starve(s, people, shortfall);
  }

  if (s.day % 30 === 11) forestMonth(s);
}

function starve(s: GameState, people: Person[], shortfall: number) {
  if (s.flags.hungerSince === undefined) {
    s.flags.hungerSince = s.day;
    const lines = {
      gentle: `The stores ran low in ${s.name}. Bellies grumbled and portions shrank.`,
      balanced: `Hunger came to ${s.name}. The stores were empty, and the children cried at night.`,
      grim: `The stores ran out. In ${s.name}, people boiled bark and leather and watched each other's ribs.`,
    };
    // Hunger that comes straight back is the same hard time, not a new one.
    const since = s.day - (s.flags.hungerEnded ?? -9999);
    if (since < 180) log(s, 'hunger', `The food ran out again in ${s.name}, before anyone had got their strength back.`, [], 4);
    else if (since < 3 * DAYS_PER_YEAR) log(s, 'hunger', `Hunger came back to ${s.name}${since < DAYS_PER_YEAR * 1.5 ? ', barely a year after the last' : ''}. People who had sworn it would never happen again tightened their belts without a word.`, [], 6, 'The Hungry Year');
    else log(s, 'hunger', lines[tone(s)], [], 6, 'The Hungry Year');
  }
  const floor = { gentle: 40, balanced: 15, grim: 0 }[tone(s)];
  for (const p of people) {
    const a = ageOf(s, p);
    const loss = shortfall * (a < 10 || a >= 60 ? 0.9 : 0.6) * (hasLaw(s, 'share-harvest') ? 0.6 : 1);
    p.health = Math.max(floor, p.health - loss);
    p.mood -= shortfall * 0.8;
  }
}

/** At the turn of each season: harvest news, lean-winter warnings. */
export function economySeason(s: GameState) {
  const season = seasonIndex(s.day);
  if (season === 2) {
    // The harvest: luck, and the summer it had. A long drought takes its share.
    const dry = s.weather?.dry ?? 0;
    s.flags.harvest = range(s.rng, 0.6, 1.3) * (dry > 25 ? Math.max(0.6, 1 - (dry - 25) * 0.012) : 1);
  }
  const people = present(s);
  const need = people.reduce((n, p) => n + consumption(s, p), 0);
  if (s.flags.hungerSince !== undefined && s.day - s.flags.hungerSince >= 60) emigrate(s);
  if (season === 3 && people.length) {
    const winterNeed = need * 90;
    const ratio = s.stores.food / Math.max(1, winterNeed);
    if (ratio >= 1.6) log(s, 'harvest', `The harvest was rich. The stores were full going into winter, and there was dancing around the fire.`, [], 2);
    else if (ratio < 0.7) log(s, 'harvest', `The harvest was thin. ${s.name} went into winter with too little in its stores.`, [], 3, 'The Lean Year');
  }
}

/** Reassign trades to match what the settlement needs. Most people keep their job. */
export function assignJobs(s: GameState) {
  const people = present(s).filter((p) => !p.preparing);
  const workers: Person[] = [];
  for (const p of people) {
    const a = ageOf(s, p);
    if (a < 16) { p.job = 'child'; continue; }
    if (a >= 62 && people.length > 8) {
      if (p.job !== 'elder') { p.job = 'elder'; p.jobSince = s.day; }
      continue;
    }
    if (p.job === 'child' || p.job === 'elder') p.job = 'none';
    workers.push(p);
  }
  const pop = people.length;
  const n = workers.length;
  if (!n) return;

  const wantsBuild = s.buildings.some((b) => !b.built && !b.removed);
  const need = people.reduce((t, p) => t + consumption(s, p), 0);
  const foodDays = s.stores.food / Math.max(1, need);
  const lean = foodDays < 120; // when stores are low, more hands go to food
  const target: Partial<Record<JobId, number>> = {};
  // Enough builders to finish what's planned in about two months.
  const backlog = s.buildings.reduce((t, b) => t + (!b.built && !b.removed ? b.required - b.progress : 0), 0);
  target.builder = wantsBuild ? Math.min(Math.ceil(n / (lean ? 12 : 6)), Math.max(1, Math.ceil(backlog / 60))) : n > 10 ? 1 : 0;
  // Enough woodcutters for firewood and building, fewer when the woodpile is high.
  const woodPerDay = pop * 0.02 + (target.builder ?? 0) * 1.6;
  let cutters = Math.min(Math.ceil(n / 3.5), Math.ceil(woodPerDay / Math.max(0.35, s.flags.woodYield ?? 1.2)));
  if (s.stores.wood > 1500) cutters = Math.floor(cutters / 2);
  if (s.stores.wood > 4000) cutters = 0;
  target.woodcutter = n >= 4 ? Math.max(s.stores.wood > 4000 ? 0 : 1, cutters) : 0;
  target.healer = pop >= 15 ? 1 + Math.floor(pop / 70) : 0;
  target.herder = s.buildings.filter((b) => b.kind === 'pen' && b.built && !b.removed && (b.herd ?? 0) > 0).length;
  target.potter = pop >= 20 && !lean ? 1 + Math.floor(pop / 45) : 0;
  target.smith = pop >= 30 && !lean ? 1 + Math.floor(pop / 60) : 0;
  const rest = Math.max(1, n - Object.values(target).reduce((a, b) => a + (b ?? 0), 0));
  // Feed everyone with a margin, more when stores are low, less when they overflow.
  const margin = foodDays < 120 ? 1.35 : foodDays > 600 ? 0.95 : 1.15;
  const perHand = 1.75 * (1 + Math.min(0.3, s.flags.knowledge * 0.05)) * boost(s, 'food');
  const foodHands = Math.min(rest, Math.max(1, Math.ceil((need * margin) / perHand)));
  target.fisher = Math.round(foodHands * 0.22); // the settlement always sits near the river
  target.gatherer = Math.round(foodHands * 0.16);
  target.farmer = Math.max(1, foodHands - (target.fisher ?? 0) - (target.gatherer ?? 0));
  // Spare hands go to crafts: pots and bronze make life more comfortable.
  const spare = rest - foodHands;
  if (spare > 0) {
    target.potter = (target.potter ?? 0) + Math.ceil(spare * 0.5);
    target.smith = (target.smith ?? 0) + Math.floor(spare * 0.3);
    target.gatherer = (target.gatherer ?? 0) + Math.max(0, spare - Math.ceil(spare * 0.5) - Math.floor(spare * 0.3));
  }

  const count: Partial<Record<JobId, number>> = {};
  const unassigned: Person[] = [];
  for (const p of workers) {
    const j = p.job;
    if (j !== 'none' && (count[j] ?? 0) < (target[j] ?? 0)) count[j] = (count[j] ?? 0) + 1;
    else unassigned.push(p);
  }
  const open = (j: JobId) => (target[j] ?? 0) - (count[j] ?? 0);
  // Skilled people fill their own trades first, then anyone fills what's left.
  for (const pass of [0, 1]) {
    for (const p of [...unassigned]) {
      let job: JobId | undefined;
      if (pass === 0 && open(p.skill) > 0) job = p.skill;
      if (pass === 1) {
        const openJobs = (Object.keys(target) as JobId[]).filter((j) => open(j) > 0);
        if (openJobs.length) job = openJobs.sort((a, b) => open(b) - open(a))[0];
      }
      if (!job) continue;
      if (p.job !== job) { p.job = job; p.jobSince = s.day; }
      count[job] = (count[job] ?? 0) + 1;
      unassigned.splice(unassigned.indexOf(p), 1);
    }
  }
  for (const p of unassigned) {
    const j = pick(s.rng, ['farmer', 'gatherer'] as JobId[]);
    if (p.job !== j) { p.job = j; p.jobSince = s.day; }
  }
}

/** After a long hunger, the unhappiest families give up and move away. */
function emigrate(s: GameState) {
  // A handful of people who came this far together see a bad winter through together.
  if (present(s).length < 20) return;
  const byHome = new Map<number, Person[]>();
  for (const p of present(s)) {
    if (p.home === undefined || p.preparing) continue;
    const list = byHome.get(p.home) ?? [];
    list.push(p);
    byHome.set(p.home, list);
  }
  const households = [...byHome.values()].filter((h) => !h.some((p) => p.patron || p.lineage));
  households.sort((a, b) => avgMood(a) - avgMood(b));
  const leaving = households.slice(0, Math.ceil(households.length * (hasLaw(s, 'share-harvest') ? 0.03 : 0.06)));
  for (const h of leaving) {
    for (const p of h) {
      p.alive = false;
      p.left = true;
      p.died = s.day;
      p.cause = 'moved away';
      p.courting = undefined;
      if (p.spouse !== undefined && !h.some((x) => x.id === p.spouse)) {
        const sp = s.people[p.spouse];
        if (sp) sp.spouse = undefined;
        p.spouse = undefined;
      }
    }
    const head = h.find((p) => ageOf(s, p) >= 16) ?? h[0];
    log(s, 'parting', h.length > 1
      ? `${P(head.id)} packed up the household and left ${s.name}, looking for a place where the stores were full. ${h.length - 1} went with ${head.sex === 'f' ? 'her' : 'him'}.`
      : `${P(head.id)} gave up on ${s.name} and walked away down the river road.`, h.map((p) => p.id), 3);
  }
}

function avgMood(h: Person[]) {
  return h.reduce((t, p) => t + p.mood, 0) / h.length;
}
