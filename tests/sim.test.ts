import { describe, expect, it } from 'vitest';
import { arrivalsSeason, draws, makeArrivalOptions, settleParty } from '../src/sim/arrivals';
import { call, callOptions, hooksYear } from '../src/sim/callers';
import { findPlace, placesYear, sitesOf } from '../src/sim/places';
import { createSettler, sendOnQuest, welcomeParty } from '../src/sim/acts';
import { foundSettlement, stepDay } from '../src/sim/sim';
import { DAYS_PER_YEAR, type GameState } from '../src/sim/types';
import { ageOf, population } from '../src/sim/world';
import { GOAL_SPARKS, logWords, startSession, stopSession, tick, focusDay } from '../src/game/clock';
import { parseSave } from '../src/game/save';
import { expandMap, growMap, isWater } from '../src/sim/mapgen';
import { DISCOVERIES, agesYear, beginSideAge, boost, discover, discovery, discoveryThreshold, drawDifficulty, loreDay } from '../src/sim/ages';
import { actCost, inspire } from '../src/sim/acts';
import { CUSTOM_BY_ID, nudgeWay, waysHere } from '../src/sim/culture';
import { dirOf } from '../src/render/citizens';
import { addBuilding, findSite, settlementRegion } from '../src/sim/planner';
import { describeArms, grantCharter, planBridge, planWalls, progressWalls } from '../src/sim/town';
import { tileCost } from '../src/sim/path';
import { fieldsAsleep, firewoodPerPerson, indoorShare } from '../src/sim/weather';
import { agreesTo, fillCouncil } from '../src/sim/traditions';
import { isNotable, shown } from '../src/sim/notable';
import { tellTale } from '../src/sim/tales';
import { TERRAIN } from '../src/sim/types';

/** A settlement left to grow: people come on their own, and every year someone is called with Sparks. */
function run(seed: number, years: number): GameState {
  const s = foundSettlement({ seed, name: 'Testbrook' });
  for (let d = 0; d < years * DAYS_PER_YEAR; d++) {
    stepDay(s);
    if (d % DAYS_PER_YEAR === DAYS_PER_YEAR - 1) { s.sparks += 3; call(s, callOptions(s)[d % 3].id, true); }
  }
  return s;
}

