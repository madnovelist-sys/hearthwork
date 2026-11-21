// The focus clock: the city only lives while a session is running.
// Time is counted from timestamps, so it stays right even when the app is
// minimized or the browser throttles timers; the simulation catches up.
import { applyDawn } from '../sim/acts';
import { offerFortune } from '../sim/fortunes';
import { stepDay } from '../sim/sim';
import { FOCUS_MS_PER_DAY, type FocusDay, type GameState, type SessionRecord } from '../sim/types';

/** A gap this long between ticks means the computer slept or the app was closed. */
export const GAP_LIMIT_MS = 90 * 60_000;
/** At most this many waiting arrival groups; older ones settle on their own. */

export interface ClockEvents {
  spark?(kind: 'time' | 'words'): void;
  dailyGoal?(): void;
  gap?(ms: number): void;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function localDate(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function focusDay(s: GameState, t: number): FocusDay {
  const key = localDate(t);
  return (s.focus.days[key] ??= { ms: 0, words: 0, goalMet: false, sparks: 0 });
}

export function startSession(s: GameState, now: number) {
  if (s.focus.running) return;
  s.focus.running = { startedAt: now, lastTickAt: now, ms: 0, fromDay: s.day, firstEntry: s.nextId.entry, sparks: 0, favor: 0 };
  applyDawn(s);
}

export function stopSession(s: GameState, now: number, events: ClockEvents = {}): SessionRecord | null {
  const r = s.focus.running;
  if (!r) return null;
  tick(s, Math.min(now, r.lastTickAt + GAP_LIMIT_MS), events);
  const rec: SessionRecord = {
    start: r.startedAt,
    end: now,
    ms: r.ms,
    words: 0,
    fromDay: r.fromDay,
    toDay: s.day,
    firstEntry: r.firstEntry,
    sparks: r.sparks,
    favor: r.favor,
  };
  s.focus.running = null;
  s.focus.sessions.push(rec);
  return rec;
}

/** Count focus time since the last tick and advance the city to match. */
export function tick(s: GameState, now: number, events: ClockEvents = {}) {
  const r = s.focus.running;
  if (!r) return;
  const dt = now - r.lastTickAt;
  if (dt <= 0) return;
  r.lastTickAt = now;
  if (dt > GAP_LIMIT_MS) {
    events.gap?.(dt);
    return;
  }
  accrue(s, dt, now, events);
}

/** The person confirmed they were working through a gap: count it. */
export function creditTime(s: GameState, ms: number, now: number, events: ClockEvents = {}) {
  accrue(s, ms, now, events);
  const last = s.focus.sessions[s.focus.sessions.length - 1];
  if (!s.focus.running && last) last.ms += ms;
}

function accrue(s: GameState, dt: number, now: number, events: ClockEvents) {
  const f = s.focus;
  if (f.running) f.running.ms += dt;
  f.totalMs += dt;
  const day = focusDay(s, now);
  day.ms += dt;

  // Spread the simulation and the Sparks through the time in order, so
  // newcomers arrive in the right season even during a big catch-up.
  // When progress is tracked in words, Sparks come from words instead.
  const timeSparks = s.goals.track !== 'words';
  const sparkLen = timeSparks ? Math.max(1, s.goals.sparkMinutes) * 60_000 : Infinity;
  let left = dt;
  while (left > 0) {
    const toDay = FOCUS_MS_PER_DAY - f.carryMs;
    const toSpark = sparkLen - f.sparkMs;
    const step = Math.min(left, toDay, toSpark);
    f.carryMs += step;
    if (timeSparks) f.sparkMs += step;
    left -= step;
    if (f.carryMs >= FOCUS_MS_PER_DAY - 1e-6) {
      f.carryMs = 0;
      stepDay(s);
    }
    if (f.sparkMs >= sparkLen - 1e-6) {
      f.sparkMs = 0;
      spark(s, now, 'time', events);
    }
  }
  checkDailyGoal(s, now, events);
}

/** Words written after a session. Every few hundred words is a Spark too. */
export function logWords(s: GameState, words: number, now: number, events: ClockEvents = {}) {
  const n = Math.max(0, Math.floor(words));
  if (!n) return;
  focusDay(s, now).words += n;
  const last = s.focus.sessions[s.focus.sessions.length - 1];
  if (last && now - last.end < 6 * 3_600_000) last.words += n;
  const per = Math.max(1, s.goals.sparkWords);
  s.focus.sparkWords += n;
  while (s.goals.track === 'words' && s.focus.sparkWords >= per) {
    s.focus.sparkWords -= per;
    spark(s, now, 'words', events);
  }
  checkDailyGoal(s, now, events);
}

function spark(s: GameState, now: number, kind: 'time' | 'words', events: ClockEvents) {
  // A Spark is kept, to spend on calling someone, and brings a little Favor too.
  s.favor += 1;
  s.sparks = (s.sparks ?? 0) + 1;
  if (s.focus.running) { s.focus.running.sparks++; s.focus.running.favor++; }
  focusDay(s, now).sparks++;
  events.spark?.(kind);
}

function checkDailyGoal(s: GameState, now: number, events: ClockEvents) {
  const day = focusDay(s, now);
  if (day.goalMet) return;
  const g = s.goals;
  const met = g.track === 'words'
    ? g.dailyWords > 0 && day.words >= g.dailyWords
    : g.dailyMinutes > 0 && day.ms >= g.dailyMinutes * 60_000;
  if (!met) return;
  day.goalMet = true;
  s.favor += 5;
  offerFortune(s);
  if (s.focus.running) s.focus.running.favor += 5;
  events.dailyGoal?.();
}

/** Goal days in the last seven days, today included. */
export function goalDaysThisWeek(s: GameState, now: number): number {
  let n = 0;
  for (let i = 0; i < 7; i++) if (s.focus.days[localDate(now - i * 86_400_000)]?.goalMet) n++;
  return n;
}

export function sessionElapsed(s: GameState, now: number): number {
  const r = s.focus.running;
  if (!r) return 0;
  return r.ms + Math.max(0, Math.min(now - r.lastTickAt, GAP_LIMIT_MS));
}
