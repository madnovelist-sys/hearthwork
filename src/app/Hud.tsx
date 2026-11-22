// The top bar: where and when the city is, the focus timer, progress to the
// next Spark and today's goal, Sparks, and the panel buttons.
import { useEffect, useState } from 'preact/hooks';
import { goalDaysThisWeek, localDate, sessionElapsed } from '../game/clock';
import { store, type Panel } from '../game/store';
import { currentYearName } from '../sim/chronicle';
import { population, seasonName, yearOf } from '../sim/world';
import { hms } from './format';
import { ArmsShield } from './Arms';
import { CALL_COST } from '../sim/callers';
import { SKY_LABEL, formatTemp, temperature } from '../sim/weather';

const STAGE: Record<string, string> = { settlement: 'Settlement', village: 'Village', town: 'Town', city: 'City', metropolis: 'Metropolis' };

/** Re-render every second while the timer runs. */
function useClock(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [on]);
}

export function Hud() {
  const s = store.state!;
  useClock(!!s.focus.running);
  const now = Date.now();
  const running = !!s.focus.running;
  const elapsed = sessionElapsed(s, now);
  const today = s.focus.days[localDate(now)];
  const g = s.goals;
  const byWords = g.track === 'words';
  const todayMs = (today?.ms ?? 0) + (running ? Math.max(0, elapsed - s.focus.running!.ms) : 0);
  const words = today?.words ?? 0;
  const sparkFrac = byWords
    ? Math.min(1, s.focus.sparkWords / Math.max(1, g.sparkWords))
    : Math.min(1, (s.focus.sparkMs + (running ? Math.min(now - s.focus.running!.lastTickAt, 60_000) : 0)) / (g.sparkMinutes * 60_000));
  const goalFrac = byWords
    ? Math.min(1, words / Math.max(1, g.dailyWords))
    : g.dailyMinutes > 0 ? Math.min(1, todayMs / (g.dailyMinutes * 60_000)) : 0;
  const calls = Math.floor((s.sparks ?? 0) / CALL_COST) + s.arrivals.length;
  const yearName = currentYearName(s);
  const panel = store.ui.panel;
  const tab = (p: Panel, label: string, badge?: number) => (
    <button class={`btn small ${panel === p ? 'active' : 'ghost'}`} onClick={() => store.setUi({ panel: panel === p ? null : p, act: null })}>
      {label}
      {badge ? <span class="badge">{badge}</span> : null}
    </button>
  );
  const sparkLeft = byWords
    ? `${Math.max(0, g.sparkWords - s.focus.sparkWords)} words`
    : `${Math.max(0, Math.ceil((1 - sparkFrac) * g.sparkMinutes))} min`;

  return (
    <div class="hud paper" role="banner">
      <div class="place">
        <span class="name">{s.arms && <span class="arms"><ArmsShield arms={s.arms} size={18} /></span>}{s.name}</span>
        <span class="when">
          {STAGE[s.stage]} · Year {yearOf(s.day)}, {seasonName(s.day)}{yearName ? ` · ${yearName}` : ''} · {s.age.name}
        </span>
      </div>
      <div class="focus">
        <span class="timer" aria-live="off">{hms(elapsed)}</span>
        {running
          ? <button class="btn stop" onClick={() => store.stop()}>Stop</button>
          : <button class="btn primary start" onClick={() => store.start()}>Start working</button>}
        {byWords && !running && (
          <button class="btn small" onClick={() => store.setUi({ logWords: true })} title="Add words you wrote">+ Words</button>
        )}
        <div class="meters">
          <div class="meter" title="Every Spark is kept, to spend on calling someone or on Acts">
            <span>Spark</span><div class="bar"><i style={{ width: `${sparkFrac * 100}%` }} /></div><span>{sparkLeft}</span>
          </div>
          <div class="meter" title={`Daily goal: ${byWords ? `${g.dailyWords} words` : `${g.dailyMinutes} minutes`}. ${goalDaysThisWeek(s, now)} goal days this week.`}>
            <span>Today</span>
            <div class={`bar${today?.goalMet ? ' done' : ''}`}><i style={{ width: `${(today?.goalMet ? 1 : goalFrac) * 100}%` }} /></div>
            <span>{byWords ? `${words}/${g.dailyWords} words` : `${Math.floor(todayMs / 60_000)}/${g.dailyMinutes} min`}</span>
          </div>
        </div>
      </div>
      <div class="stats">
        <div class="stat" title={`The weather in ${s.name} today`}><b>{formatTemp(temperature(s), s.settings.units ?? 'c')}</b><span>{SKY_LABEL[s.weather?.sky ?? 'clear']}</span></div>
        <div class="stat spark" title={`Sparks: spend ${CALL_COST} to call someone to ${s.name}, or spend them on Acts`}><b>✧ {s.sparks ?? 0}</b><span>Sparks</span></div>
        <div class="stat"><b>{population(s)}</b><span>People</span></div>
      </div>
      <div class="tabs">
        {tab('chronicle', 'Chronicle')}
        {tab('people', 'People')}
        {tab('society', 'Society')}
        {tab('ages', 'Ages')}
        {tab('acts', 'Acts', s.fortunes.length)}
        {tab('arrivals', 'Arrivals', calls)}
        {tab('settings', 'Settings')}
      </div>
    </div>
  );
}
