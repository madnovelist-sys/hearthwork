// Headless run for tuning: simulate N focus hours with a Spark every 20
// minutes (spending every three on calling someone) and print a census per year.
// Everyone else who arrives comes on their own.
//   npm run simulate -- [hours] [seed] [darkness]
import { call, callOptions } from '../src/sim/callers';
import { foundSettlement, stepDay } from '../src/sim/sim';
import { DAYS_PER_YEAR } from '../src/sim/types';
import { population } from '../src/sim/world';
import { resolveText } from '../src/sim/text';

const hours = Number(process.argv[2] ?? 40);
const seed = Number(process.argv[3] ?? 12345);
const darkness = Number(process.argv[4] ?? 50);
const s = foundSettlement({ seed, name: 'Testbrook', settings: { darkness, weirdness: 1, awayMinutes: 0, notify: false, dayNight: 'clock', stopAt: null } });
const daysPerSpark = (20 / 60) * DAYS_PER_YEAR;
let nextSpark = daysPerSpark;
const t0 = Date.now();
for (let day = 0; day < hours * DAYS_PER_YEAR; day++) {
  stepDay(s);
  if (s.day >= nextSpark) {
    nextSpark += daysPerSpark;
    s.sparks += 1;
    if (s.sparks >= 3) call(s, callOptions(s)[day % 3].id, true);
  }
  if (s.day % DAYS_PER_YEAR === 0) {
    const year = s.day / DAYS_PER_YEAR;
    const alive = s.people.filter((p) => p.alive);
    const buildings = s.buildings.filter((b) => !b.removed);
    const homes = buildings.filter((b) => ['tent', 'hut', 'house'].includes(b.kind) && b.built).length;
    if (year % 5 === 0 || year <= 3) {
      console.log(
        `Y${String(year).padStart(3)} pop ${String(population(s)).padStart(4)} (alive ${alive.length}) ` +
        `food ${Math.round(s.stores.food)} wood ${Math.round(s.stores.wood)} goods ${Math.round(s.stores.goods)} ` +
        `homes ${homes} bld ${buildings.length} stage ${s.stage} map ${s.map.w} | ${s.age.name} (${s.lore.known.length} disc, ${Math.round(s.lore.points)}pts) | ${s.yearNames[year]}`,
      );
    }
  }
}
console.log('\nAges:', s.ages.map((a) => `Y${Math.floor(a.from / DAYS_PER_YEAR) + 1} ${a.name}`).join(' → '));
console.log('Discoveries:', s.lore.known.map((k) => `Y${Math.floor(k.day / DAYS_PER_YEAR) + 1} ${k.id}`).join(', '));
console.log('Traditions:', JSON.stringify(s.traditions), 'council', (s.council ?? []).length, 'leader', s.leader && s.people[s.leader.person].first);
console.log('Guilds:', s.guilds.map((g) => g.name).join(', '), '| walls', s.walls ? `${s.walls.kind} r${s.walls.r.toFixed(1)} built ${s.walls.built}` : 'none');
const kindsBuilt: Record<string, number> = {};
for (const b of s.buildings) if (!b.removed) kindsBuilt[b.kind] = (kindsBuilt[b.kind] ?? 0) + 1;
console.log('Buildings:', JSON.stringify(kindsBuilt));
const deaths = s.people.filter((p) => !p.alive);
const causes: Record<string, number> = {};
for (const p of deaths) causes[p.cause ?? '?'] = (causes[p.cause ?? '?'] ?? 0) + 1;
console.log('\nDeaths by cause', causes);
const kinds: Record<string, number> = {};
for (const e of s.chronicle) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
console.log('Chronicle entries', kinds);
console.log(`Simulated ${hours} years in ${Date.now() - t0} ms`);
console.log('\nSample of the Chronicle:');
for (const e of s.chronicle.filter((e) => e.weight >= 5).slice(0, 25)) {
  console.log(`  [Y${Math.floor(e.day / DAYS_PER_YEAR) + 1}] (${e.kind}) ${resolveText(s, e.text)}`);
}
