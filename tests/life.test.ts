import { describe, expect, it } from 'vitest';
import { foundSettlement, stepDay } from '../src/sim/sim';
import { DAYS_PER_YEAR, TREE } from '../src/sim/types';
import { ageOf } from '../src/sim/world';
import { parseSave } from '../src/game/save';
import { raiseProphet, whisperLaw, lawCost } from '../src/sim/acts';
import { followers, hasLaw } from '../src/sim/society';
import { ignite, startPlague } from '../src/sim/calamity';
import { offerFortune, takeFortune } from '../src/sim/fortunes';
import { chopWood, ensureForest, forestMonth, WOOD_PER_TREE } from '../src/sim/forest';
import { nightAt, stopTimeToday } from '../src/game/sky';
import { makeItem, passHeirlooms } from '../src/sim/items';
import { killPerson } from '../src/sim/life';
import { run } from './helpers';

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
