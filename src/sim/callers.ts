// Calling someone with Sparks. People come to the settlement on their own when
// it does well; spending Sparks calls someone particular: one of three
// travelers, each different, each carrying a story that will come back years
// later (a sealed jar, a feud, a husband thought dead, a foundling's gift).
import { pickLand, waysOf } from './culture';
import { log, P } from './chronicle';
import { familyName } from './names';
import { draftPerson } from './people';
import { chance, int, pick, rand, shuffle } from './rng';
import { fromLine, settleParty } from './arrivals';
import { makeItem } from './items';
import { findPlace } from './places';
import { candidates, discovery, nextCost } from './ages';
import { endPlague } from './calamity';
import { foundFaith, plantFaithSeed } from './society';
import { killPerson } from './life';
import { DAYS_PER_YEAR, type GameState, type Party, type Person, type PersonDraft, type TraitId } from './types';
import { ageOf, darkFactor, present } from './world';

/** Sparks to call someone. */
export const CALL_COST = 3;

const PLACES = ['the salt marshes', 'the hill country to the west', 'a fishing village on the coast', 'the high valleys', 'the river mouth', 'the forest villages to the north', 'a town three weeks away'];
const Y = DAYS_PER_YEAR;
const they = (p: { sex: string }) => (p.sex === 'f' ? 'she' : 'he');
const them = (p: { sex: string }) => (p.sex === 'f' ? 'her' : 'him');
const their = (p: { sex: string }) => (p.sex === 'f' ? 'her' : 'his');
const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

interface Caller {
  id: string;
  title: string;
  /** Whether this story can happen here and now. */
  can?: (s: GameState) => boolean;
  make: (s: GameState) => { people: PersonDraft[]; story: string };
  /** Right after they arrive. */
  arrive?: (s: GameState, people: Person[]) => void;
  /** Years until the story comes back: [min, max]. */
  due: [number, number];
  /** Whose story it is (index into the party). */
  holder?: number;
  /** The story comes back. Return true when it's done. */
  resolve: (s: GameState, p: Person) => boolean;
}

