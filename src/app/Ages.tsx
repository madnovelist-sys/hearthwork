// The ages of the city: what's been discovered, by whom, and what might come
// next. Plus the little ceremony at the next break when a new age begins or
// the town is granted its charter.
import { actCost } from '../sim/acts';
import { useState } from 'preact/hooks';
import { store } from '../game/store';
import { DISCOVERIES, ERA_LABEL, candidates, discovery, discoveryProgress, ideaTitle } from '../sim/ages';
import { JOB_LABEL } from '../sim/people';
import { describeArms } from '../sim/town';
import { fullName, yearOf } from '../sim/world';
import { ArmsShield } from './Arms';
import { PersonLink, RichText } from './format';

const years = (from: number, to?: number) => `Year ${yearOf(from)}${to !== undefined ? `–${yearOf(to)}` : ' to now'}`;

export function AgesPanel() {
  const s = store.state!;
  const frac = discoveryProgress(s);
  const nudge = s.lore.nudge && s.lore.nudge.until >= s.day ? s.people[s.lore.nudge.person] : undefined;
  const ideas = candidates(s).slice().sort((a, b) => a.era - b.era).slice(0, 6);
  return (
    <>
      <div class="age-now">
        <h3>{s.age.name}</h3>
        <div class="sub">
          {s.age.side ? 'Named for what happened, not for a discovery. It will pass.' : `The ${ERA_LABEL[s.age.era]} era`} · since Year {yearOf(s.age.since)}
        </div>
      </div>
      <section>
        <h4>The next discovery</h4>
        <div class="meter wide"><div class="bar"><i style={{ width: `${frac * 100}%` }} /></div></div>
        <p class="note">
          {frac >= 1 ? 'Something is about to be worked out.' : frac > 0.6 ? 'People are close to something.' : 'People are learning, a little every day.'}
          {' '}Crafters, elders, curious minds, markets and scribes all help.
          {nudge && <> <PersonLink p={nudge} /> has an idea that won't let go.</>}
        </p>
        {ideas.length === 0 && <p class="note">People have learned all this age has to teach. Something greater will come, in time.</p>}
        {ideas.length > 0 && (
          <>
            <div class="sub" style={{ margin: '6px 0 2px' }}>Ideas in the air</div>
            {ideas.map((d) => (
              <div key={d.id} class="idea">
                <b>{ideaTitle(d)}</b>{d.age ? <span class="tag gold">A new age</span> : null}
                <span class="sub"> · likeliest from {d.jobs.map((j) => JOB_LABEL[j].toLowerCase()).join(', ')}</span>
              </div>
            ))}
          </>
        )}
        <div style={{ marginTop: 10 }}>
          <button class="btn small" onClick={() => store.setUi({ panel: 'acts', act: 'inspire' })}>Inspire someone <span class="cost">✧{actCost('inspire')}</span></button>
        </div>
      </section>
      <section>
        <h4>Ages</h4>
        {s.ages.slice().reverse().map((a, i) => {
          const d = a.discovery ? discovery(a.discovery) : undefined;
          return (
            <div key={i} class="age-row">
              <b>{a.name}</b> <span class="sub">{years(a.from, a.to)}{a.side ? '' : ` · ${ERA_LABEL[a.era]}`}</span>
              {d && <div class="sub">Began with {d.name}.</div>}
            </div>
          );
        })}
      </section>
      <section>
        <h4>Discoveries ({s.lore.known.length} of {DISCOVERIES.length})</h4>
        {!s.lore.known.length && <p class="note">Nothing yet. The first discoveries usually come within a few years.</p>}
        {s.lore.known.slice().reverse().map((k) => {
          const d = discovery(k.id);
          if (!d) return null;
          const by = k.by !== undefined ? s.people[k.by] : undefined;
          return (
            <div key={k.id} class="age-row">
              <b>{ideaTitle(d)}</b> <span class="sub">Year {yearOf(k.day)}{by ? <> · by <PersonLink p={by} /></> : ''}</span>
              <div class="sub">{d.note}</div>
            </div>
          );
        })}
      </section>
    </>
  );
}

/** At the next break: a new age, or a charter. */
export function Ceremony() {
  const s = store.state!;
  const c = s.flags.ceremony!;
  const [name, setName] = useState(s.name);
  const done = () => {
    const n = name.trim();
    if (c.kind === 'charter' && n && n !== s.name) {
      s.name = n.slice(0, 40);
      store.toast(`From now on, it's ${s.name}.`, 'gold');
    }
    s.flags.ceremony = undefined;
    store.changed();
  };
  if (c.kind === 'charter') {
    const entry = s.chronicle.slice().reverse().find((e) => e.kind === 'stage');
    return (
      <div class="scrim">
        <div class="dialog paper ceremony form" role="dialog" aria-label="A charter">
          {s.arms && <div class="arms-big"><ArmsShield arms={s.arms} size={96} /></div>}
          <h2>{s.stage === 'town' ? 'The Town Charter' : s.stage === 'city' ? 'A City' : 'A Great City'}</h2>
          {entry && <p><RichText s={s} text={entry.text} /></p>}
          {s.arms && s.stage === 'town' && <p class="sub">Arms: {describeArms(s.arms)}. Motto: “{s.arms.motto}.”</p>}
          {s.stage === 'town' && (
            <>
              <label>The town's name</label>
              <input type="text" maxLength={40} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
              <p class="sub">A charter is a good time for a new name, if you'd like one. Or keep the old.</p>
            </>
          )}
          <div class="row-btns"><button class="btn primary" onClick={done}>So be it</button></div>
        </div>
      </div>
    );
  }
  // A new age.
  const last = s.ages[s.ages.length - 1];
  const d = last?.discovery ? discovery(last.discovery) : undefined;
  // The entry that began this age: the discovery (or event) on the day it started.
  const found = s.chronicle.slice().reverse().find((e) => e.day === last?.from && (d ? e.kind === 'discovery' : e.kind === 'age'))
    ?? s.chronicle.slice().reverse().find((e) => e.day === last?.from);
  const newEra = s.ages.length >= 2 && s.ages[s.ages.length - 2].era !== last.era && !last.side;
  const by = found?.people[0] !== undefined ? s.people[found.people[0]] : undefined;
  return (
    <div class="scrim">
      <div class="dialog paper ceremony form" role="dialog" aria-label={s.age.name}>
        <div class="sub">{newEra ? `A new era: ${ERA_LABEL[last.era]}` : last?.side ? 'The times have a new name' : 'A new age'}</div>
        <h2>{s.age.name}</h2>
        {found && <p><RichText s={s} text={found.text} /></p>}
        {d && <p class="sub">{d.note}.{by ? ` ${fullName(by)} will be remembered for it.` : ''}</p>}
        {newEra && <p class="sub">New buildings will be built in the new way, and old ones rebuilt over the years, as art for the new era arrives.</p>}
        <div class="row-btns"><button class="btn primary" onClick={done}>Onward</button></div>
      </div>
    </div>
  );
}