describe('simulation', () => {
  it('is deterministic: the same seed and inputs give the same city', () => {
    const a = run(42, 4);
    const b = run(42, 4);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('founds a settlement of eight around a hearth', () => {
    const s = foundSettlement({ seed: 7, name: 'Ashmere' });
    expect(population(s)).toBe(8);
    expect(s.buildings.some((b) => b.kind === 'hearth')).toBe(true);
    expect(s.chronicle[0].kind).toBe('founding');
  });

  it('keeps families consistent over twenty years', () => {
    const s = run(9, 20);
    expect(population(s)).toBeGreaterThan(20);
    for (const p of s.people) {
      if (p.spouse !== undefined && p.alive) {
        const sp = s.people[p.spouse];
        expect(sp.spouse).toBe(p.id);
        expect(sp.alive).toBe(true);
      }
      if (p.alive && p.away === undefined && p.home !== undefined) {
        expect(s.buildings[p.home].removed).toBeFalsy();
      }
      for (const c of p.children) expect(s.people[c].parents).toContain(p.id);
    }
    // Every finished year has a name.
    for (let y = 1; y < 20; y++) expect(s.yearNames[y]).toBeTruthy();
  });

  it('grows into a village within a reasonable number of focus hours', () => {
    const s = run(12345, 20);
    expect(s.stage).not.toBe('settlement');
  });

  it("darkness changes how deadly life is", () => {
    const deaths = (darkness: number) => {
      const s = foundSettlement({ seed: 3, name: 'X', settings: { darkness, weirdness: 1, awayMinutes: 0, notify: false, dayNight: 'clock', stopAt: null } });
      for (let d = 0; d < 25 * DAYS_PER_YEAR; d++) {
        stepDay(s);
        if (d % 120 === 119) settleParty(s, makeArrivalOptions(s)[0]);
      }
      return s.people.filter((p) => !p.alive && !p.left && ageOf(s, p) < 50).length;
    };
    expect(deaths(0)).toBeLessThan(deaths(100));
  });
});

describe('acts', () => {
  it('spends Sparks and brings a created settler at dawn', () => {
    const s = foundSettlement({ seed: 5, name: 'Y' });
    s.sparks = 3;
    const r = createSettler(s, { first: 'Wren', family: 'Ashford', sex: 'f', orientation: 'straight', age: 30, traits: ['brave', 'kind'], skill: 'healer', dream: 'remembered' });
    expect(r.ok).toBe(true);
    expect(s.sparks).toBe(0);
    expect(s.people.some((p) => p.first === 'Wren')).toBe(false);
    startSession(s, 1_000_000);
    const wren = s.people.find((p) => p.first === 'Wren')!;
    expect(wren.patron).toBe(true);
    expect(wren.home).toBeDefined();
  });

  it('refuses acts the player cannot afford', () => {
    const s = foundSettlement({ seed: 5, name: 'Y' });
    s.sparks = 1;
    const adult = s.people.find((p) => ageOf(s, p) >= 18)!;
    expect(sendOnQuest(s, adult.id, [], 'ruins').ok).toBe(false);
  });

  it('welcomes one party from a group of three', () => {
    const s = foundSettlement({ seed: 5, name: 'Y' });
    s.arrivals.push(makeArrivalOptions(s));
    const before = s.people.length;
    const party = s.arrivals[0][1];
    welcomeParty(s, party.id, true);
    expect(s.arrivals.length).toBe(0);
    expect(s.people.length).toBe(before + party.people.length);
  });
});

describe('focus clock', () => {
  it('turns an hour of work into a year, three Sparks and the daily goal', () => {
    const s = foundSettlement({ seed: 11, name: 'Z' });
    const t0 = new Date(2026, 10, 20, 9, 0).getTime();
    const before = s.sparks;
    startSession(s, t0);
    for (let m = 1; m <= 60; m++) tick(s, t0 + m * 60_000);
    const rec = stopSession(s, t0 + 60 * 60_000)!;
    expect(s.day).toBe(DAYS_PER_YEAR);
    expect(focusDay(s, t0).goalMet).toBe(true);
    // Three Sparks for the hour, three more for the daily goal: kept, to spend.
    expect(rec.sparks).toBe(3 + GOAL_SPARKS);
    expect(s.sparks).toBe(before + 3 + GOAL_SPARKS);
    expect((s as { favor?: number }).favor).toBeUndefined();
  });

  it('does not run the city while paused', () => {
    const s = foundSettlement({ seed: 11, name: 'Z' });
    tick(s, Date.now() + 3_600_000);
    expect(s.day).toBe(0);
  });

  it('when tracking words, Sparks and the daily goal come from words, not time', () => {
    const s = foundSettlement({ seed: 11, name: 'Z', goals: { track: 'words', dailyMinutes: 60, dailyWords: 1000, sparkMinutes: 20, sparkWords: 250 } });
    const t0 = new Date(2026, 10, 20, 9, 0).getTime();
    const before = s.sparks;
    startSession(s, t0);
    for (let m = 1; m <= 60; m++) tick(s, t0 + m * 60_000);
    stopSession(s, t0 + 60 * 60_000);
    expect(s.day).toBe(DAYS_PER_YEAR); // the city still lives while the timer runs
    expect(s.sparks).toBe(before); // but an hour of time alone brings no Sparks
    expect(focusDay(s, t0).goalMet).toBe(false);
    logWords(s, 1100, t0 + 61 * 60_000);
    expect(s.sparks).toBe(before + 4 + GOAL_SPARKS);
    expect(s.focus.sparkWords).toBe(100);
    expect(focusDay(s, t0).goalMet).toBe(true);
  });

  it('when tracking time, logged words are recorded but bring no Sparks', () => {
    const s = foundSettlement({ seed: 11, name: 'Z' });
    const before = s.sparks;
    logWords(s, 600, Date.now());
    expect(s.sparks).toBe(before);
  });

  it('treats a very long gap as an interruption, not work', () => {
    const s = foundSettlement({ seed: 11, name: 'Z' });
    const t0 = Date.now();
    startSession(s, t0);
    let gap = 0;
    tick(s, t0 + 5 * 3_600_000, { gap: (ms) => { gap = ms; } });
    expect(gap).toBeGreaterThan(0);
    expect(s.day).toBe(0);
  });
});

describe('saves', () => {
  it('round-trips through JSON exactly', () => {
    const s = run(77, 3);
    const back = parseSave(JSON.stringify(s));
    expect(JSON.stringify(back)).toEqual(JSON.stringify(s));
  });

  it('rejects files that are not saves', () => {
    expect(() => parseSave('{"hello":1}')).toThrow();
  });
});

import { raiseProphet, whisperLaw, lawCost } from '../src/sim/acts';
import { followers, hasLaw } from '../src/sim/society';
import { ignite, startPlague } from '../src/sim/calamity';
import { offerFortune, takeFortune } from '../src/sim/fortunes';

describe('village life', () => {
  it('someone comes to lead, and leaders make laws', () => {
    const s = run(31, 30);
    expect(s.leader).toBeDefined();
    expect(s.people[s.leader!.person].alive).toBe(true);
    expect(s.chronicle.some((e) => e.kind === 'leader')).toBe(true);
  });

  it('Whisper a Law enacts and repeals, priced by the leader', () => {
    const s = run(31, 12);
    expect(s.leader).toBeDefined();
    s.sparks = 50;
    const id = 'feast-days' as const;
    const had = hasLaw(s, id);
    const cost = lawCost(s, id);
    expect(whisperLaw(s, id).ok).toBe(true);
    expect(hasLaw(s, id)).toBe(!had);
    expect(s.sparks).toBe(50 - cost);
  });

  it('Raise a Prophet founds a faith that spreads and is passed to children', () => {
    const s = run(8, 10);
    s.sparks = 10;
    const prophet = s.people.find((p) => p.alive && p.away === undefined && ageOf(s, p) >= 20 && ageOf(s, p) <= 35 && p.spouse !== undefined)
      ?? s.people.find((p) => p.alive && p.away === undefined && ageOf(s, p) >= 20 && ageOf(s, p) <= 40)!;
    expect(raiseProphet(s, prophet.id, ['hearth', 'feasting']).ok).toBe(true);
    const faith = s.faiths[s.faiths.length - 1];
    expect(prophet.faith).toBe(faith.id);
    for (let d = 0; d < 10 * DAYS_PER_YEAR; d++) stepDay(s);
    expect(followers(s, faith.id)).toBeGreaterThan(1);
    // A baby born to a believer is raised in the faith.
    const mother = s.people.find((p) => p.alive && p.away === undefined && p.sex === 'f' && ageOf(s, p) >= 18 && ageOf(s, p) <= 40)!;
    mother.faith = faith.id;
    mother.pregnant = { due: s.day + 1, father: mother.spouse ?? mother.id };
    const before = s.people.length;
    stepDay(s); stepDay(s);
    const baby = s.people.slice(before).find((p) => p.parents[0] === mother.id);
    expect(baby?.faith).toBe(faith.id);
  });

  it('plague spreads, then burns itself out', () => {
    const s = run(44, 12);
    for (const p of s.people) p.hook = undefined; // no called healer to end it early
    startPlague(s);
    for (let d = 0; d < 150 && (s.plague?.cases ?? 0) < 2; d++) stepDay(s);
    expect(s.plague?.cases ?? 0).toBeGreaterThan(1);
    for (let d = 0; d < 4 * 360 && s.plague; d++) stepDay(s);
    expect(s.plague).toBeUndefined();
  });

  it('fire burns a home out and its family gets a tent', () => {
    const s = run(45, 10);
    const home = s.buildings.find((b) => b.built && !b.removed && ['hut', 'house', 'bighouse'].includes(b.kind) && s.people.some((p) => p.alive && p.home === b.id))!;
    const family = s.people.filter((p) => p.alive && p.home === home.id);
    ignite(s, home, true);
    for (let d = 0; d < 8; d++) stepDay(s);
    expect(home.burned).toBe(true);
    for (const p of family) if (p.alive) expect(p.home).not.toBe(home.id);
  });

  it('reaching the daily goal offers a Fortune, and a master builder finishes everything', () => {
    const s = run(46, 4);
    offerFortune(s);
    const offer = s.fortunes[0];
    offer.options[0] = 'builder';
    const r = takeFortune(s, offer.id, 'builder');
    expect(r.ok).toBe(true);
    stepDay(s);
    expect(s.buildings.filter((b) => !b.built && !b.removed && b.founded < s.day - 1).length).toBe(0);
  });

  it('older saves load with village life added', () => {
    const s = run(47, 2) as unknown as Record<string, unknown>;
    delete s.laws; delete s.faiths; delete s.petitions; delete s.fortunes;
    const back = parseSave(JSON.stringify(s));
    expect(back.laws).toEqual([]);
    expect(back.faiths).toEqual([]);
  });
});

import { chopWood, ensureForest, forestMonth, WOOD_PER_TREE } from '../src/sim/forest';
import { nightAt, stopTimeToday } from '../src/game/sky';
import { makeItem, passHeirlooms } from '../src/sim/items';
import { killPerson } from '../src/sim/life';
import { TREE } from '../src/sim/types';

describe('design notes', () => {
  it('trees are cut down to stumps, and saplings grow back slowly', () => {
    const s = foundSettlement({ seed: 61, name: 'Wood' });
    const before = s.map.trees.filter((t) => t === TREE.BROADLEAF || t === TREE.PINE).length;
    let got = 0;
    for (let i = 0; i < 40; i++) got += chopWood(s, 1.6);
    expect(got).toBeGreaterThan(0);
    // Keep chopping until at least two trees are gone.
    for (let i = 0; i < Math.ceil((WOOD_PER_TREE * 2) / 1.6) + 10; i++) chopWood(s, 1.6);
    expect(s.map.trees.filter((t) => t === TREE.STUMP).length).toBeGreaterThanOrEqual(2);
    expect(s.map.trees.filter((t) => t === TREE.BROADLEAF || t === TREE.PINE).length).toBeLessThan(before);
    const sapling = s.map.trees.findIndex((t, i) => (t === TREE.BROADLEAF || t === TREE.PINE) && s.map.growth[i] < 1);
    if (sapling >= 0) { const g = s.map.growth[sapling]; s.day += 30; forestMonth(s); expect(s.map.growth[sapling]).toBeGreaterThan(g); }
  });

  it('older maps get trees with wood', () => {
    const s = foundSettlement({ seed: 62, name: 'Old' });
    const map = s.map as unknown as Record<string, unknown>;
    delete map.growth; delete map.wood;
    ensureForest(s.map);
    const i = s.map.trees.findIndex((t) => t === TREE.PINE || t === TREE.BROADLEAF);
    expect(s.map.wood[i]).toBe(WOOD_PER_TREE);
    expect(s.map.growth[i]).toBe(1);
  });

  it('day and night follow the hour; the stopping time is today at that hour', () => {
    expect(nightAt(12)).toBe(0);
    expect(nightAt(2)).toBe(1);
    expect(nightAt(20)).toBeGreaterThan(0.5);
    expect(nightAt(6)).toBeGreaterThan(0);
    const s = foundSettlement({ seed: 63, name: 'Clock' });
    expect(stopTimeToday(s, Date.now())).toBeNull();
    s.settings.stopAt = '18:30';
    const t = new Date(stopTimeToday(s, new Date(2026, 10, 20, 9).getTime())!);
    expect([t.getHours(), t.getMinutes(), t.getDate()]).toEqual([18, 30, 20]);
  });

  it('pens get herds, and families get dogs and cats over the years', () => {
    const s = run(64, 25);
    expect(s.buildings.some((b) => b.kind === 'pen' && b.built && (b.herd ?? 0) > 0)).toBe(true);
    expect(s.pets.length).toBeGreaterThan(0);
    expect(s.wild.deer).toBeGreaterThanOrEqual(0);
  });

  it('heirlooms pass to the eldest child, keeping their history', () => {
    const s = run(65, 20);
    const parent = s.people.find((p) => p.alive && p.away === undefined && p.children.some((c) => s.people[c]?.alive && s.people[c].away === undefined && ageOf(s, s.people[c]) >= 12))!;
    const item = makeItem(s, 'blade', parent, 'made');
    s.rng.s = 7; // a roll that doesn't bury it
    let tries = 0;
    while (tries++ < 50) {
      const copy = JSON.parse(JSON.stringify(s));
      const p = copy.people[parent.id];
      killPerson(copy, p, 'old age', 'test');
      const it = copy.items[item.id];
      if (!it.buried) { expect(it.owner).toBeDefined(); expect(it.history.at(-1).how).toBe('inherited'); return; }
      s.rng.s += 1;
    }
    void passHeirlooms;
  });
});

describe('towns and ages', () => {
  it('the map widens around the settlement, keeping everything where it stands', () => {
    const s = run(71, 3);
    const before = s.buildings.filter((b) => !b.removed).map((b) => ({ id: b.id, dx: b.x - s.hearth.x, dy: b.y - s.hearth.y, t: s.map.terrain[b.y * s.map.w + b.x] }));
    const water = s.map.terrain.filter(isWater).length;
    expect(s.map.w).toBe(64);
    s.stage = 'town';
    const d = growMap(s, true);
    expect(d).toBe(32);
    expect(s.map.w).toBe(128);
    for (const b of before) {
      const nb = s.buildings[b.id];
      expect([nb.x - s.hearth.x, nb.y - s.hearth.y]).toEqual([b.dx, b.dy]);
      expect(s.map.terrain[nb.y * s.map.w + nb.x]).toBe(b.t);
      expect(s.map.occ[nb.y * s.map.w + nb.x]).toBe(nb.id + 1);
    }
    // The river runs on beyond the old edge.
    expect(s.map.terrain.filter(isWater).length).toBeGreaterThan(water * 1.5);
    // The same seed's world: a second settlement widened the same way matches.
    const t = run(71, 3);
    t.stage = 'town';
    growMap(t, true);
    expect(t.map.terrain).toEqual(s.map.terrain);
  });

  it('older maps carry their own river on past the old edge', () => {
    const s = run(72, 1);
    delete s.map.gen; // as if made before maps were cut from a world
    const edgeWater = (m: GameState['map']) => {
      let n = 0;
      for (let k = 0; k < m.w; k++) for (const i of [k, (m.h - 1) * m.w + k, k * m.w, k * m.w + m.w - 1]) if (isWater(m.terrain[i])) n++;
      return n;
    };
    expect(edgeWater(s.map)).toBeGreaterThan(0);
    expandMap(s, 128);
    expect(s.map.gen).toBeUndefined();
    expect(edgeWater(s.map)).toBeGreaterThan(0);
  });

  it('people make discoveries; a great one starts an age and later a new era', () => {
    const s = run(73, 30);
    expect(s.lore.known.length).toBeGreaterThan(0);
    for (const k of s.lore.known) {
      expect(discovery(k.id)).toBeDefined();
      expect(s.chronicle.some((e) => e.kind === 'discovery' && e.day === k.day)).toBe(true);
    }
    expect(boost(s, 'food')).toBeGreaterThanOrEqual(1);
    // Iron opens the next era.
    const ages = s.ages.length;
    s.flags.ceremony = undefined;
    discover(s, discovery('iron')!, s.people.find((p) => p.alive && p.job === 'smith'));
    expect(s.age.name).toBe('The Age of Iron');
    expect(s.age.era).toBe('iron');
    expect(s.ages.length).toBe(ages + 1);
    expect((s.flags.ceremony as { kind: string } | undefined)?.kind).toBe('age');
    // Buildings finished from now on are built in the new way.
    const b = addBuilding(s, 'well', 1, 1, { built: true });
    expect(b.era).toBe('iron');
  });

  it('discoveries come at random intervals: sometimes close together, sometimes far apart', () => {
    const s = foundSettlement({ seed: 78, name: 'Testbrook' });
    const draws = Array.from({ length: 2000 }, () => drawDifficulty(s));
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    expect(mean).toBeGreaterThan(0.85);
    expect(mean).toBeLessThan(1.15);
    expect(draws.filter((d) => d < 0.3).length).toBeGreaterThan(100); // a flurry
    expect(draws.filter((d) => d > 2.5).length).toBeGreaterThan(50); // a long drought
    // Over two centuries of a settlement's learning, the gaps between discoveries differ.
    const r = foundSettlement({ seed: 79, name: 'Testbrook' });
    for (let d = 0; d < 200 * DAYS_PER_YEAR; d++) { r.day = d; loreDay(r); }
    const days = r.lore.known.map((k) => k.day);
    const gaps = days.slice(1).map((d, i) => d - days[i]);
    expect(gaps.length).toBeGreaterThan(5);
    expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps) * 3);
  });

  it('side ages only come when the sliders allow, and pass', () => {
    const s = run(74, 9);
    s.settings.darkness = 0;
    expect(beginSideAge(s, 'plague')).toBe(false);
    s.settings.darkness = 100;
    const was = s.age.name;
    expect(beginSideAge(s, 'plague')).toBe(true);
    expect(s.age.name).toBe('The Age of Plague');
    s.day = s.age.until!;
    agesYear(s);
    expect(s.age.name).toBe(was);
    expect(s.age.side).toBe(false);
  });

  it('Inspire makes the next discovery come from that person', () => {
    const s = run(75, 6);
    const potter = s.people.find((p) => p.alive && p.away === undefined && ageOf(s, p) >= 16)!;
    potter.job = 'potter';
    // Everything else in the Bronze era is already known.
    s.lore.known = DISCOVERIES.filter((d) => d.era === 0 && d.id !== 'potters-wheel').map((d) => ({ id: d.id, day: 0 }));
    s.lore.last = -999;
    s.sparks = 10;
    expect(inspire(s, potter.id).ok).toBe(true);
    expect(s.sparks).toBe(10 - actCost('inspire'));
    s.lore.points = discoveryThreshold(s);
    loreDay(s);
    const last = s.lore.known.at(-1)!;
    expect(last.id).toBe('potters-wheel');
    expect(last.by).toBe(potter.id);
  });

  it('a town raises a wall with gates, and a bridge opens the far bank', () => {
    const s = run(76, 14);
    s.stage = 'town';
    growMap(s, true);
    planWalls(s, 'palisade');
    expect(s.walls).toBeDefined();
    const line = s.map.walls!;
    expect(line.some((v) => v === 1)).toBe(true);
    expect(line.some((v) => v === 2)).toBe(true);
    // Nothing is built on the line of the wall.
    const site = findSite(s, 'house');
    if (site) expect(line[site.y * s.map.w + site.x]).toBe(0);
    // Once it's up, it blocks the way, except at the gates.
    progressWalls(s, 1e9);
    s.stores.wood = 1e6;
    progressWalls(s, 1e9);
    expect(s.walls!.built).toBe(true);
    const wallAt = line.indexOf(1);
    const gateAt = line.indexOf(2);
    expect(tileCost(s.map, s.buildings, wallAt)).toBe(Infinity);
    if (s.map.terrain[gateAt] !== TERRAIN.WATER && s.map.terrain[gateAt] !== TERRAIN.DEEP && !s.map.occ[gateAt]) {
      expect(tileCost(s.map, s.buildings, gateAt)).toBeLessThan(Infinity);
    }
    // A bridge.
    const regionBefore = settlementRegion(s).reduce((a, v) => a + v, 0);
    if (planBridge(s)) {
      const bridge = s.buildings.find((b) => b.kind === 'bridge')!;
      bridge.progress = bridge.required - 0.5;
      s.stores.wood = 1e6;
      s.walls = undefined;
      // (The builders may finish whatever else they have started first.)
      for (let i = 0; i < 120 && !bridge.built; i++) stepDay(s);
      expect(bridge.built).toBe(true);
      expect(s.map.terrain[bridge.y * s.map.w + bridge.x]).toBe(TERRAIN.BRIDGE);
      expect(settlementRegion(s).reduce((a, v) => a + v, 0)).toBeGreaterThan(regionBefore);
    }
  });

  it('the town charter grants arms, and saves from before towns load', () => {
    const s = run(77, 2);
    grantCharter(s);
    expect(s.arms).toBeDefined();
    expect(describeArms(s.arms!)).toMatch(/ on /);
    expect(s.flags.ceremony?.kind).toBe('charter');
    const old = JSON.parse(JSON.stringify(s));
    delete old.ages; delete old.lore; delete old.guilds; delete old.nextId.guild;
    old.day = 20 * DAYS_PER_YEAR;
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded.ages.length).toBe(1);
    expect(loaded.lore.points).toBeGreaterThan(0);
    expect(loaded.guilds).toEqual([]);
  });
});