const CALLERS: Caller[] = [
  {
    id: 'jar', title: 'The sealed jar', due: [14, 30],
    make: (s) => {
      const p = draftPerson(s.rng, { age: int(s.rng, 30, 50), sex: 'f', traits: ['stubborn', pick(s.rng, ['shy', 'kind', 'honest'] as const)] });
      return { people: [p], story: `${p.first} ${p.family} walked in from ${pick(s.rng, PLACES)} carrying a clay jar, sealed with pitch, that she would not open and would not explain. She keeps it beside her bed.` };
    },
    resolve: (s, p) => {
      const who = p.alive ? `${P(p.id)} finally broke the seal on her jar` : `After ${P(p.id)} died, her family broke the seal on her jar`;
      const roll = rand(s.rng);
      if (roll < 0.35) {
        s.lore.points += nextCost(s) * 0.6;
        log(s, 'return', `${who}. Inside were seeds nobody in ${s.name} had ever seen. Planted in the spring, they grew into something good to eat, and the farmers argued for years about the best way to grow it.`, [p.id], 6, `The Year of ${p.first}'s Jar`);
      } else if (roll < 0.65) {
        const heir = p.alive ? p : s.people.find((c) => p.children.includes(c.id) && c.alive) ?? present(s)[0];
        if (heir) makeItem(s, 'stone', heir, 'found', `the Figure from ${p.first}'s Jar`);
        log(s, 'return', `${who}. Inside, wrapped in fleece, was a little figure of bronze, a woman with her arms raised, older than anything in ${s.name}. It is kept still.`, [p.id], 6, `The Year of ${p.first}'s Jar`);
      } else if (roll < 0.85 && darkFactor(s) >= 1) {
        log(s, 'return', `${who}. Inside was a lock of a child's hair and a tiny bracelet of bone. Nobody ever learned whose they were, and nobody asked.`, [p.id], 6);
      } else {
        log(s, 'return', `${who}. It was empty. Whatever she had been keeping, she had kept it somewhere else all along.`, [p.id], 5);
      }
      return true;
    },
  },
  {
    id: 'feud', title: 'Running from a feud', due: [5, 14],
    make: (s) => {
      const p = draftPerson(s.rng, { age: int(s.rng, 22, 38), sex: pick(s.rng, ['f', 'm'] as const), skill: 'smith', traits: ['brave', pick(s.rng, ['cunning', 'honest', 'stubborn'] as const)] });
      return { people: [p], story: `${p.first} ${p.family}, a smith, fled ${pick(s.rng, PLACES)} after a killing in a feud between two families. ${cap(they(p))} swears it was not ${their(p)} doing. ${cap(they(p))} says no one will come looking.` };
    },
    resolve: (s, p) => {
      if (!p.alive || p.away !== undefined) return true;
      const enemy = familyName(s.rng);
      const roll = rand(s.rng);
      if (roll < 0.4) {
        const d = draftPerson(s.rng, { age: int(s.rng, 25, 45), family: enemy });
        const [newcomer] = settleParty(s, { id: s.nextId.party++, story: '', people: [d] }, false, true);
        p.renown += 25;
        log(s, 'arrival', `The ${enemy}s came looking for ${P(p.id)} at last, armed. ${cap(they(p))} walked out alone to meet them, and talked until dark. In the end they went home, all but ${P(newcomer.id)}, who stayed, and in time became ${their(p)} friend.`, [p.id, newcomer.id], 7, `The Year of the ${enemy} Feud`);
      } else if (roll < 0.75 || darkFactor(s) < 0.6) {
        s.stores.goods = Math.max(0, s.stores.goods * 0.8);
        log(s, 'leader', `The ${enemy}s came looking for ${P(p.id)}. ${s.name} paid them off with a fifth of its goods rather than hand ${them(p)} over, and some people never forgave ${them(p)} for it.`, [p.id], 6, `The Year of the ${enemy} Feud`);
      } else {
        killPerson(s, p, 'the feud', `The ${enemy}s came for ${P(p.id)} in the night, as ${they(p)} had always known they would. By morning they were gone, and so was ${they(p) === 'she' ? 'she' : 'he'}.`, 3);
      }
      return true;
    },
  },
  {
    id: 'twins', title: 'Twins who remember', due: [2, 6], holder: 1,
    can: (s) => s.settings.weirdness >= 1,
    make: (s) => {
      const family = familyName(s.rng);
      const m = draftPerson(s.rng, { age: int(s.rng, 26, 36), family, sex: 'f', orientation: 'straight' });
      const a = draftPerson(s.rng, { age: 8, family, parentsIdx: [0] });
      const b = draftPerson(s.rng, { age: 8, family, parentsIdx: [0], sex: a.sex });
      a.first === b.first && (b.first = b.sex === 'f' ? 'Wren' : 'Tam');
      return { people: [m, a, b], story: `${m.first} ${family} and her twins, ${a.first} and ${b.first}, who had never been here before, and yet knew the names of the hills, and asked where the old path to the water had gone.` };
    },
    resolve: (s, p) => {
      const site = findPlace(s, p.alive ? p : undefined);
      if (site) log(s, 'omen', `${P(p.id)} said ${they(p)} had been there before, long ago, and walked straight to it.`, [p.id], 4);
      if (s.settings.weirdness >= 2) plantFaithSeed(s, 'ancestors');
      return true;
    },
  },
  {
    id: 'exile', title: 'A chief without a village', due: [4, 10],
    can: (s) => s.stage !== 'settlement',
    make: (s) => {
      const p = draftPerson(s.rng, { age: int(s.rng, 40, 52), sex: pick(s.rng, ['f', 'm'] as const), traits: ['ambitious', pick(s.rng, ['gregarious', 'cunning', 'brave'] as const)] });
      return { people: [p], story: `${p.first} ${p.family} was chief of a village in ${pick(s.rng, PLACES)} until ${their(p)} own people turned ${them(p)} out. ${cap(they(p))} says ${they(p)} only wants a quiet life now.` };
    },
    arrive: (_s, [p]) => { p.renown += 30; },
    resolve: (s, p) => {
      if (!p.alive || p.away !== undefined) return true;
      const current = s.leader ? s.people[s.leader.person] : undefined;
      if (current?.id === p.id) return true;
      if (!current || !current.alive || rand(s.rng) < 0.5) {
        s.leader = { person: p.id, since: s.day };
        p.renown += 30;
        log(s, 'leader', `So much for a quiet life: ${P(p.id)} gathered enough friends to be chosen chief of ${s.name}${current ? ` over ${P(current.id)}` : ''}.`, current ? [p.id, current.id] : [p.id], 7, `The Year ${p.first} Took the Seat`);
      } else {
        log(s, 'leader', `${P(p.id)} tried to make ${them(p)}self chief of ${s.name} and failed, and afterward really did seem to want a quiet life.`, [p.id], 4);
      }
      return true;
    },
  },
  {
    id: 'healer', title: 'A healer with old knowledge', due: [1, 2],
    make: (s) => {
      const p = draftPerson(s.rng, { age: int(s.rng, 42, 60), skill: 'healer', traits: ['kind', pick(s.rng, ['curious', 'stubborn', 'gloomy'] as const)] });
      return { people: [p], story: `${p.first} ${p.family}, a healer from ${pick(s.rng, PLACES)}, who knows plants nobody here has a name for, and has seen a sickness burn through a whole valley.` };
    },
    arrive: (s, [p]) => {
      const herbs = discovery('herbals');
      if (herbs && candidates(s).includes(herbs)) s.lore.nudge = { person: p.id, until: s.day + 6 * Y };
    },
    resolve: (s, p) => {
      if (!p.alive) return true;
      if (s.plague) {
        log(s, 'plague', `${P(p.id)} had seen ${s.plague.name} before. ${cap(they(p))} knew to burn the bedding and boil the water, and the sickness lost its grip.`, [p.id], 6);
        p.renown += 25;
        endPlague(s, false);
        return true;
      }
      p.hook!.due = s.day + Y; // keep watching, for as long as they live
      return ageOf(s, p) > 80;
    },
  },
  {
    id: 'bride', title: 'A runaway bride', due: [2, 6],
    make: (s) => {
      const p = draftPerson(s.rng, { age: int(s.rng, 17, 21), sex: 'f', orientation: 'straight', traits: ['brave', pick(s.rng, ['stubborn', 'cheerful', 'restless'] as const)] });
      return { people: [p], story: `${p.first} ${p.family} ran from her own wedding feast in ${pick(s.rng, PLACES)}, in her wedding cloak, and didn't stop running until she saw the fire.` };
    },
    resolve: (s, p) => {
      if (!p.alive || p.away !== undefined) return true;
      const groom = draftPerson(s.rng, { age: Math.max(20, ageOf(s, p) + int(s.rng, 1, 6)), sex: 'm', orientation: 'straight' });
      const roll = rand(s.rng);
      if (roll < 0.45) {
        const [g] = settleParty(s, { id: s.nextId.party++, story: '', people: [groom] }, false, true);
        log(s, 'arrival', `The man ${P(p.id)} ran from came looking for her, ${p.spouse !== undefined ? 'found her married, and laughed about it' : 'and found her unmoved'}. He liked ${s.name}, though, and stayed: ${P(g.id)}.`, [p.id, g.id], 6);
      } else if (roll < 0.8) {
        makeItem(s, 'ring', p, 'brought', `${p.first}'s Mother's Ring`);
        log(s, 'arrival', `${P(p.id)}'s mother walked all the way from her old village to find her, with her own ring to give her. They sat by the fire all night.`, [p.id], 5);
      } else if (darkFactor(s) >= 1 && p.spouse === undefined) {
        p.left = true;
        p.alive = false;
        p.died = s.day;
        p.cause = 'moved away';
        p.courting = undefined;
        log(s, 'departure', `${P(p.id)}'s brothers came for her and took her home. She did not look back, and nobody in ${s.name} could tell whether she wanted to.`, [p.id], 6);
      } else {
        log(s, 'arrival', `Word came that the man ${P(p.id)} had run from had married someone else. She laughed until she cried.`, [p.id], 3);
      }
      return true;
    },
  },
  {
    id: 'storyteller', title: 'An old storyteller', due: [6, 14],
    make: (s) => {
      const p = draftPerson(s.rng, { age: int(s.rng, 60, 70), traits: ['gregarious', pick(s.rng, ['cheerful', 'clever', 'gloomy'] as const)] });
      return { people: [p], story: `Old ${p.first} ${p.family}, who has walked from village to village all ${their(p)} life telling stories for a meal and a place by the fire, and says this fire is the last one.` };
    },
    arrive: (s) => { s.lore.points += nextCost(s) * 0.25; },
    resolve: (s, p) => {
      if (p.alive && ageOf(s, p) < 85) { p.hook!.due = s.day + 2 * Y; return false; }
      const kids = present(s).filter((c) => ageOf(s, c) >= 10 && ageOf(s, c) < 20);
      const heir = kids.length ? pick(s.rng, kids) : undefined;
      if (heir) {
        if (!heir.traits.includes('curious')) heir.traits.push('curious');
        heir.renown += 15;
      }
      log(s, 'death', `${P(p.id)}'s stories outlived ${them(p)}.${heir ? ` ${P(heir.id)}, who had sat closest to the fire every night, knew every one of them by heart, and went on telling them.` : ''}`, heir ? [p.id, heir.id] : [p.id], 5);
      return true;
    },
  },
  {
    id: 'stranger', title: 'A stranger from far away', due: [3, 6],
    make: (s) => {
      const p = draftPerson(s.rng, { age: int(s.rng, 24, 40), traits: ['curious', pick(s.rng, ['shy', 'clever', 'kind'] as const)] });
      p.family = pick(s.rng, ['Oyelu', 'Tarsk', 'Imhal', 'Querin', 'Azdar', 'Mosk']);
      return { people: [p], story: `A stranger who speaks no tongue anyone here knows walked in with the evening, wearing clothes of a cut nobody has seen. ${cap(they(p))} draws pictures in the dirt to explain. People call ${them(p)} ${p.first}.` };
    },
    resolve: (s, p) => {
      if (!p.alive) return true;
      const idea = candidates(s)[0];
      s.lore.points += nextCost(s) * 0.7;
      log(s, 'return', `${P(p.id)} had learned enough of the language at last to tell where ${they(p)} came from: a land months away, where ${pick(s.rng, ['the rivers run backward in summer', 'people build in stone', 'the hills smoke', 'there is no winter at all'])}. ${idea ? 'Some of what ' + they(p) + ' described set people thinking.' : ''}`, [p.id], 6);
      return true;
    },
  },
  {
    id: 'widow', title: 'A widow and her children', due: [6, 14],
    make: (s) => {
      const family = familyName(s.rng);
      const m = draftPerson(s.rng, { age: int(s.rng, 28, 38), family, sex: 'f', orientation: 'straight' });
      const kids = [0, 1, 2].map(() => draftPerson(s.rng, { age: int(s.rng, 2, 12), family, parentsIdx: [0] }));
      return { people: [m, ...kids], story: `${m.first} ${family} and her three children. Her husband went off with a war band two summers ago and never came home. She has stopped waiting.` };
    },
    resolve: (s, p) => {
      if (!p.alive) return true;
      const husband = draftPerson(s.rng, { age: ageOf(s, p) + int(s.rng, 1, 5), family: p.family, sex: 'm', orientation: 'straight', traits: ['gloomy', pick(s.rng, ['brave', 'timid', 'kind'] as const)] });
      const [h] = settleParty(s, { id: s.nextId.party++, story: '', people: [husband] }, false, true);
      for (const c of p.children) { const k = s.people[c]; if (k?.alive && !h.children.includes(k.id)) { h.children.push(k.id); k.parents.push(h.id); } }
      if (p.spouse === undefined) {
        p.spouse = h.id; h.spouse = p.id; h.home = p.home;
        log(s, 'return', `A man came up the river path, thin and scarred, and stood at the edge of the fire until ${P(p.id)} looked up. It was ${P(h.id)}, her husband, years after she had stopped waiting. Nobody spoke for a long time.`, [p.id, h.id], 9, `The Year ${h.first} Came Home`);
      } else {
        log(s, 'return', `${P(h.id)}, ${P(p.id)}'s first husband, came home from the war band at last, and found her married to ${P(p.spouse)}. He stayed in ${s.name}, near his children, and the three of them learned to be polite.`, [p.id, h.id], 9, `The Year ${h.first} Came Home`);
      }
      return true;
    },
  },
  {
    id: 'foundling', title: 'A foundling', due: [16, 18],
    can: (s) => present(s).some((p) => p.spouse !== undefined && p.sex === 'f' && ageOf(s, p) < 45),
    make: (s) => {
      const p = draftPerson(s.rng, { age: 0, traits: shuffle(s.rng, ['curious', 'clever', 'brave', 'kind', 'restless'] as TraitId[]).slice(0, 2) });
      return { people: [p], story: `A baby, found at dawn at the edge of the woods, wrapped in a fine wool blanket with no one anywhere near. Whoever left ${them(p)} wanted ${them(p)} found.` };
    },
    arrive: (s, [baby]) => {
      // Taken in by a family with room for one more.
      const mothers = present(s).filter((p) => p.spouse !== undefined && p.sex === 'f' && ageOf(s, p) < 45).sort((a, b) => a.children.length - b.children.length);
      const m = mothers[0];
      if (!m) return;
      const f = s.people[m.spouse!];
      baby.parents = [m.id, f.id];
      m.children.push(baby.id); f.children.push(baby.id);
      baby.family = m.family;
      baby.home = m.home;
      log(s, 'orphan', `${P(m.id)} and ${P(f.id)} took the foundling in and called ${them(baby)} ${baby.first}.`, [m.id, f.id, baby.id], 4);
    },
    resolve: (s, p) => {
      if (!p.alive) return true;
      p.renown += 20;
      s.lore.nudge = { person: p.id, until: s.day + 5 * Y };
      const odd = s.settings.weirdness >= 2 ? ` In all those years ${they(p)} had never once been ill.` : '';
      log(s, 'comingOfAge', `${P(p.id)}, the foundling, had grown into someone people listened to: quick, strange and gifted.${odd} Some said ${they(p)} would find something nobody had thought to look for.`, [p.id], 6);
      return true;
    },
  },
  {
    id: 'wanderer', title: 'A wanderer of the hills', due: [1, 2],
    make: (s) => {
      const p = draftPerson(s.rng, { age: int(s.rng, 26, 45), traits: ['restless', pick(s.rng, ['brave', 'curious', 'content'] as const)] });
      return { people: [p], story: `${p.first} ${p.family}, who has spent half a life walking the hills alone and knows every path for twenty miles. ${cap(they(p))} says there are things out there nobody in ${s.name} has seen.` };
    },
    resolve: (s, p) => {
      if (!p.alive || p.away !== undefined) return true;
      findPlace(s, p);
      return true;
    },
  },
  {
    id: 'deserter', title: 'A deserter', due: [3, 8],
    make: (s) => {
      const p = draftPerson(s.rng, { age: int(s.rng, 18, 26), traits: [pick(s.rng, ['timid', 'kind', 'honest'] as const), 'strong'] });
      return { people: [p], story: `${p.first} ${p.family} ran away from a war band that has been raiding the valleys to the south, and begs to be let in. ${cap(they(p))} jumps at every noise in the night.` };
    },
    resolve: (s, p) => {
      if (!p.alive || p.away !== undefined) return true;
      const roll = rand(s.rng);
      if (roll < 0.4) {
        log(s, 'omen', `The war band ${P(p.id)} ran from passed along the far side of the river and never knew ${s.name} was there. ${P(p.id)} stopped jumping at noises after that.`, [p.id], 5);
      } else if (roll < 0.75) {
        s.stores.food *= 0.75;
        log(s, 'hunger', `The war band ${P(p.id)} ran from came through, took a quarter of the stores, and left. They did not see ${P(p.id)}, hidden under the fishing nets.`, [p.id], 6, 'The Year of the War Band');
      } else {
        p.renown += 40;
        if (darkFactor(s) >= 1 && chance(s.rng, 0.5)) {
          killPerson(s, p, 'the war band', `When the war band ${P(p.id)} had fled came looking for ${them(p)}, ${they(p)} walked out to meet them so they would leave ${s.name} alone. They did. ${cap(they(p))} never came back.`, 4);
        } else {
          log(s, 'return', `When the war band came looking for ${P(p.id)}, ${they(p)} walked out to meet them so they would leave ${s.name} alone. They did, and somehow, days later, ${they(p)} came home.`, [p.id], 7, `The Year ${p.first} Walked Out`);
        }
      }
      return true;
    },
  },
  {
    id: 'flute', title: 'A flute player', due: [30, 50],
    make: (s) => {
      const p = draftPerson(s.rng, { age: int(s.rng, 20, 34), traits: ['cheerful', pick(s.rng, ['gregarious', 'shy', 'restless'] as const)] });
      return { people: [p], story: `${p.first} ${p.family}, who plays a flute carved from a crane's bone and can make a whole room go quiet with it.` };
    },
    arrive: (s, [p]) => { makeItem(s, 'flute', p, 'brought', `${p.first}'s Bone Flute`); for (const q of present(s)) q.mood += 3; },
    resolve: (s, p) => {
      if (p.alive && ageOf(s, p) < 75) { p.hook!.due = s.day + 5 * Y; return false; }
      log(s, 'death', `${P(p.id)}'s tunes were still played at every wedding in ${s.name}, long after anyone remembered who had made them up.`, [p.id], 5);
      return true;
    },
  },
  {
    id: 'heir', title: "The last of a chief's line", due: [10, 14], holder: 1,
    make: (s) => {
      const family = familyName(s.rng);
      const g = draftPerson(s.rng, { age: int(s.rng, 56, 66), family });
      const b = draftPerson(s.rng, { age: int(s.rng, 9, 13), family, traits: ['brave', pick(s.rng, ['ambitious', 'kind', 'stubborn'] as const)] });
      return { people: [g, b], story: `Old ${g.first} ${family} and ${b.first}, ${g.sex === 'f' ? 'her' : 'his'} grandchild, the last of a line of chiefs from ${pick(s.rng, PLACES)}. The child wears a torc of twisted bronze that is far too big.` };
    },
    arrive: (s, [, b]) => { makeItem(s, 'torc', b, 'brought', `the Torc of the ${b.family}s`); },
    resolve: (s, p) => {
      if (!p.alive || p.away !== undefined) return true;
      p.renown += 30;
      const current = s.leader ? s.people[s.leader.person] : undefined;
      if (s.stage !== 'settlement' && (!current || !current.alive || rand(s.rng) < 0.4)) {
        s.leader = { person: p.id, since: s.day };
        log(s, 'leader', `${P(p.id)} had grown into the torc at last, and ${s.name} chose ${them(p)} to lead.`, [p.id], 7, `The Year ${p.first} Took the Seat`);
      } else {
        log(s, 'comingOfAge', `${P(p.id)} had grown into the torc at last. People said ${they(p)} would lead one day.`, [p.id], 4);
      }
      return true;
    },
  },
  {
    id: 'lovers', title: 'Lovers from rival villages', due: [4, 9],
    make: (s) => {
      const a = draftPerson(s.rng, { age: int(s.rng, 18, 24), orientation: 'straight' });
      const b = draftPerson(s.rng, { age: int(s.rng, 18, 24), sex: a.sex === 'f' ? 'm' : 'f', orientation: 'straight', spouseOf: 0 });
      a.spouseOf = 1;
      b.family = a.family;
      return { people: [a, b], story: `${a.first} and ${b.first}, from two villages that have hated each other for three generations. They married in secret, and ran before either family could stop them.` };
    },
    resolve: (s, p) => {
      if (!p.alive) return true;
      const kin = [0, 1].map(() => draftPerson(s.rng, { age: int(s.rng, 40, 60) }));
      const made = settleParty(s, { id: s.nextId.party++, story: '', people: kin }, false, true);
      s.stores.goods += 40;
      log(s, 'arrival', `Both of ${P(p.id)}'s families came at last: ${P(made[0].id)} from one side and ${P(made[1].id)} from the other. They glared at each other across the fire, held the grandchildren, and stayed.`, [p.id, ...made.map((m) => m.id)], 7);
      return true;
    },
  },
  {
    id: 'fool', title: 'One who sees things', due: [2, 6],
    can: (s) => s.settings.weirdness >= 1,
    make: (s) => {
      const p = draftPerson(s.rng, { age: int(s.rng, 25, 50), traits: ['pious', pick(s.rng, ['gloomy', 'cheerful', 'shy'] as const)] });
      return { people: [p], story: `${p.first} ${p.family}, whom ${their(p)} old village called touched. ${cap(they(p))} talks to the fire, and sometimes it seems to answer.` };
    },
    resolve: (s, p) => {
      if (!p.alive) return true;
      plantFaithSeed(s, 'hearth');
      if (s.settings.weirdness >= 3 && !s.faiths.some((f) => !f.gone && f.founder === p.id)) {
        const f = foundFaith(s, p, ['hearth', 'comet']);
        log(s, 'faith', `${P(p.id)} stood up at the fire one night and said what the fire had been telling ${them(p)} all these years. By spring, ${f.name} had followers.`, [p.id], 7);
      } else {
        log(s, 'omen', `${P(p.id)} said there would be a hard winter, three days before the first snow. After that people listened when ${they(p)} talked to the fire.`, [p.id], 4);
      }
      return true;
    },
  },
];

