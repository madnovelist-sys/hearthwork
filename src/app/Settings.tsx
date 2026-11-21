// Settings: goals, the two sliders, saves and backups, the art test scene.
import { useEffect, useState } from 'preact/hooks';
import { archiveVillage, deleteSave, forgetVillage, listBackups, listVillages, loadBackup, parseSave, saveVillageToFile, takeVillage, type VillageInfo } from '../game/save';
import { openTextFile } from '../game/files';
import { store } from '../game/store';
import { exportChronicle } from './Chronicle';
import { GoalFields } from './GoalFields';
import { askNotificationPermission, canDetectAway, isDesktop } from '../game/desktop';

const DARK_LABEL = (d: number) => (d < 34 ? 'Gentle' : d < 67 ? 'Balanced' : 'Grim');
const WEIRD_LABEL = ['Historical', 'Folklore', 'Uncanny', 'Mythic', 'Fantastical'];
export const WEIRD_HINT = [
  'Nothing uncanny. Omens are weather and comets.',
  'Ambiguous things: a humming stone, lights over the marsh.',
  'Strange ruins, giant bones, glowing relics.',
  'Beasts beyond the walls, oracles, alchemy.',
  'Open magic: floating stones, living buildings.',
];
export const DARK_HINT = (d: number) => (d < 34
  ? 'Few avoidable deaths. Hunger makes people weak, not dead. Hard things are told softly.'
  : d < 67
    ? 'A pre-modern life: fevers, accidents and childbirth take some. Told plainly.'
    : 'Hard lives. Children die, winters kill, and the Chronicle does not look away. No gore.');

export function SettingsPanel() {
  const s = store.state!;
  const [backups, setBackups] = useState<string[]>([]);
  useEffect(() => { listBackups().then(setBackups); }, []);
  const g = s.goals;
  const restore = async (date: string) => {
    const b = await loadBackup(date);
    if (b) { store.setState(b); store.toast(`Restored the backup from ${date}.`); }
  };
  return (
    <div class="form">
      <VillageSection />

      <h4 style={{ margin: '16px 0 4px' }}>Goals</h4>
      <GoalFields goals={g} onChange={(next) => { Object.assign(g, next); store.changed(); }} />

      <h4 style={{ margin: '16px 0 4px' }}>While you work</h4>
      <label>Pause when I've been away from my computer for</label>
      <select disabled={!canDetectAway()} value={canDetectAway() ? s.settings.awayMinutes : 0}
        onChange={(e) => { s.settings.awayMinutes = Number((e.target as HTMLSelectElement).value); store.changed(); }}>
        <option value={0}>Never</option>
        {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
      </select>
      <p class="hint">
        {canDetectAway()
          ? "If there's no keyboard or mouse activity for that long, the session pauses at the moment you left, and you're asked whether to count the time away."
          : isDesktop ? 'Not available on this computer yet.' : 'Available in the Mac app.'}
      </p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400 }}>
        <input type="checkbox" checked={s.settings.notify} onChange={async (e) => {
          const on = (e.target as HTMLInputElement).checked;
          s.settings.notify = on && (await askNotificationPermission());
          if (on && !s.settings.notify) store.toast('Notifications are turned off for Hearthwork in your system settings.');
          store.changed();
        }} />
        Notify me about Sparks and my daily goal
      </label>
      <p class="hint">Only while Hearthwork isn't in front of you. Off by default, so nothing interrupts your work.</p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400 }}>
        <input type="checkbox" checked={!!s.settings.stopAt} onChange={(e) => { s.settings.stopAt = (e.target as HTMLInputElement).checked ? '18:00' : null; store.changed(); }} />
        End my session automatically at
        <input type="time" value={s.settings.stopAt ?? '18:00'} disabled={!s.settings.stopAt} style={{ width: 'auto' }}
          onChange={(e) => { const v = (e.target as HTMLInputElement).value; if (v) { s.settings.stopAt = v; store.changed(); } }} />
      </label>
      <p class="hint">A running session stops at that time, and the time before it counts. Starting again later that evening is up to you.</p>

      <h4 style={{ margin: '16px 0 4px' }}>Day and night</h4>
      <div class="traits" role="radiogroup">
        <button type="button" class={`chip${s.settings.dayNight !== 'city' ? ' on' : ''}`} onClick={() => { s.settings.dayNight = 'clock'; store.changed(); }}>Follow my clock</button>
        <button type="button" class={`chip${s.settings.dayNight === 'city' ? ' on' : ''}`} onClick={() => { s.settings.dayNight = 'city'; store.changed(); }}>The city's own days</button>
      </div>
      <p class="hint">{s.settings.dayNight === 'city'
        ? 'A day in the city passes every 15 minutes of work, so you see sunrises and sunsets while you work. The sky stays put while you rest.'
        : "The sky over the city matches the time where you are: work late, and it's night there too."}</p>

      <h4 style={{ margin: '16px 0 4px' }}>Darkness: {DARK_LABEL(s.settings.darkness)}</h4>
      <input class="slider" type="range" min={0} max={100} value={s.settings.darkness} onInput={(e) => { s.settings.darkness = Number((e.target as HTMLInputElement).value); store.changed(); }} />
      <div class="slider-labels"><span>Gentle</span><span>Balanced</span><span>Grim</span></div>
      <p class="hint">{DARK_HINT(s.settings.darkness)}</p>

      <h4 style={{ margin: '16px 0 4px' }}>Weirdness: {WEIRD_LABEL[s.settings.weirdness]}</h4>
      <input class="slider" type="range" min={0} max={4} step={1} value={s.settings.weirdness} onInput={(e) => { s.settings.weirdness = Number((e.target as HTMLInputElement).value); store.changed(); }} />
      <div class="slider-labels">{WEIRD_LABEL.map((w) => <span key={w}>{w}</span>)}</div>
      <p class="hint">{WEIRD_HINT[s.settings.weirdness]}</p>

      <h4 style={{ margin: '16px 0 6px' }}>More</h4>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button class="btn small" type="button" onClick={() => exportChronicle()}>Save the Chronicle to a file</button>
        <button class="btn small" type="button" onClick={() => store.setUi({ panel: 'art' })}>Art test scene</button>
      </div>
      {backups.length > 0 && (
        <>
          <label>Restore a daily backup of {s.name}</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {backups.map((b) => <button key={b} type="button" class="btn small" onClick={() => restore(b)}>{b}</button>)}
          </div>
        </>
      )}
    </div>
  );
}

