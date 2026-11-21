// Animals: herds of goats and sheep in pens, the dogs and cats who live with
// families, and the deer in the woods (fewer as the woods are cut and hunted).
import { F, log, P } from './chronicle';
import { chance, int, pick, range } from './rng';
import type { Building, GameState, Person, Pet } from './types';
import { DAYS_PER_YEAR } from './types';
import { ageOf, darkFactor, present, seasonIndex, tone } from './world';
import { nearWoods } from './forest';

const DOG_NAMES = ['Bran', 'Fen', 'Smoke', 'Ash', 'Brindle', 'Rust', 'Pip', 'Tuck', 'Scamp', 'Tawny', 'Burr', 'Sorrel', 'Grip', 'Moss', 'Bracken', 'Hollow', 'Wag', 'Biscuit'];
const CAT_NAMES = ['Mouse', 'Soot', 'Whisker', 'Ember', 'Moth', 'Thistle', 'Pebble', 'Smudge', 'Wren', 'Flint', 'Nettle', 'Sable'];

export const HERD_MAX = 14;

export const petsOf = (s: GameState, personId: number) => s.pets.filter((p) => p.alive && p.owner === personId);

function addPet(s: GameState, kind: Pet['kind'], owner: Person): Pet {
  const taken = new Set(s.pets.filter((p) => p.alive).map((p) => p.name));
  const names = (kind === 'dog' ? DOG_NAMES : CAT_NAMES).filter((n) => !taken.has(n));
  const pet: Pet = { id: s.nextId.pet++, kind, name: pick(s.rng, names.length ? names : kind === 'dog' ? DOG_NAMES : CAT_NAMES), owner: owner.id, born: s.day, alive: true };
  s.pets.push(pet);
  return pet;
}

/** A pet's owner died: the family keeps it, or someone kind takes it in. */
export function orphanPets(s: GameState, dead: Person) {
  for (const pet of petsOf(s, dead.id)) {
    const family = [dead.spouse, ...dead.children].map((id) => (id === undefined ? undefined : s.people[id]))
      .filter((p): p is Person => !!p && p.alive && !p.left && p.away === undefined);
    const keeper = family[0] ?? present(s).filter((p) => p.traits.includes('kind') && ageOf(s, p) >= 14)[0];
    pet.owner = keeper?.id;
    if (!keeper) { pet.alive = false; pet.died = s.day; }
    if (pet.kind === 'dog' && dead.away === undefined && chance(s.rng, 0.5)) {
      log(s, 'season', `${pet.name}, ${F(dead.id)}'s dog, lay on ${dead.sex === 'f' ? 'her' : 'his'} grave for a week and would not be called away.`, [dead.id], 3);
    }
  }
}

/** Once a year: puppies and kittens find homes, old pets die. */
export function petsYear(s: GameState) {
  const people = present(s);
  const hasGranary = s.buildings.some((b) => b.kind === 'granary' && b.built && !b.removed);
  for (const pet of s.pets) {
    if (!pet.alive) continue;
    const age = (s.day - pet.born) / DAYS_PER_YEAR;
    const owner = pet.owner !== undefined ? s.people[pet.owner] : undefined;
    if (owner && (owner.left || (owner.away !== undefined && owner.lost))) { pet.alive = false; pet.died = s.day; continue; }
    if (age > (pet.kind === 'dog' ? 10 : 13) && chance(s.rng, 0.25 + (age - 10) * 0.08)) {
      pet.alive = false;
      pet.died = s.day;
      if (owner?.alive) {
        const its = pet.kind === 'dog' ? 'his' : 'her';
        log(s, 'season', pick(s.rng, [
          `${pet.name}, ${P(owner.id)}'s old ${pet.kind}, died in ${its} sleep by the fire.`,
          `${pet.name}, ${P(owner.id)}'s old ${pet.kind}, went off into the woods one evening, as old animals do, and didn't come back.`,
          `${pet.name}, ${P(owner.id)}'s ${pet.kind}, died with ${its} head on ${P(owner.id)}'s knee.`,
          `${P(owner.id)} buried ${pet.name}, ${owner.sex === 'f' ? 'her' : 'his'} old ${pet.kind}, under the tree ${pet.kind === 'dog' ? 'he' : 'she'} always slept beneath.`,
        ]), [owner.id], 2);
      }
    }
  }
  // New pets: families with children, kind or lonely people.
  const homes = new Map<number, Person[]>();
  for (const p of people) if (p.home !== undefined) homes.set(p.home, [...(homes.get(p.home) ?? []), p]);
  for (const [, family] of homes) {
    if (family.some((p) => petsOf(s, p.id).length)) continue;
    const adults = family.filter((p) => ageOf(s, p) >= 16);
    if (!adults.length) continue;
    const kids = family.filter((p) => ageOf(s, p) < 14);
    let want = 0.025 + kids.length * 0.015;
    if (adults.some((p) => p.traits.includes('kind') || p.traits.includes('homebody'))) want += 0.02;
    if (adults.length === 1 && adults[0].spouse === undefined) want += 0.02;
    if (!chance(s.rng, want)) continue;
    const kind: Pet['kind'] = hasGranary && chance(s.rng, 0.35) ? 'cat' : 'dog';
    const owner = kids.length && chance(s.rng, 0.6) ? pick(s.rng, kids) : pick(s.rng, adults);
    const pet = addPet(s, kind, owner);
    log(s, 'season', kind === 'dog'
      ? pick(s.rng, [`${P(owner.id)} came home with a puppy and named him ${pet.name}.`, `A stray dog followed ${P(owner.id)} home and stayed. They called him ${pet.name}.`])
      : `A cat moved into the granary, then into ${P(owner.id)}'s house. ${pet.name}, they called her.`, [owner.id], 1);
  }
  // Now and then, a dog does something heroic.
  for (const pet of s.pets) {
    if (!pet.alive || pet.kind !== 'dog' || !chance(s.rng, 0.02)) continue;
    const child = people.find((p) => ageOf(s, p) < 8);
    if (!child) continue;
    log(s, 'season', `${pet.name} pulled little ${P(child.id)} out of the river by the collar. That dog ate well for the rest of his life.`, [child.id], 4);
  }
}

