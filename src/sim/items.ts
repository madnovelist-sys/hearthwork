// Heirlooms: named things with histories. A sword brought home from a quest,
// a master potter's bowl, a mother's comb. They pass from generation to
// generation, are sometimes buried with their owners, and sometimes lost.
import { F, log, P } from './chronicle';
import { chance, pick } from './rng';
import type { GameState, Item, ItemKind, Person } from './types';
import { ageOf, present } from './world';

const ADJ = ['Singing', 'Old', 'Red', "Wolf's", 'Long', 'Bright', 'Grey', 'Winter', 'Lucky', 'Quiet'];
const COLOR = ['Blue', 'Red', 'Black', 'Ochre', 'Green', 'White'];

export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  blade: 'bronze sword', torc: 'gold torc', ring: 'bronze ring', bowl: 'painted bowl', comb: 'bone comb',
  cloak: 'woven cloak', flute: 'bone flute', mask: 'bronze mask', stone: 'carved stone', disc: 'jet disc',
};

export function itemName(s: GameState, kind: ItemKind, p: Person): string {
  const r = s.rng;
  switch (kind) {
    case 'blade': return pick(r, [`the ${p.family} Blade`, `${p.first}'s Sword`, `the ${pick(r, ADJ)} Blade`]);
    case 'torc': return pick(r, [`the Gold Torc of ${p.first}`, `the ${pick(r, ADJ)} Torc`]);
    case 'ring': return pick(r, [`${p.first}'s Bronze Ring`, `the ${pick(r, ADJ)} Ring`]);
    case 'bowl': return pick(r, [`${p.first}'s ${pick(r, COLOR)} Bowl`, `the ${pick(r, ADJ)} Bowl`]);
    case 'comb': return `${p.first}'s Bone Comb`;
    case 'cloak': return `the ${pick(r, COLOR)} Cloak`;
    case 'flute': return 'the Bone Flute';
    case 'mask': return 'the Blind Mask';
    case 'stone': return 'the Warm Stone';
    case 'disc': return 'the Jet Disc';
  }
}

export function makeItem(s: GameState, kind: ItemKind, owner: Person, how: 'made' | 'found' | 'brought', name?: string): Item {
  const item: Item = {
    id: s.nextId.item++,
    name: name ?? itemName(s, kind, owner),
    kind,
    made: s.day,
    maker: how === 'made' ? owner.id : undefined,
    owner: owner.id,
    history: [{ day: s.day, person: owner.id, how }],
  };
  s.items.push(item);
  return item;
}

export const itemsOf = (s: GameState, personId: number) => s.items.filter((i) => i.owner === personId && !i.lost && !i.buried);

const ordinal = (n: number) => ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'][n - 1] ?? `${n}th`;

/** Someone died: their heirlooms are buried with them, or passed down. */
export function passHeirlooms(s: GameState, dead: Person) {
  for (const item of itemsOf(s, dead.id)) {
    if (dead.away !== undefined) {
      // Died far from home: what they carried is lost with them.
      item.owner = undefined;
      item.lost = true;
      item.history.push({ day: s.day, person: dead.id, how: 'lost' });
      continue;
    }
    let bury = 0.1;
    if (dead.renown >= 40) bury += 0.15;
    if (dead.origin === 'founder') bury += 0.1;
    if (chance(s.rng, bury)) {
      item.owner = undefined;
      item.buried = true;
      item.history.push({ day: s.day, person: dead.id, how: 'buried' });
      const how: Record<string, string> = { burial: 'was buried with', cremation: 'went onto the pyre with', sky: 'was laid out under the sky with', tomb: 'was laid in the tomb with', river: 'went down the river with' };
      log(s, 'season', `${P(dead.id)} ${how[s.traditions?.dead?.custom ?? 'burial']} ${item.name}.`, [dead.id], 3);
      continue;
    }
    const heir = heirOf(s, dead);
    const generation = item.history.filter((h) => h.how === 'inherited').length + 2;
    if (heir) {
      item.owner = heir.id;
      item.history.push({ day: s.day, person: heir.id, how: 'inherited' });
      const age = Math.floor((s.day - item.made) / 360);
      const note = generation >= 3 ? ` ${heir.sex === 'f' ? 'She' : 'He'} was the ${ordinal(generation)} to keep it${age >= 20 ? `, in ${age} years` : ''}.` : '';
      log(s, 'season', `${item.name} passed from ${F(dead.id)} to ${P(heir.id)}.${note}`, [heir.id, dead.id], generation >= 3 ? 4 : 3);
    } else {
      item.owner = undefined;
      item.village = true;
      item.history.push({ day: s.day, how: 'kept' });
      log(s, 'season', `With no one left to inherit it, ${item.name} was hung in the gathering place, where everyone could see it.`, [], 3);
    }
  }
}