const BY_ID = new Map(CALLERS.map((c) => [c.id, c]));

/** Three people who could come, if called: each a different story, and never one already told. */
export function makeCallOptions(s: GameState): Party[] {
  const told = new Set(s.flags.called ?? []);
  let pool = CALLERS.filter((c) => (c.can?.(s) ?? true) && !told.has(c.id));
  if (pool.length < 3) pool = CALLERS.filter((c) => c.can?.(s) ?? true); // every story told: start again
  return shuffle(s.rng, pool.slice()).slice(0, 3).map((c) => {
    const { people, story } = c.make(s);
    const land = pickLand(s);
    for (const d of people) { d.land = land.id; d.customs = waysOf(s, land); }
    return { id: s.nextId.party++, story, people, call: c.id, title: c.title, land: land.id };
  });
}

/** The three waiting to be called (made once, so they don't change each time you look). */
export function callOptions(s: GameState): Party[] {
  if (!s.calling?.length) s.calling = makeCallOptions(s);
  return s.calling;
}

export type CallResult = { ok: true } | { ok: false; reason: string };

/** Spend Sparks to call one of the three. They come now while you work, or at dawn. */
export function call(s: GameState, partyId: number, now: boolean): CallResult {
  const party = s.calling?.find((p) => p.id === partyId);
  if (!party) return { ok: false, reason: 'They are no longer on the road.' };
  if ((s.sparks ?? 0) < CALL_COST) return { ok: false, reason: `Calling someone takes ${CALL_COST} Sparks.` };
  s.sparks -= CALL_COST;
  s.calling = undefined;
  s.flags.called = [...(s.flags.called ?? []), party.call!];
  if (now) arriveCalled(s, party);
  else s.pending.push({ kind: 'party', party });
  return { ok: true };
}

