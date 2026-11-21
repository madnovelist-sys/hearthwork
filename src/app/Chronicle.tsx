// The Chronicle: the city's history, year by year, newest first.
import { saveTextFile } from '../game/files';
import { useState } from 'preact/hooks';
import { store } from '../game/store';
import { DAYS_PER_YEAR, SEASONS, type Entry } from '../sim/types';
import { seasonIndex, yearOf } from '../sim/world';
import { RichText } from './format';

export function ChroniclePanel() {
  const s = store.state!;
  const [major, setMajor] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [years, setYears] = useState(8);
  const follows = new Set(s.people.filter((p) => p.followed || p.patron || p.lineage).map((p) => p.id));
  const keep = (e: Entry) => (!major || e.weight >= 3) && (!followed || e.people.some((id) => follows.has(id)));

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
        <button class={`chip${major ? ' on' : ''}`} onClick={() => setMajor(!major)}>Major events</button>
        <button class={`chip${followed ? ' on' : ''}`} onClick={() => setFollowed(!followed)}>People I follow</button>
        <button class="chip" onClick={() => exportChronicle()}>Save as text</button>
      </div>
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
