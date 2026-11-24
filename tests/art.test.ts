import { describe, expect, it } from 'vitest';
import { keyBackground } from '../scripts/key';

/** A W×H image on a flat background, with a disc of paint in the middle and a white patch inside it. */
function picture(W: number, H: number, bg: [number, number, number], alpha = 255) {
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const r = Math.hypot(x - W / 2, y - H / 2);
    const paint: [number, number, number] = r < 6 ? [250, 250, 250] : r < 20 ? [160, 90, 50] : bg;
    d.set([...paint, r < 20 ? 255 : alpha], i);
  }
  return d;
}

describe('art from tools without transparency', () => {
  it('a flat magenta or white background is taken out, and white inside the painting stays', () => {
    for (const bg of [[255, 0, 255], [255, 255, 255]] as [number, number, number][]) {
      const d = picture(64, 64, bg);
      expect(keyBackground(d, 64, 64)).toBe(true);
      expect(d[(2 * 64 + 2) * 4 + 3]).toBe(0); // the corner: background, cleared
      expect(d[(32 * 64 + 44) * 4 + 3]).toBe(255); // the paint
      expect(d[(32 * 64 + 32) * 4 + 3]).toBe(255); // a white highlight inside it
    }
  });

  it('art that already has a transparent background is left alone', () => {
    const d = picture(64, 64, [0, 0, 0], 0);
    const before = d.slice();
    expect(keyBackground(d, 64, 64)).toBe(false);
    expect(d).toEqual(before);
  });
});
