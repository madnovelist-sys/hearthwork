// "How do you want to track your progress?" Time worked or words written.
// Only the fields for the chosen way are shown.
import type { Goals } from '../sim/types';

const clamp = (v: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

export function GoalFields({ goals, onChange }: { goals: Goals; onChange: (g: Goals) => void }) {
  const set = (patch: Partial<Goals>) => onChange({ ...goals, ...patch });
  const words = goals.track === 'words';
  return (
    <>
      <label>How do you want to track your progress?</label>
      <div class="traits" role="radiogroup">
        <button type="button" role="radio" aria-checked={!words} class={`chip${!words ? ' on' : ''}`} onClick={() => set({ track: 'time' })}>Time worked</button>
        <button type="button" role="radio" aria-checked={words} class={`chip${words ? ' on' : ''}`} onClick={() => set({ track: 'words' })}>Words written</button>
      </div>
      {words ? (
        <div class="two">
          <div>
            <label>Daily goal</label>
            <input type="number" min={50} max={20000} step={50} value={goals.dailyWords} onChange={(e) => set({ dailyWords: clamp((e.target as HTMLInputElement).value, 50, 20000) })} />
            <div class="hint">words a day</div>
          </div>
          <div>
            <label>A Spark every</label>
            <input type="number" min={50} max={5000} step={50} value={goals.sparkWords} onChange={(e) => set({ sparkWords: clamp((e.target as HTMLInputElement).value, 50, 5000) })} />
            <div class="hint">words</div>
          </div>
        </div>
      ) : (
        <div class="two">
          <div>
            <label>Daily goal</label>
            <input type="number" min={5} max={720} value={goals.dailyMinutes} onChange={(e) => set({ dailyMinutes: clamp((e.target as HTMLInputElement).value, 5, 720) })} />
            <div class="hint">minutes a day</div>
          </div>
          <div>
            <label>A Spark every</label>
            <input type="number" min={5} max={120} value={goals.sparkMinutes} onChange={(e) => set({ sparkMinutes: clamp((e.target as HTMLInputElement).value, 5, 120) })} />
            <div class="hint">minutes</div>
          </div>
        </div>
      )}
      <p class="hint">
        {words
          ? 'You still press Start and Stop so the city knows when you\'re working. At the end of each session, you enter how many words you wrote.'
          : 'The timer does it all: press Start when you begin and Stop when you take a break.'}
        {' '}Each Spark is kept, to spend on calling someone to your village or on Acts; reaching your daily goal earns 3 more.
      </p>
    </>
  );
}
