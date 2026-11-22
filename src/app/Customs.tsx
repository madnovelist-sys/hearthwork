// The town's ways: which it keeps (and where they came from), which are spreading among the
// newcomers, and the homelands its people came from. A Spark can encourage a way, or
// discourage one, for a few years.
import { store } from '../game/store';
import { CUSTOM_BY_ID, KIND_LABEL, landOf, nudgeWay, waysHere } from '../sim/culture';
import type { GameState } from '../sim/types';
import { present, yearOf } from '../sim/world';

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

export function CustomsSection({ s }: { s: GameState }) {
  const ways = waysHere(s);
  const kept = ways.filter((w) => w.kept);
  const spreading = ways.filter((w) => !w.kept && w.share >= 0.02).slice(0, 8);
  const nudge = s.culture?.nudge && s.culture.nudge.until > s.day ? s.culture.nudge : undefined;
  const people = present(s);
  const lands = new Map<number, number>();
  for (const p of people) if (p.land !== undefined) lands.set(p.land, (lands.get(p.land) ?? 0) + 1);
  const from = [...lands.entries()].sort((a, b) => b[1] - a[1]);
  const go = (id: string, up: boolean) => {
    const r = nudgeWay(s, id, up);
    if (!r.ok) store.toast(r.reason);
    else { store.toast(up ? 'The idea is in the air.' : 'People will begin to drift away from it.', 'gold'); store.changed(); }
  };
  const row = (w: (typeof ways)[number]) => {
    const c = CUSTOM_BY_ID.get(w.id);
    if (!c) return null;
    const since = s.culture?.kept.find((k) => k.id === w.id)?.since;
    const land = landOf(s, w.land);
    const nudged = nudge?.id === w.id;
    return (
      <div class="custom" key={w.id}>
        <div class="what">
          <b>{cap(c.name)}</b> <span class="tag">{KIND_LABEL[c.kind]}</span>
          <div class="sub">{c.blurb}</div>
          <div class="sub">
            {w.kept ? `The town's own${since && since > 0 ? ` since Year ${yearOf(since)}` : ' from the start'}` : 'Spreading'}
            {land ? `, from ${land.name}` : ''} · kept by {Math.round(w.share * 100)}%
            {nudged ? (nudge!.up ? ' · encouraged' : ' · discouraged') : ''}
          </div>
        </div>
        {!nudged && (
          <div class="btns">
            {w.share < 0.95 && <button class="btn small" title="For three years, more people take it up" onClick={() => go(w.id, true)}>Encourage <span class="cost">✧1</span></button>}
            {w.share > 0.03 && <button class="btn small ghost" title="For three years, people drift away from it" onClick={() => go(w.id, false)}>Discourage <span class="cost">✧1</span></button>}
          </div>
        )}
      </div>
    );
  };
  return (
    <div class="group">
      <h4>Customs</h4>
      <p class="sub" style={{ margin: '0 0 6px' }}>
        Newcomers bring the ways of their homelands. When enough people keep a way it becomes the town's own; a way nobody keeps fades.
        {nudge ? '' : ' A Spark can encourage a way, or discourage one, for three years.'}
      </p>
      {kept.map(row)}
      {spreading.length > 0 && <h5 style={{ margin: '10px 0 4px' }}>Brought by newcomers</h5>}
      {spreading.map(row)}
      {from.length > 0 && (
        <p class="sub" style={{ marginTop: 8 }}>
          Where its people came from: {from.slice(0, 5).map(([id, n], i) => `${i ? '; ' : ''}${landOf(s, id)?.name ?? 'somewhere'}${id === s.culture?.home ? ' (the first settlers)' : ''}, ${n}`).join('')}{from.length > 5 ? '; and elsewhere' : ''}. The rest were born here.
        </p>
      )}
    </div>
  );
}