// ---------------------------------------------------------------------------
// Herds

export function startHerd(s: GameState, pen: Building) {
  pen.herd = int(s.rng, 4, 6);
}

/** Daily: herders' milk, cheese and wool. Returns [food, goods]. */
export function herdYield(s: GameState, herders: number): [number, number] {
  const pens = s.buildings.filter((b) => b.kind === 'pen' && b.built && !b.removed && (b.herd ?? 0) > 0);
  if (!pens.length || !herders) return [0, 0];
  const animals = pens.reduce((n, b) => n + (b.herd ?? 0), 0);
  const tended = Math.min(1, herders / pens.length);
  const season = seasonIndex(s.day);
  const milk = [0.07, 0.09, 0.06, 0.03][season];
  return [animals * milk * tended, animals * 0.025 * tended];
}

/** Each season: herds grow in spring, wolves come in winter, hunger means slaughter. */
export function herdsSeason(s: GameState) {
  const season = seasonIndex(s.day);
  const hungry = s.flags.hungerSince !== undefined;
  for (const pen of s.buildings) {
    if (pen.kind !== 'pen' || !pen.built || pen.removed) continue;
    pen.herd ??= 0;
    if (season === 0 && pen.herd >= 2) pen.herd = Math.min(HERD_MAX, pen.herd + int(s.rng, 1, Math.max(1, Math.floor(pen.herd / 3))));
    else if (season === 0 && pen.herd < 2 && s.stores.goods >= 25) {
      s.stores.goods -= 25;
      pen.herd += 3;
      log(s, 'season', `Three goats were traded for pots at the spring market, to start the herd again.`, [], 1);
    }
    if (season === 3 && tone(s) !== 'gentle' && pen.herd > 0) {
      const dogs = s.pets.some((p) => p.alive && p.kind === 'dog');
      if (chance(s.rng, (dogs ? 0.07 : 0.16) * darkFactor(s))) {
        const lost = Math.min(pen.herd, int(s.rng, 1, 3));
        pen.herd -= lost;
        log(s, 'season', `Wolves came down from the hills in the snow and took ${lost === 1 ? 'a goat' : `${lost} of the goats`}. The herders sat up with torches for the rest of the winter.`, [], 3);
      }
    }
    // In hunger, the herd is culled, but never below a breeding few, and once a year at most.
    if (hungry && pen.herd > 3 && s.day - (pen.culled ?? -9999) >= 360) {
      pen.culled = s.day;
      const n = Math.max(1, Math.floor((pen.herd - 3) / 2) + 1);
      pen.herd -= n;
      s.stores.food += n * 30;
      log(s, 'hunger', `With the stores empty, ${n} of the goats were slaughtered. Nobody liked it, but nobody went hungry that week.`, [], 3);
    }
  }
}

// ---------------------------------------------------------------------------
// Wild deer

/** Once a year: deer follow the woods; hunters thin them. */
export function deerYear(s: GameState) {
  const woods = nearWoods(s);
  const capacity = Math.round(woods / 6);
  if (s.wild.deer < 0) s.wild.deer = capacity; // first count (and older saves)
  const hunters = present(s).filter((p) => p.job === 'gatherer').length;
  const before = s.wild.deer;
  let deer = before + (capacity - before) * 0.3 - hunters * range(s.rng, 0.3, 0.8);
  deer = Math.max(0, Math.round(deer));
  s.wild.deer = deer;
  if (before >= 10 && deer < 3) log(s, 'season', `No one had seen a deer near ${s.name} in a long while. The old hunters said the woods had gone quiet.`, [], 3);
  else if (before < 3 && deer >= 10) log(s, 'season', `The deer came back to the woods. A stag was seen drinking at the river at dawn.`, [], 2);
}