/** Saving the village to a file, opening one, starting a new village, and the villages put away. */
function VillageSection() {
  const s = store.state!;
  const [villages, setVillages] = useState<VillageInfo[]>([]);
  const [asking, setAsking] = useState(false);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const refresh = () => { listVillages().then(setVillages); };
  useEffect(refresh, []);
  const saveToFile = async () => {
    try {
      if (await saveVillageToFile(s)) store.toast(`${s.name} was saved to a file.`, 'gold');
    } catch (e) {
      store.toast(`Couldn't save the file: ${(e as Error).message ?? e}`);
    }
  };
  const openFile = async () => {
    try {
      const text = await openTextFile();
      if (!text) return;
      const next = parseSave(text);
      if (next.seed !== s.seed) await archiveVillage(s); // keep the one you had
      store.setState(next);
      store.toast(`Opened ${next.name}.${next.seed !== s.seed ? ` ${s.name} is kept under Your other villages.` : ''}`);
    } catch (e) {
      store.toast((e as Error).message);
    }
  };
  const startNew = async () => {
    await store.save();
    await archiveVillage(s);
    await deleteSave();
    store.setState(null);
  };
  const switchTo = async (key: string) => {
    await store.save();
    await archiveVillage(s);
    const next = await takeVillage(key);
    if (next) { store.setState(next); store.toast(`Back in ${next.name}.`); }
  };
  return (
    <>
      <h4 style={{ margin: '0 0 6px' }}>Your village</h4>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button class="btn small" type="button" onClick={saveToFile}>Save {s.name} to a file…</button>
        <button class="btn small" type="button" onClick={openFile}>Open a village file…</button>
        <button class="btn small" type="button" onClick={() => setAsking(true)}>Start a new village…</button>
      </div>
      <p class="hint">{s.name} is saved on this computer every 30 seconds, with a backup from each of the last 7 days. A saved file is a complete copy you can keep anywhere, or open on another computer.</p>
      {asking && (
        <div class="note">
          Start a new village? {s.name} will be kept, and you can come back to it here any time.
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button class="btn small primary" type="button" onClick={startNew}>Start a new village</button>
            <button class="btn small ghost" type="button" onClick={() => setAsking(false)}>Not now</button>
          </div>
        </div>
      )}
      {villages.length > 0 && (
        <>
          <label>Your other villages</label>
          {villages.map((v) => (
            <div class="party" key={v.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}><b>{v.name}</b> <span class="sub">Year {v.year} · {v.people} people</span></div>
              <button class="btn small" type="button" onClick={() => switchTo(v.key)}>Go there</button>
              {forgetting === v.key
                ? <button class="btn small" type="button" onClick={async () => { await forgetVillage(v.key); setForgetting(null); refresh(); }}>Delete for good</button>
                : <button class="btn small ghost" type="button" onClick={() => setForgetting(v.key)}>Delete</button>}
            </div>
          ))}
        </>
      )}
    </>
  );
}
