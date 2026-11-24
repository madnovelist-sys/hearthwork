import { describe, expect, it } from 'vitest';
import { arrivalsSeason, draws } from '../src/sim/arrivals';
import { call, callOptions, hooksYear } from '../src/sim/callers';
import { findPlace, placesYear, sitesOf } from '../src/sim/places';
import { foundSettlement, stepDay } from '../src/sim/sim';
import { DAYS_PER_YEAR, type GameState, TERRAIN } from '../src/sim/types';
import { ageOf } from '../src/sim/world';
import { parseSave } from '../src/game/save';
import { expandMap, growMap, isWater } from '../src/sim/mapgen';
import { DISCOVERIES, agesYear, beginSideAge, boost, discover, discovery, discoveryThreshold, drawDifficulty, loreDay } from '../src/sim/ages';
import { actCost, inspire } from '../src/sim/acts';
import { addBuilding, findSite, repairOcc, settlementRegion } from '../src/sim/planner';
import { describeArms, grantCharter, planBridge, planWalls, progressWalls } from '../src/sim/town';
import { tileCost } from '../src/sim/path';
import { run } from './helpers';

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

describe('the ground under buildings', () => {
  it('a building rebuilt in a new style holds its ground, and older saves are put right', () => {
    const s = run(17, 12);
    const old = s.buildings.find((b) => b.kind === 'house' && b.built && !b.removed)!;
    expect(old).toBeTruthy();
    // How older versions left a house rebuilt as a house: the old one gone, but still on the map.
    const rebuilt = addBuilding(s, 'house', old.x, old.y, { replaces: old.id });
    rebuilt.built = true;
    old.removed = true;
    const at = old.y * s.map.w + old.x;
    expect(s.map.occ[at]).toBe(old.id + 1);
    expect(tileCost(s.map, s.buildings, at)).toBeLessThan(Infinity); // people would walk through it
    repairOcc(s);
    expect(s.map.occ[at]).toBe(rebuilt.id + 1);
    expect(tileCost(s.map, s.buildings, at)).toBe(Infinity);
    // And every standing building holds all of its ground.
    for (const b of s.buildings) {
      if (b.removed || (!b.built && b.replaces !== undefined)) continue;
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) expect(s.buildings[s.map.occ[y * s.map.w + x] - 1]?.id).toBe(b.id);
    }
  });
});
