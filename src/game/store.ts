// One place that holds the city, runs the clock, saves, and tells the UI to
// redraw. The simulation mutates the state in place; the UI re-reads it.
import { useEffect, useState } from 'preact/hooks';
import type { GameState, SessionRecord } from '../sim/types';
import { creditTime, GAP_LIMIT_MS, localDate, logWords, startSession, stopSession, tick, type ClockEvents } from './clock';
import { loadGame, saveGame } from './save';
import { notify } from './desktop';
import { stopTimeToday } from './sky';
import { CALL_COST } from '../sim/callers';

export type Panel = 'chronicle' | 'people' | 'society' | 'ages' | 'acts' | 'arrivals' | 'settings' | 'art';
export type Selection = { kind: 'person'; id: number } | { kind: 'building'; id: number } | null;

export interface Toast { id: number; text: string; tone?: 'gold' | 'plain' }

export interface UiState {
  panel: Panel | null;
  selection: Selection;
  toasts: Toast[];
  /** The session that just ended, waiting for its word count. */
  ended: SessionRecord | null;
  /** Time that passed while the app was closed or asleep mid-session, or while you were away. */
  gapMs: number | null;
  gapReason?: 'closed' | 'away';
  /** Open act form. */
  act: 'settler' | 'quest' | 'name' | 'law' | 'prophet' | 'inspire' | null;
  /** Person whose family tree is open. */
  tree?: number;
  /** Heirloom whose story is open. */
  item?: number;
  actTarget?: number;
  /** The small "log words" dialog (word tracking only). */
  logWords?: boolean;
}

type Listener = () => void;

class Store {
  state: GameState | null = null;
  ui: UiState = { panel: null, selection: null, toasts: [], ended: null, gapMs: null, act: null };
  loaded = false;
  private listeners = new Set<Listener>();
  private dirty = false;
  private lastNotify = 0;
  private notifyTimer: number | undefined;
  private toastId = 0;

  readonly events: ClockEvents = {
    spark: (kind) => {
      const n = this.state?.sparks ?? 0;
      this.toast(`${kind === 'time' ? 'A Spark!' : 'Your words became a Spark.'} You have ${n} to spend.`, 'gold');
      this.ping('A Spark', `You have ${n} Spark${n === 1 ? '' : 's'}. Spend ${CALL_COST} to call someone to ${this.state?.name ?? 'your settlement'}.`);
    },
    dailyGoal: () => {
      this.toast('Daily goal reached: +5 Favor. The fire burns bright tonight.', 'gold');
      this.ping('Daily goal reached', '+5 Favor. The fire burns bright tonight.');
    },
    gap: (ms) => { this.ui.gapMs = ms; this.ui.gapReason = 'closed'; this.notify(true); },
  };

  /**
   * When the Mac app can tell you've stepped away, time is only counted up to
   * shortly after your last keyboard or mouse input (null: no limit).
   */
  activeUntil: number | null = null;

  /** A quiet system notification, only if turned on and you're not looking at the game. */
  private ping(title: string, body: string) {
    if (!this.state?.settings.notify) return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    void notify(title, body);
  }

  /** You've been away long enough: pause at the moment you left, and ask about the time since. */
  pauseForAway(lastActive: number, now: number) {
    const s = this.state;
    if (!s?.focus.running) return;
    this.activeUntil = null;
    // Time already counted (up to a little after you left) isn't asked about twice.
    const counted = Math.max(lastActive, s.focus.running.lastTickAt);
    const rec = stopSession(s, lastActive, this.events);
    this.ui.ended = rec;
    this.ui.gapMs = Math.max(0, now - counted);
    this.ui.gapReason = 'away';
    void notify('Hearthwork paused', `You've been away for ${Math.round((now - lastActive) / 60_000)} minutes, so your session paused when you left.`);
    this.save();
    this.notify(true);
  }

  subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Redraw the UI, at most a few times a second unless it's urgent. */
  notify(now = false) {
    this.dirty = true;
    const t = performance.now();
    if (now || t - this.lastNotify > 250) {
      this.lastNotify = t;
      clearTimeout(this.notifyTimer);
      for (const fn of this.listeners) fn();
    } else if (this.notifyTimer === undefined) {
      this.notifyTimer = window.setTimeout(() => { this.notifyTimer = undefined; this.notify(true); }, 260);
    }
  }

