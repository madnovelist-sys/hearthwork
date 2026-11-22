// Colors from the art design document. Reserved accents (hearth gold, Weird
// glow, calamity red) are only used for what they mean.

export const C = {
  springGrass: '#9CC26B',
  summerGrass: '#7FA65A',
  autumnGrass: '#C19A4B',
  snow: '#E8EEF2',
  winterGrass: '#9DA383',
  dirt: '#A67C52',
  soil: '#6E4F33',
  shallow: '#7DB8C4',
  deep: '#2F6680',
  stone: '#B9AFA0',
  darkStone: '#7D766C',
  sand: '#D9C38F',
  marsh: '#6F8A5A',
  shadow: '#3E3A4F',
  sunlight: '#FFD9A0',
  windowGlow: '#FFC46B',
  fire: '#FF8A3D',
  night: '#2B3550',
  parchment: '#F2E6CC',
  ink: '#3B2F2A',
  hearthGold: '#FFB347',
  weirdA: '#6FE3D2',
  weirdB: '#9B6BFF',
  calamity: '#A33A2E',
  // Bronze era materials
  mudbrick: '#C9A27A',
  thatch: '#C9A55C',
  timber: '#8A5A3B',
  redClay: '#B8603E',
  bronze: '#B0793A',
  hide: '#B79A74',
} as const;

/** Grass through the year. Snow is laid over it when (and only when) snow is actually lying. */
export const GRASS_BY_SEASON = [C.springGrass, C.summerGrass, C.autumnGrass, C.winterGrass];

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const mixCache = new Map<string, string>();
export function mix(a: string, b: string, t: number): string {
  const key = `${a}${b}${t}`;
  const hit = mixCache.get(key);
  if (hit) return hit;
  const out = mixRaw(a, b, t);
  if (mixCache.size > 5000) mixCache.clear();
  mixCache.set(key, out);
  return out;
}

function mixRaw(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function shade(hex: string, amount: number): string {
  return amount >= 0 ? mix(hex, '#ffffff', amount) : mix(hex, C.shadow, -amount);
}
