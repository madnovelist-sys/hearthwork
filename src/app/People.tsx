// The people of the settlement: a searchable list, and a card for whoever
// (or whatever) is selected on the map.
import { useState } from 'preact/hooks';
import { bless } from '../sim/acts';
import { BUILDING_LABEL } from '../sim/planner';
import { DREAM_LABEL, JOB_LABEL, TRAIT_LABEL } from '../sim/people';
import { store } from '../game/store';
import type { GameState, Person } from '../sim/types';
import { ageOf, fullName, isBlessed, yearOf } from '../sim/world';
import { costumeOf, rolesOf } from '../render/figures';
import { FamilyMark, Figure } from './Figure';
import { leaderTitle } from '../sim/society';
import { ITEM_KIND_LABEL, itemsOf } from '../sim/items';
import { petsOf } from '../sim/animals';
import { guildOf } from '../sim/town';
import { isSite } from '../sim/places';
import { ERA_LABEL, discovery } from '../sim/ages';

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
import { PersonLink, RichText, ageText, when } from './format';

type Filter = 'here' | 'yours' | 'away' | 'gone';

export function PeoplePanel() {
  const s = store.state!;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('here');
  const match = (p: Person) => !q || fullName(p).toLowerCase().includes(q.toLowerCase());
  const lists: Record<Filter, Person[]> = {
    here: s.people.filter((p) => p.alive && p.away === undefined),
    yours: s.people.filter((p) => p.patron || p.lineage || p.followed),
    away: s.people.filter((p) => p.alive && p.away !== undefined),
    gone: s.people.filter((p) => !p.alive).reverse(),
  };
  const shown = lists[filter].filter(match).slice(0, 300);
  const roles = rolesOf(s);
  const chip = (f: Filter, label: string) => (
    <button class={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{label} ({lists[f].length})</button>
  );
  return (
    <>
      <input class="search" placeholder="Find someone…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      <div class="filters">
        {chip('here', 'Here')}
        {chip('yours', 'Yours & followed')}
        {chip('away', 'Away')}
        {chip('gone', 'Departed')}
      </div>
      {shown.map((p) => (
        <div class="row" key={p.id} onClick={() => store.setUi({ selection: { kind: 'person', id: p.id } })}>
          <span class="dot" style={{ background: costumeOf(p, ageOf(s, p), roles).main }} />
          <div class="who">
            <b>{p.patron || p.lineage ? '✦ ' : ''}{fullName(p)}</b>
            <span>{status(s, p)}</span>
          </div>
        </div>
      ))}
      {!shown.length && <p class="note">No one here.</p>}
    </>
  );
}

function status(s: GameState, p: Person): string {
  if (!p.alive) return p.left ? `Moved away in Year ${yearOf(p.died ?? 0)}` : `Died Year ${yearOf(p.died ?? 0)}, aged ${ageOf(s, p)}, of ${p.cause}`;
  if (p.away !== undefined) return p.lost ? 'Lost on a quest' : `Away: ${s.quests[p.away]?.place ?? 'on a journey'}`;
  const bits = [`${ageText(s, p)}`, JOB_LABEL[p.job]];
  if (p.sick) bits.push('sick');
  if (p.injured) bits.push('injured');
  if (p.pregnant) bits.push('expecting');
  return bits.join(' · ');
}

export function PersonCard({ id }: { id: number }) {
  const s = store.state!;
  const p = s.people[id];
  if (!p) return null;
  const close = () => store.setUi({ selection: null });
  const spouse = p.spouse !== undefined ? s.people[p.spouse] : undefined;
  const parents = p.parents.map((x) => s.people[x]).filter(Boolean);
  const kids = p.children.map((x) => s.people[x]).filter(Boolean);
  const home = p.home !== undefined ? s.buildings[p.home] : undefined;
  const life = p.memories.map((m) => s.chronicle.find((e) => e.id === m)).filter(Boolean).slice(-12).reverse();
  const canAct = p.alive && p.away === undefined;
  const adult = ageOf(s, p) >= 16;
  const doBless = () => {
    const r = bless(s, p.id);
    if (!r.ok) store.toast(r.reason); else { store.toast(`${p.first} is blessed for a year.`, 'gold'); store.changed(); }
  };
  const sex = p.sex === 'f' ? 'Woman' : 'Man';
  const age = ageOf(s, p);
  return (
    <div class="card paper" role="dialog" aria-label={fullName(p)}>
      <button class="btn small ghost close" onClick={close} aria-label="Close">✕</button>
      <div class="portrait">
        <Figure s={s} p={p} />
        <FamilyMark family={p.family} />
      </div>
      <h3>{p.patron || p.lineage ? '✦ ' : ''}{fullName(p)}</h3>
      <div class="sub">
        {p.alive ? `${age < 1 ? 'Baby' : `${age}-year-old ${age < 16 ? (p.sex === 'f' ? 'girl' : 'boy') : sex.toLowerCase()}`}` : status(s, p)}
        {p.alive && ` · ${JOB_LABEL[p.job]}`}
        {p.nickname && ` · born ${p.first} ${p.family}`}
      </div>
      <div>
        {p.traits.map((t) => <span class="tag" key={t}>{TRAIT_LABEL[t]}</span>)}
        {p.patron && <span class="tag gold">Your settler</span>}
        {!p.patron && p.lineage && <span class="tag gold">Of your line</span>}
        {isBlessed(s, p) && <span class="tag gold">Blessed</span>}
        {p.sick && <span class="tag red">{p.sick.severity > 0.75 ? 'Gravely ill' : 'Sick'}</span>}
        {p.injured && <span class="tag red">Injured</span>}
        {p.pregnant && <span class="tag">Expecting</span>}
        {p.preparing && <span class="tag gold">Leaves on a quest at dawn</span>}
        {s.leader?.person === p.id && p.alive && <span class="tag gold">{leaderTitle(s)}</span>}
        {p.faith !== undefined && s.faiths[p.faith] && !s.faiths[p.faith].gone && <span class="tag">{cap(s.faiths[p.faith].name)}</span>}
        {s.buildings.filter((b) => b.owner === p.id && !b.removed && b.name).map((b) => <span class="tag" key={b.id}>Runs {b.name}</span>)}
        {p.alive && (() => { const g = guildOf(s, p.job); return g && ageOf(s, p) >= 16 ? <span class="tag">{g.master === p.id ? 'Master of ' : ''}{cap(g.name)}</span> : null; })()}
        {s.lore.known.filter((k) => k.by === p.id).map((k) => <span class="tag gold" key={k.id}>Discovered {discovery(k.id)?.name}</span>)}
      </div>
      {p.backstory && <p class="story">{p.backstory}</p>}
      <section>
        <h4>Dream</h4>
        <div>Wants {DREAM_LABEL[p.dream]}{p.dreamMet ? ' — and did.' : '.'}</div>
      </section>
      {(spouse || parents.length > 0 || kids.length > 0 || p.courting) && (
        <section>
          <h4>Family</h4>
          {spouse && <div>Spouse: <PersonLink p={spouse} /></div>}
          {p.courting && s.people[p.courting.with] && <div>Courting: <PersonLink p={s.people[p.courting.with]} /></div>}
          {parents.length > 0 && <div>Parents: {parents.map((x, i) => <span key={x.id}>{i ? ', ' : ''}<PersonLink p={x} /></span>)}</div>}
          {kids.length > 0 && <div>Children: {kids.map((x, i) => <span key={x.id}>{i ? ', ' : ''}<PersonLink p={x} />{x.alive ? '' : ' †'}</span>)}</div>}
        </section>
      )}
      {(itemsOf(s, p.id).length > 0 || petsOf(s, p.id).length > 0) && (
        <section>
          <h4>Keeps</h4>
          {itemsOf(s, p.id).map((it) => (
            <div key={it.id}><button class="pname" onClick={() => store.setUi({ item: it.id })}>{it.name[0].toUpperCase() + it.name.slice(1)}</button> <span class="sub">({ITEM_KIND_LABEL[it.kind]})</span></div>
          ))}
          {petsOf(s, p.id).map((pet) => <div key={`pet${pet.id}`}>{pet.name}, {pet.kind === 'dog' ? 'a dog' : 'a cat'}</div>)}
        </section>
      )}
      {home && p.alive && (
        <section>
          <h4>Home</h4>
          <button class="pname" onClick={() => store.setUi({ selection: { kind: 'building', id: home.id } })}>{BUILDING_LABEL[home.kind]}</button>
        </section>
      )}
      {life.length > 0 && (
        <section>
          <h4>Life</h4>
          {life.map((e) => <p class="life" key={e!.id}><small>{when(e!.day)}</small><RichText s={s} text={e!.text} /></p>)}
        </section>
      )}
      <div class="actions">
        <button class={`btn small${p.followed ? ' active' : ''}`} onClick={() => { p.followed = !p.followed; store.changed(); }}>
          {p.followed ? 'Following' : 'Follow'}
        </button>
        <button class="btn small" onClick={() => store.setUi({ tree: p.id })}>Family tree</button>
        {canAct && <button class="btn small" onClick={doBless}>Bless <span class="cost">✦1</span></button>}
        {canAct && adult && !p.preparing && (
          <button class="btn small" onClick={() => store.setUi({ panel: 'acts', act: 'quest', actTarget: p.id })}>Send on a quest <span class="cost">✦3</span></button>
        )}
        {canAct && age < 1 && (
          <button class="btn small" onClick={() => store.setUi({ panel: 'acts', act: 'name', actTarget: p.id })}>Name <span class="cost">✦1</span></button>
        )}
      </div>
    </div>
  );
}

export function BuildingCard({ id }: { id: number }) {
  const s = store.state!;
  const b = s.buildings[id];
  if (!b) return null;
  const people = s.people.filter((p) => p.alive && p.home === b.id && p.away === undefined);
  const worker = b.worker !== undefined ? s.people[b.worker] : undefined;
  const graves = b.kind === 'graveyard' ? s.graves.filter((g) => g.x >= b.x && g.x < b.x + b.w && g.y >= b.y && g.y < b.y + b.h) : [];
  return (
    <div class="card paper" role="dialog" aria-label={BUILDING_LABEL[b.kind]}>
      <button class="btn small ghost close" onClick={() => store.setUi({ selection: null })} aria-label="Close">✕</button>
      <h3>{b.kind === 'hearth' ? `The Hearth of ${s.name}` : b.name ? cap(b.name) : BUILDING_LABEL[b.kind]}</h3>
      {b.name && <div class="sub">{BUILDING_LABEL[b.kind]}{b.owner !== undefined && s.people[b.owner] ? <>, run by <PersonLink p={s.people[b.owner]} /></> : ''}</div>}
      {b.burning !== undefined && <p class="note" style={{ background: '#f3d2cc' }}>On fire!</p>}
      {b.burned && <p class="note">A burned-out shell. It will be cleared away.</p>}
      <div class="sub">
        {isSite(b.kind) ? '' : b.built ? (b.kind === 'hearth' ? 'Lit in the spring of Year 1' : `Built ${when(b.completed ?? b.founded)}`) : `Being built: ${Math.round((b.progress / Math.max(1, b.required)) * 100)}%`}
      </div>
      {b.kind === 'hearth' && <p class="story">The first fire. It burns while you work; when you rest, it banks to embers and the city sleeps.</p>}
      {b.era && b.era !== 'bronze' && b.kind !== 'bridge' && <div class="sub">Built in the {ERA_LABEL[b.era]} style.</div>}
      {b.kind === 'temple' && b.faith !== undefined && s.faiths[b.faith] && <p class="story">The house of {s.faiths[b.faith].name}.</p>}
      {b.kind === 'bridge' && <p class="story">Timber laid over the river, so the town could cross to the far bank.</p>}
      {isSite(b.kind) && (
        <p class="story">
          {(b.sacred ?? 0) >= 70 ? 'A holy place. People go quiet when they come near it.' : (b.sacred ?? 0) >= 35 ? 'People leave small offerings here.' : 'Nobody pays it much mind yet.'}
          {b.faith !== undefined && s.faiths[b.faith] ? ` The holy place of ${s.faiths[b.faith].name}.` : ''}
        </p>
      )}
      {isSite(b.kind) && b.foundBy !== undefined && s.people[b.foundBy] && <div class="sub">Found in Year {yearOf(b.founded)} by <PersonLink p={s.people[b.foundBy]} />.</div>}
      {people.length > 0 && (
        <section>
          <h4>Lives here</h4>
          {people.map((p) => <div key={p.id}><PersonLink p={p} /> <span class="sub">{ageText(s, p)}</span></div>)}
        </section>
      )}
      {worker && <section><h4>Worked by</h4><PersonLink p={worker} /></section>}
      {b.kind === 'pen' && <section><h4>Animals</h4>{b.herd ? `${b.herd} goats and sheep.` : 'Empty, for now.'}</section>}
      {b.dead && b.dead.length > 0 && (
        <section>
          <h4>{b.kind === 'pyre' ? 'Burned here' : b.kind === 'skyplatform' ? 'Given to the sky here' : b.kind === 'landing' ? 'Given to the river here' : 'Laid to rest here'}</h4>
          {b.dead.slice(-16).reverse().map((id) => {
            const p = s.people[id];
            return p ? <div key={id}><PersonLink p={p} /> <span class="sub">Year {yearOf(p.died ?? 0)}</span></div> : null;
          })}
        </section>
      )}
      {graves.length > 0 && (
        <section>
          <h4>Buried here</h4>
          {graves.slice(-16).reverse().map((g) => {
            const p = s.people[g.person];
            return p ? <div key={g.id}><PersonLink p={p} /> <span class="sub">Year {yearOf(p.born < 0 ? 0 : p.born) } – {yearOf(g.day)}</span></div> : null;
          })}
        </section>
      )}
      {b.forPeople?.length ? (
        <section><h4>For</h4><RichText s={s} text={b.forPeople.map((x) => `{p:${x}}`).join(', ')} /></section>
      ) : null}
    </div>
  );
}
