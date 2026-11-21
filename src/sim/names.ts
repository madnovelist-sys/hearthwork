// Names for people and places. Invented-but-familiar, in the storybook voice
// of the Chronicle.
import { type RngState, pick, chance, int } from './rng';
import type { QuestKind, Sex } from './types';

export const FEMALE_NAMES = [
  'Mira', 'Isolde', 'Wenna', 'Tamsin', 'Ysolt', 'Aster', 'Brielle', 'Cora', 'Dalla', 'Edda',
  'Galia', 'Hesper', 'Ilse', 'Juno', 'Kestrel', 'Liss', 'Maren', 'Nell', 'Oriel', 'Pell',
  'Rhosyn', 'Sabe', 'Tilde', 'Una', 'Vesna', 'Willa', 'Yara', 'Zelie', 'Anwen', 'Bryn',
  'Celyn', 'Della', 'Elin', 'Ffion', 'Gwen', 'Hana', 'Ione', 'Jessa', 'Kaia', 'Lark',
  'Morwen', 'Nia', 'Odile', 'Quilla', 'Roswen', 'Senna', 'Thea', 'Ula', 'Verity', 'Wren',
  'Ada', 'Brisa', 'Calla', 'Dove', 'Esk', 'Ivy', 'Linnet', 'Marigold', 'Orla', 'Sorrel',
];

export const MALE_NAMES = [
  'Hale', 'Corin', 'Bram', 'Tomas', 'Aldo', 'Bren', 'Cael', 'Dunstan', 'Emrys', 'Fenwick',
  'Garrow', 'Hob', 'Idris', 'Jory', 'Kit', 'Lorne', 'Madoc', 'Nyle', 'Osric', 'Pip',
  'Rook', 'Sten', 'Tam', 'Ulric', 'Vane', 'Wat', 'Yorick', 'Aled', 'Berric', 'Cormac',
  'Davin', 'Eamon', 'Finn', 'Gethin', 'Hew', 'Ivo', 'Jago', 'Kenan', 'Lew', 'Merric',
  'Nolan', 'Owain', 'Piran', 'Rhys', 'Silas', 'Tobin', 'Ulf', 'Wyn', 'Alder', 'Bede',
  'Colm', 'Drust', 'Ewan', 'Gil', 'Harl', 'Iestyn', 'Jem', 'Leof', 'Marrok', 'Ned',
];

const FAMILY_HEADS = [
  'Ash', 'Reed', 'Stone', 'Hollow', 'Marsh', 'Fen', 'Thorn', 'Wren', 'Oak', 'Brook',
  'Clay', 'Flint', 'Barrow', 'Bright', 'Black', 'Green', 'Hart', 'Hawk', 'Moss', 'Rush',
  'Salt', 'Tall', 'Wild', 'Elder', 'Fair', 'Cold', 'Long', 'Red', 'White', 'Birch',
  'Alder', 'Heath', 'Fox', 'Crow', 'Hare', 'Otter', 'Rowan', 'Sedge', 'Ember', 'Wold',
];
const FAMILY_TAILS = [
  'ford', 'well', 'wood', 'hand', 'mere', 'wick', 'ley', 'croft', 'by', 'more',
  'field', 'water', 'brook', 'hill', 'dale', 'gate', 'low', 'ridge', 'shaw', 'worth',
  'beck', 'holt', 'stone', 'combe',
];
const SHORT_FAMILIES = [
  'Tull', 'Vell', 'Kerr', 'Mott', 'Pask', 'Rudd', 'Sayer', 'Tarn', 'Vay', 'Hask',
  'Dunn', 'Lusk', 'Brand', 'Coll', 'Penn', 'Quill', 'Rist', 'Teague', 'Wade', 'Yarrow',
];

const PLACE_HEADS = [
  'Ash', 'Reed', 'Stone', 'Elm', 'Willow', 'Hearth', 'Amber', 'Fern', 'Hazel', 'Kestrel',
  'Bram', 'Thistle', 'Wren', 'Lark', 'Otter', 'Sallow', 'Rush', 'Heron', 'Clover', 'Ember',
];
const PLACE_TAILS = [
  'brook', 'ford', 'mere', 'wick', 'holt', 'stead', 'by', 'dale', 'hollow', 'well',
  'fell', 'combe', 'ley', 'haven', 'bourne', 'den',
];

export function givenName(r: RngState, sex: Sex): string {
  return pick(r, sex === 'f' ? FEMALE_NAMES : MALE_NAMES);
}

export function familyName(r: RngState): string {
  if (chance(r, 0.3)) return pick(r, SHORT_FAMILIES);
  const head = pick(r, FAMILY_HEADS);
  let tail = pick(r, FAMILY_TAILS);
  if (head.toLowerCase().endsWith(tail[0])) tail = pick(r, FAMILY_TAILS);
  return head + tail;
}

export function settlementName(r: RngState): string {
  const head = pick(r, PLACE_HEADS);
  const tail = pick(r, PLACE_TAILS);
  return head + tail;
}

const QUEST_ADJ = ['Grey', 'Flint', 'Whispering', 'Salt', 'Ash', 'Red', 'Silent', 'Bitter', 'Hollow', 'Long', 'Drowned', 'Golden'];

export function questPlace(r: RngState, kind: QuestKind): string {
  const p = settlementName(r);
  const adj = pick(r, QUEST_ADJ);
  switch (kind) {
    case 'ruins':
      return pick(r, [`the ruins at ${p}`, `the broken towers of ${p}`, `the barrow-halls of ${p}`, `the ${adj} Ruins`]);
    case 'city':
      return pick(r, [`the river-city of ${p}`, `the walled town of ${p}`, `the markets of ${p}`]);
    case 'mountains':
      return pick(r, [`the ${adj} Peaks`, `the passes above ${p}`, `the ${adj} Mountains`]);
    case 'sea':
      return pick(r, [`the ${adj} Coast`, `the islands beyond ${p}`, `the shore at ${p}`]);
    case 'wilds':
      return pick(r, [`the ${adj} Wood`, `the far marshes of ${p}`, `the ${adj} Hills`]);
  }
}

export const QUEST_KIND_LABEL: Record<QuestKind, string> = {
  ruins: 'Ancient ruins',
  city: 'A distant city',
  mountains: 'The mountains',
  sea: 'The sea',
  wilds: 'The wild lands',
};

export function nickname(r: RngState, kind: 'injury' | 'luck' | 'return' | 'age'): string {
  switch (kind) {
    case 'injury': return pick(r, ['One-Hand', 'the Lame', 'Scar', 'Half-Ear', 'the Limping']);
    case 'luck': return pick(r, ['the Lucky', 'Goldfinger', 'the Fortunate']);
    case 'return': return pick(r, ['Far-Walker', 'the Returned', 'the Wanderer', 'Road-Worn']);
    case 'age': return pick(r, ['the Old', 'Greybeard', 'the Elder', 'Long-Lived']);
  }
}

export function randomAgeYears(r: RngState, lo: number, hi: number): number {
  return int(r, lo, hi);
}
