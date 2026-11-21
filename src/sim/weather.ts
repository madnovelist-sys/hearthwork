// Weather. Every day has a temperature (following the seasons, with warm
// spells, cold snaps and heat waves) and weather: clear, rain, storms, fog or
// snow. Snow lies and melts; the river can freeze; dry summers parch the
// fields and make fires likelier. People stay in when it's cold or wet, burn
// more firewood the colder it gets, and fall ill more in the cold.
// Temperatures are kept in degrees Celsius; the interface can show Fahrenheit.
import { log } from './chronicle';
import { chance, rand, range } from './rng';
import { DAYS_PER_YEAR, type GameState, type Sky, type Weather } from './types';

export type { Sky, Weather } from './types';

/** The usual temperature on a day of the year: about 21 °C at midsummer, -2 °C at midwinter. */
export function usualTemp(day: number): number {
  const d = day % DAYS_PER_YEAR;
  return 9.5 + 11.5 * Math.cos((2 * Math.PI * (d - 135)) / DAYS_PER_YEAR);
}

export function newWeather(s: GameState): Weather {
  const offset = ((s.seed % 7) - 3) * 0.6;
  return { temp: usualTemp(s.day) + offset, anomaly: 0, sky: 'clear', snow: 0, ice: false, dry: 0, offset, recent: [] };
}

const season = (day: number) => Math.floor((day % DAYS_PER_YEAR) / 90);

/** Each morning: the day's weather. */
export function weatherDay(s: GameState) {
  const w = (s.weather ??= newWeather(s));
  const r = s.rng;
  const se = season(s.day);
  // Temperature: the usual for the day, a slowly wandering difference, and the odd spell.
  w.anomaly = w.anomaly * 0.82 + range(r, -1, 1) * 2.4;
  if (w.spell && s.day >= w.spell.until) w.spell = undefined;
  if (!w.spell) {
    if (se === 3 && chance(r, 0.012)) startSpell(s, w, -range(r, 6, 11), 5 + Math.floor(rand(r) * 9));
    else if (se === 1 && chance(r, 0.01)) startSpell(s, w, range(r, 5, 8), 6 + Math.floor(rand(r) * 10));
    else if (se === 0 && s.day % DAYS_PER_YEAR > 25 && chance(r, 0.004)) startSpell(s, w, -range(r, 7, 10), 2 + Math.floor(rand(r) * 3));
  }
  w.temp = Math.round((usualTemp(s.day) + w.offset + w.anomaly + (w.spell?.delta ?? 0)) * 10) / 10;
  w.recent = [...w.recent.slice(-6), w.temp];

  // Rain and snow come in spells too.
  const wetChance = [0.32, 0.22, 0.38, 0.32][se];
  const wasWet = w.sky === 'rain' || w.sky === 'storm' || w.sky === 'snow';
  const wet = chance(r, wasWet ? 0.55 : wetChance * (w.spell && w.spell.delta > 0 ? 0.4 : 1));
  if (wet) {
    if (w.temp <= 0.5) w.sky = 'snow';
    else w.sky = se === 1 && chance(r, 0.18) ? 'storm' : 'rain';
  } else if ((se === 0 || se === 2) && w.temp < 12 && chance(r, 0.12)) w.sky = 'fog';
  else w.sky = chance(r, 0.35) ? 'cloudy' : 'clear';

  // Snow lies while it's cold, and melts when it warms.
  if (w.sky === 'snow') w.snow = Math.min(12, w.snow + range(r, 0.6, 2.2));
  if (w.temp > 1.5) w.snow = Math.max(0, w.snow - (w.temp - 1) * 0.35 - (w.sky === 'rain' ? 0.8 : 0));

  // The river freezes after a cold week, and thaws again.
  const week = w.recent.reduce((a, b) => a + b, 0) / Math.max(1, w.recent.length);
  const wasIce = w.ice;
  w.ice = wasIce ? week < 1 : week < -3;
  if (!wasIce && w.ice && chance(r, 0.4)) log(s, 'season', `The river froze over, hard enough that children slid across it to the far bank and back.`, [], 2);

  // Dry spells in the growing season.
  if (w.sky === 'rain' || w.sky === 'storm') w.dry = 0;
  else if (se === 0 || se === 1) w.dry++;
  if (w.dry === 30 && se === 1) log(s, 'harvest', `A month without rain. The barley stood thin and yellow in the fields, and the river shrank from its banks.`, [], 4, 'The Dry Year');

  // A late frost kills the young crops.
  if (se === 0 && w.temp < 0 && s.day % DAYS_PER_YEAR > 30 && !s.flags.frostThisYear) {
    s.flags.frostThisYear = true;
    s.flags.harvestHurt = (s.flags.harvestHurt ?? 0) + 0.15;
    log(s, 'harvest', `A hard frost came late in the spring and blackened the young barley overnight.`, [], 4, 'The Year of the Late Frost');
  }
  if (s.day % DAYS_PER_YEAR === 0) { s.flags.frostThisYear = false; s.flags.harvestHurt = 0; }
}

function startSpell(s: GameState, w: Weather, delta: number, days: number) {
  w.spell = { delta, until: s.day + days };
  // Told once a season, however many spells it has.
  const seasonNo = Math.floor(s.day / 90);
  if (s.flags.spellSeason === seasonNo) return;
  s.flags.spellSeason = seasonNo;
  if (delta < -8 && season(s.day) === 3) {
    log(s, 'season', `A bitter cold came down from the hills and stayed. Wells froze, and nobody went farther than the woodpile.`, [], 4, 'The Year of the Great Frost');
  } else if (delta > 6) {
    log(s, 'season', `A heat came over the valley that didn't break for days. People slept outside, and the old ones stayed in the shade.`, [], 3);
  }
}

/** Today's temperature in °C (the usual for the day if the weather hasn't been worked out yet). */
export const temperature = (s: GameState) => s.weather?.temp ?? usualTemp(s.day);

/** Snow lies thick enough to show. */
export const snowOnGround = (s: GameState) => (s.weather ? s.weather.snow > 0.4 : season(s.day) === 3);

/**
 * How much people keep indoors, 0..1: nearly nobody on a warm day, most people in the cold or rain.
 * Those who must work outside still go.
 */
export function indoorShare(s: GameState): number {
  const t = temperature(s);
  let share = Math.min(0.85, Math.max(0, (8 - t) / 14));
  const sky = s.weather?.sky;
  if (sky === 'rain') share = Math.max(share, 0.45);
  if (sky === 'storm') share = Math.max(share, 0.8);
  if (sky === 'snow') share = Math.max(share, 0.65);
  return share;
}

/** Firewood a person burns in a day: a little for cooking, much more the colder it is. */
export function firewoodPerPerson(s: GameState): number {
  return 0.003 + Math.max(0, 14 - temperature(s)) * 0.0018;
}

/** Fields only grow in the warm months; nobody works them in winter. */
export const fieldsAsleep = (s: GameState) => season(s.day) === 3 || temperature(s) < 3;

/** For the HUD: "12 °C" or "54 °F". */
export function formatTemp(c: number, units: 'c' | 'f'): string {
  return units === 'f' ? `${Math.round(c * 9 / 5 + 32)}°F` : `${Math.round(c)}°C`;
}

export const SKY_LABEL: Record<Sky, string> = { clear: 'clear', cloudy: 'cloudy', rain: 'rain', storm: 'storms', snow: 'snow', fog: 'fog' };
