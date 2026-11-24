import { describe, expect, it } from 'vitest';
import { makeArrivalOptions } from '../src/sim/arrivals';
import { foundSettlement, stepDay } from '../src/sim/sim';
import { DAYS_PER_YEAR } from '../src/sim/types';
import { ageOf } from '../src/sim/world';
import { parseSave } from '../src/game/save';
import { actCost } from '../src/sim/acts';
import { CUSTOM_BY_ID, nudgeWay, waysHere } from '../src/sim/culture';
import { dirOf, facesUs, handsOf } from '../src/render/citizens';
import { looksWet } from '../src/sim/shore';
import { harvestOf } from '../src/render/harvest';
import { addBuilding } from '../src/sim/planner';
import { fieldsAsleep, firewoodPerPerson, indoorShare } from '../src/sim/weather';
import { agreesTo, fillCouncil } from '../src/sim/traditions';
import { isNotable, shown } from '../src/sim/notable';
import { tellTale } from '../src/sim/tales';
import { killPerson } from '../src/sim/life';
import { run } from './helpers';

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

  it('people face the way they walk, eight ways round', () => {
    // Along the streets (the tile edges), the three-quarter views.
    expect(dirOf(-1, 0, 's')).toBe('nw'); // up and to the left on screen
    expect(dirOf(0, -1, 's')).toBe('ne'); // up and to the right
    expect(dirOf(1, 0, 'n')).toBe('se'); // down and to the right
    expect(dirOf(0, 1, 'n')).toBe('sw'); // down and to the left
    // Straight down, up and across the screen: front, back and side.
    expect(dirOf(1, 1, 'n')).toBe('s');
    expect(dirOf(-1, -1, 's')).toBe('n');
    expect(dirOf(1, -1, 's')).toBe('e');
    expect(dirOf(-1, 1, 's')).toBe('w');
    // A little either side of a street keeps the same view (no flicker).
    expect(dirOf(1, 0.12, 'se')).toBe('se');
    expect(dirOf(1, -0.12, 'se')).toBe('se');
    // Standing still keeps the way they last faced.
    expect(dirOf(0, 0, 'w')).toBe('w');
  });

  it('what people carry is held in front of them, and goes down to the ground when they bend', () => {
    for (const role of ['farmer', 'farmer-woman', 'crafter', 'crafter-man', 'child', 'girl', 'elder', 'elder-woman', 'leader', 'leader-man', 'merchant', 'merchant-woman', 'priest'] as const) {
      // Facing left is facing right mirrored.
      for (const [r, l] of [['se', 'sw'], ['e', 'w'], ['ne', 'nw']] as const) {
        expect(handsOf(role, l).x).toBeCloseTo(-handsOf(role, r).x);
        expect(handsOf(role, l).y).toBeCloseTo(handsOf(role, r).y);
      }
      // Out in front of them going across, and at chest or belt height.
      expect(handsOf(role, 'e').x).toBeGreaterThan(5);
      expect(handsOf(role, 'w').x).toBeLessThan(-5);
      expect(handsOf(role, 's').y).toBeLessThan(-20);
      expect(handsOf(role, 's').y).toBeGreaterThan(-45);
      // Bending: the hands reach down to the ground (feet are at 0).
      expect(handsOf(role, 'se', 1).y).toBeGreaterThan(-6);
      expect(handsOf(role, 'se', 0.5).y).toBeGreaterThan(handsOf(role, 'se', 0).y);
    }
    // Facing away, what they hold is hidden behind them; facing us, it's in front.
    expect(facesUs('s') && facesUs('se') && facesUs('w')).toBe(true);
    expect(facesUs('n') || facesUs('ne') || facesUs('nw')).toBe(false);
  });
});

describe('the land as drawn', () => {
  it('nothing is built where the river\'s painted edge covers the land', () => {
    const s = run(17, 12);
    const wet = looksWet(s.map);
    for (const b of s.buildings) {
      if (b.removed || b.kind === 'dock' || b.kind === 'bridge') continue;
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) expect(wet[y * s.map.w + x]).toBe(0);
    }
  });

  it('a field is cut through the autumn, a strip at a time', () => {
    const s = foundSettlement({ seed: 3, name: 'T' });
    const field = addBuilding(s, 'field', s.hearth.x + 6, s.hearth.y + 6, { built: true });
    let last = 0;
    const seen = new Set<number>();
    for (let day = 180; day < 270; day++) {
      s.day = day;
      const cut = harvestOf(s, field);
      expect(cut).toBeGreaterThanOrEqual(last);
      last = cut;
      seen.add(cut === 0 ? 0 : cut === 1 ? 1 : 0.5);
    }
    expect([...seen].sort()).toEqual([0, 0.5, 1]);
    s.day = 100; // summer: still standing
    expect(harvestOf(s, field)).toBe(0);
  });

  it('naming costs nothing', () => {
    expect(actCost('name')).toBe(0);
  });
});