function heirOf(s: GameState, dead: Person): Person | undefined {
  const here = (p?: Person) => !!p && p.alive && !p.left && p.away === undefined;
  const kids = dead.children.map((c) => s.people[c]).filter((c) => here(c) && ageOf(s, c) >= 12).sort((a, b) => a.born - b.born);
  if (kids.length) return kids[0];
  const spouse = dead.spouse !== undefined ? s.people[dead.spouse] : undefined;
  if (here(spouse)) return spouse;
  const grandkids = dead.children.flatMap((c) => s.people[c]?.children ?? []).map((g) => s.people[g]).filter((g) => here(g) && ageOf(s, g) >= 12);
  if (grandkids.length) return grandkids[0];
  const siblings = dead.parents.flatMap((p) => s.people[p]?.children ?? []).filter((id) => id !== dead.id).map((id) => s.people[id]).filter(here);
  return siblings[0];
}

/** A keepsake given at a wedding, now and then. */
export function weddingKeepsake(s: GameState, a: Person, b: Person) {
  if (!chance(s.rng, 0.12)) return;
  const child = pick(s.rng, [a, b]);
  const parent = child.parents.map((id) => s.people[id]).find((p) => p?.alive && p.away === undefined);
  if (!parent) return;
  const owned = itemsOf(s, parent.id);
  if (owned.length) {
    const item = owned[0];
    item.owner = child.id;
    item.history.push({ day: s.day, person: child.id, how: 'gift' });
    log(s, 'season', `At the wedding, ${P(parent.id)} gave ${F(child.id)} ${item.name}.`, [parent.id, child.id], 3);
  } else {
    const kind: ItemKind = pick(s.rng, ['comb', 'cloak', 'ring']);
    const item = makeItem(s, kind, parent, 'made', kind === 'comb' ? `${parent.first}'s Bone Comb` : undefined);
    item.owner = child.id;
    item.history.push({ day: s.day, person: child.id, how: 'gift' });
    log(s, 'season', `At the wedding, ${P(parent.id)} gave ${F(child.id)} ${item.name}, made with ${parent.sex === 'f' ? 'her' : 'his'} own hands.`, [parent.id, child.id], 2);
  }
}

/** Once a year: master crafters make things worth keeping; heirlooms leave with those who move away. */
export function itemsYear(s: GameState) {
  for (const p of present(s)) {
    if ((p.job !== 'potter' && p.job !== 'smith') || s.day - p.jobSince < 8 * 360) continue;
    if (!(p.traits.includes('diligent') || p.traits.includes('clever') || p.skill === p.job)) continue;
    if (!chance(s.rng, 0.08)) continue;
    const kind: ItemKind = p.job === 'potter' ? 'bowl' : pick(s.rng, ['blade', 'torc', 'ring'] as ItemKind[]);
    const item = makeItem(s, kind, p, 'made');
    p.renown += 6;
    log(s, 'season', `${P(p.id)} made ${item.name}, a ${ITEM_KIND_LABEL[kind]} so fine that people came from the far fields to look at it.`, [p.id], 3);
  }
  for (const item of s.items) {
    const owner = item.owner !== undefined ? s.people[item.owner] : undefined;
    if (owner?.left) {
      item.lost = true;
      item.owner = undefined;
      item.history.push({ day: s.day, person: owner.id, how: 'lost' });
    }
  }
}

/** Someone given up for lost walked back in, still carrying what they left with. */
export function itemsReturn(s: GameState, p: Person) {
  for (const item of s.items) {
    if (item.lost && item.history[item.history.length - 1]?.person === p.id) {
      item.lost = false;
      item.owner = p.id;
      item.history.push({ day: s.day, person: p.id, how: 'returned' });
    }
  }
}