describe('arrivals, calling and sacred places', () => {
  it('people come on their own to a settlement doing well, and few come in hard times', () => {
    const s = run(81, 6);
    const before = s.people.length;
    for (let i = 0; i < 16; i++) arrivalsSeason(s);
    const came = s.people.length - before;
    expect(came).toBeGreaterThan(3);
    // Starving and sick: almost nobody wants to come.
    const t = run(81, 6);
    t.stores.food = 0;
    t.flags.hungerSince = t.day;
    t.stage = 'village';
    expect(draws(t).perYear).toBeLessThan(draws(s).perYear / 2);
  });

  it('they come for the work there is: a kiln draws potters', () => {
    const s = run(82, 8);
    if (!s.buildings.some((b) => b.kind === 'kiln' && b.built && !b.removed)) addBuilding(s, 'kiln', 2, 2, { built: true });
    expect(draws(s).reasons.some((r) => r.job === 'potter')).toBe(true);
  });

  it('Sparks call one of three different people, whose stories come back', () => {
    const s = run(83, 4);
    const options = callOptions(s);
    expect(options.length).toBe(3);
    expect(new Set(options.map((o) => o.call)).size).toBe(3);
    expect(callOptions(s)).toBe(options); // the same three until one is called
    s.sparks = 2;
    expect(call(s, options[0].id, true).ok).toBe(false);
    s.sparks = 5;
    const before = s.people.length;
    expect(call(s, options[0].id, true).ok).toBe(true);
    expect(s.sparks).toBe(2);
    expect(s.people.length).toBeGreaterThan(before);
    const holder = s.people.slice(before).find((p) => p.hook);
    expect(holder?.hook?.id).toBe(options[0].call);
    // Called again: never the same story twice in a row.
    expect(callOptions(s).some((o) => o.call === options[0].call)).toBe(false);
    // Years later, the story comes back in the Chronicle.
    const entries = s.chronicle.length;
    s.day = holder!.hook!.due + 1;
    for (let i = 0; i < 80 && holder!.hook; i++) { hooksYear(s); s.day += DAYS_PER_YEAR; }
    expect(s.chronicle.length).toBeGreaterThan(entries);
  });

  it('someone ranging out finds a sacred place, which grows holy over the years', () => {
    const s = run(84, 8);
    const site = findPlace(s);
    expect(site).not.toBeNull();
    expect(site!.name).toMatch(/^[A-Za-z]/);
    expect(s.chronicle.at(-1)!.text).toContain(site!.name!);
    for (let i = 0; i < 60; i++) { placesYear(s); s.day += DAYS_PER_YEAR; }
    expect(sitesOf(s).some((b) => (b.sacred ?? 0) >= 70)).toBe(true);
  });

  it('older saves lose the Old Stone and petitions', () => {
    const s = run(85, 2) as unknown as GameState & { petitions?: unknown[] };
    const stone = addBuilding(s, 'stone', s.hearth.x + 1, s.hearth.y - 1, { built: true });
    s.petitions = [];
    const back = parseSave(JSON.stringify(s)) as GameState & { petitions?: unknown[] };
    expect(back.petitions).toBeUndefined();
    expect(back.buildings[stone.id].removed).toBe(true);
    expect(back.map.occ[stone.y * back.map.w + stone.x]).toBe(0);
    expect(back.sparks).toBe(s.sparks);
  });
});

