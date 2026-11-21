// The Chronicle: the city's history, year by year, newest first.
import { saveTextFile } from '../game/files';
import { useState } from 'preact/hooks';
import { store } from '../game/store';
import { DAYS_PER_YEAR, SEASONS, type ChronicleSettings, type Entry } from '../sim/types';
import { CATEGORIES, DEFAULT_CHRONICLE, shown } from '../sim/notable';
import { seasonIndex, yearOf } from '../sim/world';
import { RichText } from './format';

const FOCUS: { id: ChronicleSettings['focus']; label: string }[] = [
  { id: 'auto', label: 'Auto' }, { id: 'notable', label: 'Notable people' }, { id: 'followed', label: 'Only who I follow' }, { id: 'everyone', label: 'Everyone' },
];
const AUTO_HINT: Record<string, string> = {
  settlement: 'Everything that happens, while the settlement is small.',
  village: 'Everything but the smallest things, and everything about notable people.',
  town: 'The notable people of the town (leaders, masters, discoverers, the people you called and follow, and the best known), and its bigger events.',
  city: 'The people who shape the city, the people you follow, and its great events.',
  metropolis: 'Only the people who shape the city, the people you follow, and its great events.',
};

export function ChroniclePanel() {
  const s = store.state!;
  const [years, setYears] = useState(8);
  const [open, setOpen] = useState(false);
  const settings = (s.settings.chronicle ??= { ...DEFAULT_CHRONICLE });
  const keep = (e: Entry) => shown(s, e, settings);
  const toggle = (id: string) => {
    settings.hide = settings.hide.includes(id) ? settings.hide.filter((x) => x !== id) : [...settings.hide, id];
    store.changed();
  };

  const current = yearOf(s.day);
  const groups: { year: number; entries: Entry[] }[] = [];
  for (let i = s.chronicle.length - 1; i >= 0; i--) {
    const e = s.chronicle[i];
    const y = yearOf(e.day);
    if (y <= current - years) break;
    if (!keep(e)) continue;
    let g = groups[groups.length - 1];
    if (!g || g.year !== y) { g = { year: y, entries: [] }; groups.push(g); }
    g.entries.push(e);
  }
  const oldest = s.chronicle.length ? yearOf(s.chronicle[0].day) : current;

  return (
    <>
      <div class="filters">
        {FOCUS.map((f) => (
          <button key={f.id} class={`chip${settings.focus === f.id ? ' on' : ''}`} onClick={() => { settings.focus = f.id; store.changed(); }}>{f.label}</button>
        ))}
        <button class={`chip${open ? ' on' : ''}`} onClick={() => setOpen(!open)}>What to show…</button>
        <button class="chip" onClick={() => exportChronicle()}>Save as text</button>
      </div>
      <p class="hint" style={{ marginTop: 0 }}>
        {settings.focus === 'auto' ? AUTO_HINT[s.stage] : settings.focus === 'notable' ? 'The people who matter most to the story, and the bigger events.' : settings.focus === 'followed' ? 'The people you follow (and your own), plus the greatest events.' : 'Everything that was written down.'}
        {' '}Follow anyone from their card to keep their story in view.
      </p>
      {open && (
        <div class="group">
          {CATEGORIES.map((c) => (
            <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400, margin: '2px 0' }}>
              <input type="checkbox" checked={!settings.hide.includes(c.id)} onChange={() => toggle(c.id)} /> {c.label}
            </label>
          ))}
        </div>
      )}
      {groups.length === 0 && <p class="note">Nothing yet. The Chronicle fills as the city lives — and it only lives while you work.</p>}
      {groups.map((g) => (
        <div class="chron-year" key={g.year}>
          <h3>
            Year {g.year}{s.yearNames[g.year] ? ` — ${s.yearNames[g.year]}` : g.year === current ? ' (so far)' : ''}
            {g.year === current && <small>The year is named when it ends, after its most memorable event.</small>}
          </h3>
          {g.entries.map((e) => (
            <p class={`entry${e.weight >= 6 ? ' major' : e.weight <= 1 ? ' minor' : ''}`} key={e.id}>
              <span class="season">{SEASONS[seasonIndex(e.day)]}</span>
              <RichText s={s} text={e.text} />
            </p>
          ))}
        </div>
      ))}
      {current - years >= oldest && (
        <button class="btn small" onClick={() => setYears(years + 20)}>Show older years</button>
      )}
    </>
  );
}

/** The whole history as a Markdown file: a ready-made story bible. */
export function exportChronicle() {
  const s = store.state!;
  const lines = [`# The Chronicle of ${s.name}`, ''];
  let year = 0;
  for (const e of s.chronicle) {
    const y = Math.floor(e.day / DAYS_PER_YEAR) + 1;
    if (y !== year) {
      year = y;
      lines.push('', `## Year ${y}${s.yearNames[y] ? ` — ${s.yearNames[y]}` : ''}`, '');
    }
    const text = e.text.replace(/\{([pf]):(\d+)\}/g, (_, k, id) => {
      const p = s.people[Number(id)];
      return p ? (k === 'f' ? p.first : `${p.first} ${p.nickname ?? p.family}`) : '?';
    });
    lines.push(`- *${SEASONS[seasonIndex(e.day)]}.* ${text}`);
  }
  void saveTextFile(`chronicle-of-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`, lines.join('\n') + '\n', { label: 'Markdown', ext: 'md', mime: 'text/markdown' })
    .catch((e) => store.toast(`Couldn't save the Chronicle: ${(e as Error).message ?? e}`));
}
