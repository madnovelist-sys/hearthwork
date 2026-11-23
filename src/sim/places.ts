// Sacred places. Nobody builds them: people who range out from the village
// (gatherers, herders, woodcutters, the restless and the curious) come across
// things in the country around it: a ring of standing stones, an old grove,
// a spring, a barrow, a cairn, a vast old tree. Over the years some become
// sacred: offerings, weddings, healing, faiths of their own.
import { looksWet } from './shore';
import { log, P } from './chronicle';
import { chance, pick, rand, weighted } from './rng';
import { TERRAIN, TREE, DAYS_PER_YEAR, type Building, type BuildingKind, type GameState, type Person, type TenetId } from './types';
import { ageOf, present, tone } from './world';
import { addBuilding, settlementRegion } from './planner';
import { plantFaithSeed } from './society';
import { isWater } from './mapgen';

export type SiteKind = 'stones' | 'grove' | 'spring' | 'barrow' | 'cairn' | 'bigtree';
export const SITE_KINDS: SiteKind[] = ['stones', 'grove', 'spring', 'barrow', 'cairn', 'bigtree'];
export const isSite = (k: BuildingKind) => (SITE_KINDS as string[]).includes(k);

const SITE_NAMES: Record<SiteKind, string[]> = {
  stones: ['the Nine Maidens', 'the Long Stones', 'the Grey Wethers', 'the Dancers', 'the Whispering Stones', 'the Ring on the Ridge'],
  grove: ['the Whispering Grove', 'the Elder Wood', 'the Grove of Ribbons', 'the Quiet Trees', 'the Hollow Grove'],
  spring: ["Bride's Well", 'the Cold Spring', 'the Laughing Spring', "the Maiden's Pool", 'the Eye of the Hill'],
  barrow: ['the Old Barrow', "the Giant's Grave", 'the Long Barrow', 'the Sleeping Hill', "the Old King's Mound"],
  cairn: ["the Shepherd's Cairn", 'the Grey Cairn', 'the Heap of Stones', "the Watcher's Cairn"],
  bigtree: ['the Hanging Oak', 'the Old Yew', 'the Grandmother Tree', 'the Lightning Oak', 'the Wishing Tree'],
};

const FOUND: Record<SiteKind, string> = {
  stones: '{p}, following a strayed goat {dir}, came on a ring of standing stones half sunk in the heather. Nobody in {town} had known they were there. People began to call them {name}.',
  grove: '{p} went deeper into the woods {dir} than anyone had before, and found a ring of ancient trees where no birds sang. It came to be called {name}.',
  spring: '{p} found a spring {dir} of {town}, welling up cold and clear between mossy stones that someone had set there long ago. People called it {name}.',
  barrow: '{p} noticed that a long hill {dir} of {town} was too even to be a hill. It was a grave, older than anyone could remember. They called it {name}.',
  cairn: '{p} climbed the high ground {dir} and found a great heap of stones, each one carried up by someone long ago. It was called {name}.',
  bigtree: '{p} found an oak {dir} so old and so wide that five people holding hands could not reach around it. It came to be called {name}.',
};

const EERIE: Record<SiteKind, string> = {
  stones: 'On still nights, people swore the stones stood in a slightly different ring.',
  grove: 'Things left there overnight were found the next morning, moved a little, neatly.',
  spring: "Its water never froze, even in the hardest winter.",
  barrow: 'On the longest night, a light was seen moving inside it.',
  cairn: 'However many stones were taken, the heap was never any smaller.',
  bigtree: 'Its leaves rustled when there was no wind.',
};

/** What a place stirs in people's beliefs, if it becomes holy. */
const TENET_OF: Record<SiteKind, TenetId> = {
  stones: 'land', grove: 'land', spring: 'river', barrow: 'ancestors', cairn: 'ancestors', bigtree: 'land',
};

export const SITE_FOOTPRINT: Record<SiteKind, [number, number]> = {
  stones: [2, 2], grove: [2, 2], spring: [1, 1], barrow: [2, 2], cairn: [1, 1], bigtree: [1, 1],
};

export const sitesOf = (s: GameState) => s.buildings.filter((b) => !b.removed && isSite(b.kind));