describe('weather, traditions, the Chronicle and tales', () => {
  it('temperature follows the seasons; snow lies only when it is cold; the cold burns more wood', () => {
    const s = foundSettlement({ seed: 91, name: 'Coldwater' });
    const temps: number[][] = [[], [], [], []];
    let snowInSummer = 0, frozen = 0;
    for (let d = 0; d < 3 * DAYS_PER_YEAR; d++) {
      stepDay(s);
      const season = Math.floor(((s.day - 1) % DAYS_PER_YEAR) / 90);
      temps[season].push(s.weather!.temp);
      if (season === 1 && s.weather!.snow > 0.4) snowInSummer++;
      if (s.weather!.ice) frozen++;
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(temps[1])).toBeGreaterThan(mean(temps[0]));
    expect(mean(temps[3])).toBeLessThan(mean(temps[2]));
    expect(mean(temps[3])).toBeLessThan(3);
    expect(snowInSummer).toBe(0);
    expect(frozen).toBeGreaterThan(0);
    s.weather!.temp = -8;
    const cold = firewoodPerPerson(s);
    s.weather!.temp = 20;
    expect(cold).toBeGreaterThan(firewoodPerPerson(s) * 4);
  });

  it('nobody farms in winter: farmers hunt instead, and people keep indoors in the cold', () => {
    const s = run(92, 3);
    s.weather!.temp = -5;
    s.day = 3 * DAYS_PER_YEAR + 300; // deep winter
    expect(fieldsAsleep(s)).toBe(true);
    expect(indoorShare(s)).toBeGreaterThan(0.5);
    s.weather!.temp = 22;
    s.weather!.sky = 'clear';
    expect(indoorShare(s)).toBe(0);
  });

  it('the first death decides how the village treats its dead, and the place for it', () => {
    const customs = new Set<string>();
    for (const seed of [93, 94, 95, 96, 97, 98]) {
      const s = run(seed, 6);
      const p = s.people.find((x) => x.alive && x.away === undefined)!;
      if (!s.traditions.dead) killPerson(s, p, 'old age', 'test');
      const custom = s.traditions.dead!.custom;
      customs.add(custom);
      const kinds: Record<string, string> = { burial: 'graveyard', cremation: 'pyre', sky: 'skyplatform', tomb: 'tomb', river: 'landing' };
      expect(s.buildings.some((b) => b.kind === kinds[custom] && !b.removed)).toBe(true);
    }
    expect(customs.size).toBeGreaterThan(1);
  });

  it('a village decides how to govern itself; a council or assembly must agree to laws', () => {
    const s = run(99, 14);
    expect(s.stage).not.toBe('settlement');
    expect(s.traditions.rule).toBeDefined();
    s.traditions.rule = { form: 'council', since: s.day };
    fillCouncil(s);
    expect(s.council!.length).toBeGreaterThanOrEqual(1);
    expect(agreesTo(s, () => -1)).toBe(false);
    expect(agreesTo(s, () => 1)).toBe(true);
  });

  it('as a place grows, the Chronicle keeps to notable people and bigger events, and the player can choose', () => {
    const s = run(100, 4);
    const nobody = s.people.find((p) => p.alive && !p.followed && !isNotable(s, p.id))!;
    const small = { id: 1, day: s.day, kind: 'courtship' as const, text: 'x', people: [nobody.id], weight: 1 };
    expect(shown(s, small)).toBe(true); // a settlement: everything
    s.stage = 'town';
    expect(shown(s, small)).toBe(false);
    nobody.followed = true;
    expect(shown(s, small)).toBe(true); // unless you follow them
    expect(shown(s, small, { focus: 'auto', hide: ['love'] })).toBe(false);
    expect(shown(s, small, { focus: 'everyone', hide: [] })).toBe(true);
  });

  it('tales remember: a quarrel leaves a grudge with its reason, and later ones call back to it', () => {
    const s = run(101, 8);
    const from = s.chronicle.length;
    for (let i = 0; i < 300; i++) { tellTale(s); if (i % 3 === 0) s.day++; }
    const grudges = Object.values(s.bonds ?? {}).filter((b) => b.v < -10 && b.why);
    expect(grudges.length).toBeGreaterThan(0);
    const texts = s.chronicle.slice(from).filter((e) => e.kind === 'season').map((e) => e.text);
    expect(texts.length).toBeGreaterThan(50);
    expect(new Set(texts).size).toBe(texts.length); // no tale told word for word twice
    expect(texts.some((t) => / again/.test(t) || /since the business with/.test(t))).toBe(true);
  });
});