/** Someone you called arrives, carrying their story. */
export function arriveCalled(s: GameState, party: Party) {
  const c = party.call ? BY_ID.get(party.call) : undefined;
  const created = settleParty(s, party, false, true);
  let story = party.story;
  for (const p of created) story = story.replace(new RegExp(`\\b${p.first}\\b`), `{f:${p.id}}`);
  log(s, 'arrival', `Called by the fire: ${story}${fromLine(s, party, created)}`, created.map((p) => p.id), 6);
  if (!c) return;
  c.arrive?.(s, created);
  const holder = created[c.holder ?? 0] ?? created[0];
  holder.hook = { id: c.id, due: s.day + int(s.rng, c.due[0], c.due[1]) * Y };
}

/** Once a year: stories carried in by called people come back. */
export function hooksYear(s: GameState) {
  for (const p of s.people) {
    const h = p.hook;
    if (!h || s.day < h.due) continue;
    // Most stories wait for their person to be here; a few (a sealed jar) come back after them.
    if (p.alive && p.away !== undefined) continue;
    if (!p.alive && h.id !== 'jar' && h.id !== 'storyteller' && h.id !== 'flute') { p.hook = undefined; continue; }
    const c = BY_ID.get(h.id);
    if (!c) { p.hook = undefined; continue; }
    if (c.resolve(s, p)) p.hook = undefined;
  }
}