function direction(s: GameState, x: number, y: number): string {
  // The grid's axes run diagonally on screen; "north" is up the screen.
  const sx = (x - s.hearth.x) - (y - s.hearth.y);
  const sy = (x - s.hearth.x) + (y - s.hearth.y);
  const a = Math.atan2(sy, sx);
  const dirs = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  return dirs[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}

/** Choose what's out there at a spot, by the land around it. */
function siteHere(s: GameState, x: number, y: number): SiteKind | null {
  const { map } = s;
  let trees = 0, rock = 0, water = 99;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
      const i = ty * map.w + tx;
      const t = map.terrain[i];
      if (isWater(t)) water = Math.min(water, Math.max(Math.abs(dx), Math.abs(dy)));
      if (t === TERRAIN.ROCK) rock++;
      const tr = map.trees[i];
      if (tr === TREE.BROADLEAF || tr === TREE.PINE || tr === TREE.FRUIT) trees++;
    }
  }
  const options: [SiteKind, number][] = [
    ['stones', 2 + rock * 0.4], ['cairn', rock * 0.5], ['spring', water <= 3 ? 3 : 0],
    ['grove', trees >= 12 ? 4 : 0], ['bigtree', trees >= 4 ? 2 : 0.5], ['barrow', trees < 8 ? 2 : 0.5],
  ];
  // Each kind of place is found once or twice, not over and over.
  for (const o of options) o[1] /= 1 + sitesOf(s).filter((b) => b.kind === o[0]).length * 2;
  return weighted(s.rng, options);
}

function footprintFree(s: GameState, x: number, y: number, w: number, h: number, region: Uint8Array): boolean {
  const { map } = s;
  const wet = looksWet(map); // not where the river's painted edge spreads over the land
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 1 || yy < 1 || xx >= map.w - 1 || yy >= map.h - 1) return false;
      const i = yy * map.w + xx;
      const t = map.terrain[i];
      if (map.occ[i] || map.walls?.[i] || !region[i] || wet[i]) return false;
      if (t !== TERRAIN.GRASS && t !== TERRAIN.SAND && t !== TERRAIN.ROCK && t !== TERRAIN.MARSH) return false;
    }
  }
  return true;
}

/** Someone out in the country around the village finds something. Returns it, if they did. */
export function findPlace(s: GameState, by?: Person): Building | null {
  const people = present(s).filter((p) => ageOf(s, p) >= 14);
  const explorer = by ?? (people.length ? weighted(s.rng, people.map((p) => {
    let w = ['gatherer', 'herder', 'woodcutter', 'fisher'].includes(p.job) ? 3 : 0.4;
    if (p.traits.includes('restless') || p.traits.includes('curious')) w *= 2.5;
    if (p.traits.includes('brave')) w *= 1.5;
    if (p.traits.includes('homebody') || p.traits.includes('timid')) w *= 0.3;
    return [p, w] as const;
  })) : undefined);
  if (!explorer) return null;
  const { map, hearth } = s;
  const region = settlementRegion(s);
  const nBuilt = s.buildings.filter((b) => !b.removed && b.kind !== 'field').length;
  const ring = 2.6 + Math.sqrt(nBuilt) * 0.85;
  const near = Math.max(9, ring + 5);
  const far = Math.min((map.w >> 1) - 3, near + 18);
  for (let tries = 0; tries < 300; tries++) {
    const a = rand(s.rng) * Math.PI * 2;
    const d = near + rand(s.rng) * (far - near);
    const x = Math.round(hearth.x + Math.cos(a) * d);
    const y = Math.round(hearth.y + Math.sin(a) * d);
    const kind = siteHere(s, x, y);
    if (!kind) continue;
    const [w, h] = SITE_FOOTPRINT[kind];
    if (!footprintFree(s, x, y, w, h, region)) continue;
    const b = addBuilding(s, kind, x, y, { built: true });
    // A little open ground around it (a grove or a great tree keeps its woods).
    if (kind !== 'grove' && kind !== 'bigtree') {
      for (let yy = y - 1; yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) {
        if (xx < 0 || yy < 0 || xx >= map.w || yy >= map.h) continue;
        const i = yy * map.w + xx;
        if (!map.occ[i] && map.trees[i] !== TREE.BOULDER) map.trees[i] = TREE.NONE;
      }
    }
    const free = SITE_NAMES[kind].filter((n) => !s.buildings.some((o) => o.name === n));
    b.name = pick(s.rng, free.length ? free : SITE_NAMES[kind]);
    b.sacred = 0;
    b.foundBy = explorer.id;
    explorer.renown += 8;
    let text = FOUND[kind].replace('{p}', P(explorer.id)).replace('{dir}', direction(s, x, y)).replace('{town}', s.name).replace('{name}', b.name);
    if (s.settings.weirdness >= 2 && chance(s.rng, 0.3 + s.settings.weirdness * 0.15)) text += ` ${EERIE[kind]}`;
    log(s, 'discovery', text, [explorer.id], 5, `The Year ${explorer.first} Found ${b.name.replace(/^the /, 'the ')}`);
    return b;
  }
  return null;
}

const OFFERINGS = [
  '{p} began leaving a little bread at {name} every new moon, and soon others did too.',
  'Ribbons began to appear on the bushes around {name}, tied there by people who would not say what they had asked for.',
  'Children dared each other to touch {name} after dark. {p} did, and ran all the way home.',
  '{p} and {q} were married at {name}, the first couple to want that. They were not the last.',
  'People began to say that a wish made at {name} on midsummer morning would come true, if you told no one.',
];

/**
 * Once a year: places people visit grow more sacred. Pious people, faiths that honor the land,
 * the ancestors or the river, and burials near a barrow all add to it.
 */