describe('culture, and walking', () => {
  it('founders bring their homeland\'s ways, and newcomers bring theirs', () => {
    const s = foundSettlement({ seed: 3, name: 'Testbrook' });
    const home = s.culture!.lands[s.culture!.home!];
    expect(home.customs.length).toBeGreaterThanOrEqual(2);
    expect(s.culture!.kept.map((k) => k.id).sort()).toEqual([...home.customs].sort());
    expect(s.people.every((p) => p.land === home.id)).toBe(true);
    const party = makeArrivalOptions(s)[0];
    expect(party.land).toBeDefined();
    expect(party.people.every((d) => d.land === party.land)).toBe(true);
  });

  it('ways spread, take root, and children grow up in them', () => {
    const s = run(3, 30);
    const c = s.culture!;
    expect(c.lands.length).toBeGreaterThan(3);
    // Something from a later homeland has become the town's own.
    expect(c.kept.some((k) => k.land !== c.home)).toBe(true);
    const kid = s.people.find((p) => p.alive && p.origin === 'born' && ageOf(s, p) >= 8);
    expect(kid?.customs?.length).toBeGreaterThan(0);
    // A town keeps only a few of each kind.
    const kinds = new Map<string, number>();
    for (const k of c.kept) { const kind = CUSTOM_BY_ID.get(k.id)!.kind; kinds.set(kind, (kinds.get(kind) ?? 0) + 1); }
    for (const n of kinds.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it('a Spark encourages a way, or discourages it', () => {
    const s = run(17, 6);
    const ways = waysHere(s);
    const id = ways[ways.length - 1].id;
    s.sparks = 1;
    expect(nudgeWay(s, id, true).ok).toBe(true);
    expect(s.sparks).toBe(0);
    expect(s.culture!.nudge).toMatchObject({ id, up: true });
    expect(nudgeWay(s, id, false).ok).toBe(false); // no Sparks left
  });

  it('older saves get a homeland and ways of their own', () => {
    const s = run(85, 2);
    delete s.culture;
    for (const p of s.people) { delete p.land; delete p.customs; }
    const back = parseSave(JSON.stringify(s));
    expect(back.culture!.kept.length).toBeGreaterThan(0);
    expect(back.people.every((p) => p.customs !== undefined)).toBe(true);
  });

  it('people face the way they walk: back going up the screen, front coming down', () => {
    expect(dirOf(-1, 0, 'down')).toBe('up'); // up and to the left on screen
    expect(dirOf(0, -1, 'down')).toBe('up'); // up and to the right
    expect(dirOf(1, 0, 'up')).toBe('right'); // down and to the right
    expect(dirOf(0, 1, 'up')).toBe('left'); // down and to the left
    expect(dirOf(1, 1, 'up')).toBe('down'); // straight down the screen
  });
});