  async load() {
    try {
      const s = await loadGame();
      if (s) {
        this.state = s;
        this.recoverInterruptedSession();
      }
    } catch (e) {
      console.error(e);
      this.toast('Your saved city could not be read. Use Settings → Restore a backup.');
    }
    this.loaded = true;
    this.notify(true);
  }

  /** If the app closed mid-session, pause it there and ask about the missing time. */
  private recoverInterruptedSession() {
    const s = this.state!;
    const r = s.focus.running;
    if (!r) return;
    const gap = Date.now() - r.lastTickAt;
    if (gap < 5 * 60_000) return; // a quick restart: keep going
    stopSession(s, r.lastTickAt, this.events);
    this.ui.gapMs = Math.min(gap, 12 * 3_600_000);
    this.ui.gapReason = 'closed';
  }

  setState(s: GameState | null) {
    this.state = s;
    this.ui = { panel: null, selection: null, toasts: [], ended: null, gapMs: null, act: null };
    this.save();
    this.notify(true);
  }

  tick() {
    const s = this.state;
    if (!s?.focus.running) return;
    const before = s.day;
    const now = Date.now();
    // Your stopping time: the session ends there, counted up to that moment.
    const stopAt = stopTimeToday(s, now);
    if (stopAt !== null && s.focus.running.startedAt < stopAt && now >= stopAt) {
      tick(s, Math.min(stopAt, this.activeUntil ?? Infinity), this.events);
      const rec = stopSession(s, stopAt, this.events);
      this.activeUntil = null;
      this.ui.ended = rec;
      const label = new Date(stopAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      this.toast(`It's ${label}: your session ended for the day.`);
      void notify('Hearthwork', `It's ${label}. Your session has ended for the day.`);
      this.save();
      this.notify(true);
      return;
    }
    tick(s, Math.min(now, this.activeUntil ?? Infinity), this.events);
    if (s.day !== before) this.notify();
  }

  start() {
    const s = this.state;
    if (!s || s.focus.running) return;
    startSession(s, Date.now());
    this.activeUntil = null;
    this.ui.ended = null;
    this.ui.panel = null;
    this.save();
    this.notify(true);
  }

  stop() {
    const s = this.state;
    if (!s?.focus.running) return;
    const rec = stopSession(s, Date.now(), this.events);
    this.ui.ended = rec;
    this.save();
    this.notify(true);
  }

  logWords(words: number) {
    if (!this.state) return;
    logWords(this.state, words, Date.now(), this.events);
    this.save();
    this.notify(true);
  }

  resolveGap(count: boolean) {
    const s = this.state;
    const gap = this.ui.gapMs;
    this.ui.gapMs = null;
    if (s && gap && count) {
      creditTime(s, Math.min(gap, GAP_LIMIT_MS * 8), Date.now(), this.events);
      this.toast(`Counted ${Math.round(gap / 60_000)} minutes of work.`);
    }
    this.save();
    this.notify(true);
  }

  toast(text: string, tone: Toast['tone'] = 'plain') {
    // The same message twice in a row becomes one toast with a count.
    const base = text.replace(/ \(×\d+\)$/, '');
    const same = this.ui.toasts.find((x) => x.text.replace(/ \(×\d+\)$/, '') === base);
    if (same) {
      const n = Number(same.text.match(/\(×(\d+)\)$/)?.[1] ?? 1) + 1;
      this.ui.toasts = this.ui.toasts.filter((x) => x !== same);
      text = `${base} (×${n})`;
    }
    const t = { id: ++this.toastId, text, tone };
    this.ui.toasts = [...this.ui.toasts, t].slice(-4);
    this.notify(true);
    setTimeout(() => {
      this.ui.toasts = this.ui.toasts.filter((x) => x.id !== t.id);
      this.notify(true);
    }, 6000);
  }

  setUi(patch: Partial<UiState>) {
    Object.assign(this.ui, patch);
    this.notify(true);
  }

  /** Call after any change made through the UI. */
  changed() {
    this.save();
    this.notify(true);
  }

  private saving = false;
  async save() {
    if (!this.state || this.saving) return;
    this.saving = true;
    try {
      await saveGame(this.state, localDate(Date.now()));
      this.dirty = false;
    } finally {
      this.saving = false;
    }
  }

  saveIfDirty() { if (this.dirty) void this.save(); }
}

export const store = new Store();

/** Re-render a component whenever the store changes. */
export function useStore(): Store {
  const [, set] = useState(0);
  useEffect(() => store.subscribe(() => set((n) => n + 1)), []);
  return store;
}
