// The end-of-session ritual: log your words, then read what happened while
// you worked. And the question asked after the app was closed mid-session.
import { CALL_COST } from '../sim/callers';
import { useState } from 'preact/hooks';
import { store } from '../game/store';
import { entriesSince } from '../sim/chronicle';
import { DAYS_PER_YEAR } from '../sim/types';
import { minutes, RichText, when } from './format';

export function SessionEnd() {
  const s = store.state!;
  const rec = store.ui.ended!;
  const [words, setWords] = useState('');
  const [saved, setSaved] = useState(false);
  const entries = entriesSince(s, rec.firstEntry);
  const highlights = [...entries].sort((a, b) => b.weight - a.weight || a.id - b.id).slice(0, 7).sort((a, b) => a.id - b.id);
  const count = (k: string) => entries.filter((e) => e.kind === k).length;
  const years = (rec.toDay - rec.fromDay) / DAYS_PER_YEAR;
  const saveWords = () => {
    const n = Number(words.replace(/[^0-9]/g, ''));
    if (n > 0) store.logWords(n);
    setSaved(true);
  };
  const done = () => {
    if (!saved && words) saveWords();
    const canCall = (s.sparks ?? 0) >= CALL_COST || s.arrivals.length > 0;
    store.setUi({ ended: null, panel: canCall ? 'arrivals' : 'chronicle' });
  };
  return (
    <div class="scrim">
      <div class="dialog paper" role="dialog" aria-labelledby="end-title">
        <h2 id="end-title">The sun sets on {s.name}</h2>
        <p class="lead">You worked {minutes(rec.ms)}. {years >= 0.95 ? `${Math.round(years * 10) / 10} years` : `${Math.round(years * 4)} season${Math.round(years * 4) === 1 ? '' : 's'}`} passed in the city.</p>
        <div class="summary">
          <div class="stat"><b>{rec.sparks}</b><span>Sparks</span></div>
          <div class="stat favor"><b>✦ {rec.favor}</b><span>Favor earned</span></div>
          <div class="stat"><b>{count('birth')}</b><span>Births</span></div>
          <div class="stat"><b>{count('wedding')}</b><span>Weddings</span></div>
          <div class="stat"><b>{count('death')}</b><span>Deaths</span></div>
          <div class="stat"><b>{count('arrival') + count('patron')}</b><span>Arrivals</span></div>
        </div>
        {s.goals.track === 'words' && <div class="form">
          <label for="words">How many words did you write?</label>
          <div class="two">
            <input id="words" type="text" inputMode="numeric" placeholder="e.g. 850" value={words} disabled={saved}
              onInput={(e) => setWords((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && saveWords()} />
            <button class="btn" type="button" disabled={saved || !words} onClick={saveWords}>{saved ? 'Logged' : 'Log words'}</button>
          </div>
          <p class="hint">Every {s.goals.sparkWords} words is a Spark.</p>
        </div>}
        {highlights.length > 0 && (
          <>
            <h4 style={{ margin: '14px 0 6px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-3)' }}>While you worked</h4>
            {highlights.map((e) => (
              <p class={`entry${e.weight >= 6 ? ' major' : ''}`} key={e.id}><span class="season">{when(e.day)}</span><RichText s={s} text={e.text} /></p>
            ))}
          </>
        )}
        <div class="row-btns">
          {(s.sparks ?? 0) >= CALL_COST && <span class="hint" style={{ alignSelf: 'center', marginRight: 'auto' }}>You have {s.sparks} Sparks: enough to call someone.</span>}
          <button class="btn primary" onClick={done}>{(s.sparks ?? 0) >= CALL_COST ? 'Call someone' : 'Read the Chronicle'}</button>
        </div>
      </div>
    </div>
  );
}

export function GapDialog() {
  const gap = store.ui.gapMs!;
  const away = store.ui.gapReason === 'away';
  return (
    <div class="scrim">
      <div class="dialog paper" role="dialog" aria-labelledby="gap-title">
        <h2 id="gap-title">{away ? 'Welcome back' : 'Were you still working?'}</h2>
        <p class="lead">
          {away
            ? <>You were away from your computer for {minutes(gap)}, so your session paused at the moment you left. Were you still working (reading, thinking, writing by hand)? Count that time too?</>
            : <>Your session was still running when Hearthwork closed or your computer slept, {minutes(gap)} ago. Count that time toward your work?</>}
        </p>
        <div class="row-btns">
          <button class="btn" onClick={() => store.resolveGap(false)}>Don't count it</button>
          <button class="btn primary" onClick={() => store.resolveGap(true)}>Yes, count it</button>
        </div>
      </div>
    </div>
  );
}

export function WordsDialog() {
  const s = store.state!;
  const [words, setWords] = useState('');
  const close = () => store.setUi({ logWords: false });
  const save = () => {
    const n = Number(words.replace(/[^0-9]/g, ''));
    if (n > 0) store.logWords(n);
    close();
  };
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="dialog paper form" role="dialog" aria-labelledby="words-title">
        <h2 id="words-title">Log words</h2>
        <p class="lead">Add words you wrote today. Every {s.goals.sparkWords} words is a Spark.</p>
        <input id="words" type="text" inputMode="numeric" placeholder="e.g. 400" value={words} autoFocus
          onInput={(e) => setWords((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <div class="row-btns">
          <button class="btn" onClick={close}>Cancel</button>
          <button class="btn primary" disabled={!words} onClick={save}>Add</button>
        </div>
      </div>
    </div>
  );
}