export function placesYear(s: GameState) {
  const sites = sitesOf(s);
  const years = s.day / DAYS_PER_YEAR;
  // Now and then someone finds a new place, fewer as there are more.
  if (sites.length < Math.min(6, 1 + Math.floor(years / 10)) && years >= 2 && chance(s.rng, 0.35)) findPlace(s);
  if (!sites.length) return;
  const people = present(s).filter((p) => ageOf(s, p) >= 12);
  const pious = people.filter((p) => p.traits.includes('pious')).length;
  for (const b of sites) {
    const before = b.sacred ?? 0;
    const kind = b.kind as SiteKind;
    const tenet = TENET_OF[kind];
    const keepers = s.faiths.filter((f) => !f.gone && f.tenets.includes(tenet)).length;
    let grow = 1.5 + Math.min(4, pious * 0.12) + keepers * 3 + rand(s.rng) * 2;
    if (s.settings.weirdness >= 2) grow += 1;
    b.sacred = Math.min(100, before + grow);
    if (before < 35 && b.sacred >= 35) {
      const p = people.length ? pick(s.rng, people) : undefined;
      const q = people.find((x) => p && x.spouse === p.id) ?? (people.length ? pick(s.rng, people) : undefined);
      if (p && q) log(s, 'faith', pick(s.rng, OFFERINGS).replace('{p}', P(p.id)).replace('{q}', P(q.id)).replace('{name}', b.name!), [p.id, q.id], 3);
    }
    if (before < 70 && b.sacred >= 70) {
      log(s, 'faith', `${cap(b.name!)} had become a holy place. People went quiet when they came near it, and nobody would take so much as a twig from it.`, [], 5);
      plantFaithSeed(s, tenet);
      plantFaithSeed(s, tenet);
    }
    // A faith that honors such places takes this one as its own.
    if (b.sacred >= 70 && b.faith === undefined) {
      const f = s.faiths.find((x) => !x.gone && x.tenets.includes(tenet) && !s.buildings.some((o) => !o.removed && isSite(o.kind) && o.faith === x.id));
      if (f) {
        b.faith = f.id;
        log(s, 'faith', `The followers of ${f.name} made ${b.name} their holy place, and kept its holy days there.`, [], 4);
      }
    }
    // Small things happen at sacred places.
    if (b.sacred >= 35 && chance(s.rng, 0.25)) placeMoment(s, b);
  }
}

function placeMoment(s: GameState, b: Building) {
  const name = b.name!;
  const people = present(s).filter((p) => ageOf(s, p) >= 8);
  if (!people.length) return;
  const p = pick(s.rng, people);
  if (b.kind === 'spring') {
    const sick = people.find((x) => x.sick && !x.sick.plague);
    if (sick && chance(s.rng, 0.5)) {
      sick.sick = undefined;
      log(s, 'faith', `${P(sick.id)} was carried to ${name} with a fever and bathed in the cold water. By morning the fever had gone.`, [sick.id], 3);
      return;
    }
  }
  const lines: Record<SiteKind, string[]> = {
    stones: [`${P(p.id)} spent a whole night inside ${name}, and would never say what ${p.sex === 'f' ? 'she' : 'he'} saw.`, `${P(p.id)} counted ${name} twice and got a different number each time.`],
    grove: [`${P(p.id)} went to ${name} to be alone with a grief, and came back lighter.`, `Every spring, the young people of ${s.name} went to ${name} to hang new ribbons on the oldest tree.`],
    spring: [`${P(p.id)} dropped a bronze pin into ${name} and made a wish. ${tone(s) === 'grim' ? 'It did not come true.' : 'Nobody ever learned whether it came true.'}`],
    barrow: [`${P(p.id)} left the first flowers of spring on ${name}, for the old dead nobody remembers.`, `Some of the old people of ${s.name} asked to be laid to rest near ${name}, so they would not be alone.`],
    cairn: [`${P(p.id)} carried a stone up to ${name}, as everyone does now before a long journey.`],
    bigtree: [`${P(p.id)} carved two names into the bark of ${name}. The tree has a great many names on it now.`],
  };
  log(s, 'season', pick(s.rng, lines[b.kind as SiteKind]), [p.id], 2);
}

/** Pious people take comfort from a holy place nearby. */
export function placesMood(s: GameState, p: Person): number {
  if (!p.traits.includes('pious')) return 0;
  return holiest(s) >= 70 ? 3 : 0;
}

const holyCache = new WeakMap<object, { day: number; v: number }>();
function holiest(s: GameState): number {
  let c = holyCache.get(s);
  if (!c || c.day !== s.day) {
    let v = 0;
    for (const b of s.buildings) if (!b.removed && isSite(b.kind)) v = Math.max(v, b.sacred ?? 0);
    c = { day: s.day, v };
    holyCache.set(s, c);
  }
  return c.v;
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
