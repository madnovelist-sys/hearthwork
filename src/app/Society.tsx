// Society: who leads, the laws in force, the faiths, and the businesses.
import { store } from '../game/store';
import { LAW, TENETS, followers, leaderTitle } from '../sim/society';
import { BUILDING_LABEL } from '../sim/planner';
import { ageOf, yearOf } from '../sim/world';
import { PersonLink } from './format';
import { ArmsShield } from './Arms';
import { describeArms } from '../sim/town';
import { sitesOf } from '../sim/places';

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

export function SocietyPanel() {
  const s = store.state!;
  const leader = s.leader ? s.people[s.leader.person] : undefined;
  const faiths = s.faiths.filter((f) => !f.gone).map((f) => ({ f, n: followers(s, f.id) })).sort((a, b) => b.n - a.n);
  const faithless = s.people.filter((p) => p.alive && !p.left && p.away === undefined && (p.faith === undefined || s.faiths[p.faith]?.gone)).length;
  const businesses = s.buildings.filter((b) => !b.removed && b.name);
  const heirlooms = s.items.filter((i) => !i.lost && !i.buried).sort((a, b) => a.made - b.made);
  const gone = s.items.length - heirlooms.length;
  const herd = s.buildings.reduce((n, b) => n + (b.kind === 'pen' && b.built && !b.removed ? b.herd ?? 0 : 0), 0);
  const dogs = s.pets.filter((p) => p.alive && p.kind === 'dog').length;
  const cats = s.pets.filter((p) => p.alive && p.kind === 'cat').length;
  return (
    <>
      {s.plague && (
        <p class="note" style={{ background: '#f3d2cc' }}>
          <b>{cap(s.plague.name)}</b> is in {s.name}: {s.plague.cases} have fallen sick and {s.plague.deaths} have died since Year {yearOf(s.plague.since)}.
        </p>
      )}
      {s.arms && (
        <div class="group" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <ArmsShield arms={s.arms} size={44} />
          <div>
            <b>The arms of {s.name}</b>
            <div class="sub">{cap(describeArms(s.arms))}. “{s.arms.motto}.”</div>
            <div class="sub">
              {s.walls ? (s.walls.built ? `${s.walls.kind === 'stone' ? 'Stone walls' : 'A palisade'} with ${s.walls.gates.length} gates.` : `${s.walls.kind === 'stone' ? 'Stone walls' : 'A palisade'} going up: ${Math.round((s.walls.progress / s.walls.required) * 100)}% built.`) : 'No wall yet.'}
              {' '}{s.buildings.filter((b) => b.kind === 'bridge' && b.built && !b.removed).length ? 'A bridge over the river.' : ''}
            </div>
          </div>
        </div>
      )}
      <div class="group">
        <h4>{s.stage === 'settlement' ? 'Who people listen to' : 'The chief'}</h4>
        {leader ? (
          <p><PersonLink p={leader} />, {ageOf(s, leader)}, {leaderTitle(s).toLowerCase()} since Year {yearOf(s.leader!.since)}.</p>
        ) : <p class="note">No one yet. Someone will step forward.</p>}
      </div>
      <div class="group">
        <h4>Laws</h4>
        {s.laws.length === 0 && <p class="note">No laws yet. Leaders make them as the settlement grows, or you can Whisper a Law.</p>}
        {s.laws.map((l) => (
          <div class="party" key={l.id}>
            <b>{LAW[l.id].name}</b>{l.patron && <span class="tag gold" style={{ marginLeft: 6 }}>whispered</span>}
            <div class="story" style={{ fontStyle: 'normal' }}>{LAW[l.id].effect}</div>
            <span class="sub">Since Year {yearOf(l.since)}{s.people[l.by] ? <>, by <PersonLink p={s.people[l.by]} /></> : null}</span>
          </div>
        ))}
      </div>
      <div class="group">
        <h4>Faiths</h4>
        {faiths.length === 0 && <p class="note">No faith has taken hold yet. Omens, relics and answered prayers stir people; you can also Raise a Prophet.</p>}
        {faiths.map(({ f, n }) => (
          <div class="party" key={f.id}>
            <b>{cap(f.name)}</b> <span class="sub">· {n} {n === 1 ? 'follower' : 'followers'}</span>
            <div class="story">{f.tenets.map((t) => TENETS[t].text).join(' ')}</div>
            <span class="sub">Founded Year {yearOf(f.founded)}{s.people[f.founder] ? <> by <PersonLink p={s.people[f.founder]} /></> : null}{f.parent !== undefined ? `, breaking from ${s.faiths[f.parent]?.name}` : ''}. Holy day in {['spring', 'summer', 'autumn', 'winter'][f.season]}.</span>
          </div>
        ))}
        {faiths.length > 0 && <p class="sub">{faithless} people hold no faith.</p>}
      </div>
      <div class="group">
        <h4>Heirlooms</h4>
        {heirlooms.length === 0 && <p class="note">None yet. Things worth keeping come home from quests, from master crafters' hands, and as wedding gifts.</p>}
        {heirlooms.map((it) => {
          const holder = it.owner !== undefined ? s.people[it.owner] : undefined;
          const age = Math.floor((s.day - it.made) / 360);
          return (
            <div key={it.id} class="row" onClick={() => store.setUi({ item: it.id })}>
              <div class="who"><b>{cap(it.name)}</b><span>{it.village ? 'In the gathering place' : holder ? `${holder.first} ${holder.family}` : ''}{age ? ` · ${age} years old` : ''}{it.history.filter((h) => h.how === 'inherited').length ? ` · ${it.history.filter((h) => h.how === 'inherited').length + 1} generations` : ''}</span></div>
            </div>
          );
        })}
        {gone > 0 && <p class="sub">{gone} more lie in graves or were lost far away.</p>}
      </div>
      <div class="group">
        <h4>Animals</h4>
        <p>{herd ? `${herd} goats and sheep in the pens.` : 'No herds yet.'} {dogs ? `${dogs} ${dogs === 1 ? 'dog' : 'dogs'}` : ''}{dogs && cats ? ' and ' : ''}{cats ? `${cats} ${cats === 1 ? 'cat' : 'cats'}` : ''}{dogs || cats ? ' live with families.' : ''} {s.wild.deer > 0 ? `About ${s.wild.deer} deer in the woods nearby.` : 'No deer have been seen nearby in a long while.'}</p>
      </div>
      {sitesOf(s).length > 0 && (
        <div class="group">
          <h4>Sacred places</h4>
          {sitesOf(s).map((b) => (
            <div class="party" key={b.id} style={{ cursor: 'pointer' }} onClick={() => store.setUi({ selection: { kind: 'building', id: b.id } })}>
              <b>{cap(b.name ?? BUILDING_LABEL[b.kind])}</b> <span class="sub">{BUILDING_LABEL[b.kind].toLowerCase()}, found Year {yearOf(b.founded)}</span>
              <div class="sub">{(b.sacred ?? 0) >= 70 ? 'A holy place' : (b.sacred ?? 0) >= 35 ? 'People leave offerings here' : 'Not much visited yet'}{b.faith !== undefined && s.faiths[b.faith] ? `, kept by ${s.faiths[b.faith].name}` : ''}.</div>
            </div>
          ))}
        </div>
      )}
      {s.guilds.some((g) => !g.gone) && (
        <div class="group">
          <h4>Guilds</h4>
          {s.guilds.filter((g) => !g.gone).map((g) => {
            const m = g.master !== undefined ? s.people[g.master] : undefined;
            const n = s.people.filter((p) => p.alive && !p.left && p.away === undefined && p.job === g.trade && ageOf(s, p) >= 16).length;
            return (
              <div class="party" key={g.id}>
                <b>{cap(g.name)}</b> <span class="sub">since Year {yearOf(g.founded)} · {n} members</span>
                {m && <div class="sub">Master: <PersonLink p={m} /></div>}
              </div>
            );
          })}
        </div>
      )}
      <div class="group">
        <h4>Businesses</h4>
        {businesses.length === 0 && <p class="note">None yet. Kilns, forges and market stalls get names when they open.</p>}
        {businesses.map((b) => (
          <div key={b.id} class="row" onClick={() => store.setUi({ selection: { kind: 'building', id: b.id } })}>
            <div class="who"><b>{b.name}</b><span>{BUILDING_LABEL[b.kind]}{b.owner !== undefined && s.people[b.owner] ? ` · ${s.people[b.owner].first} ${s.people[b.owner].family}` : ''}{b.burned ? ' · burned' : ''}</span></div>
          </div>
        ))}
      </div>
    </>
  );
}
