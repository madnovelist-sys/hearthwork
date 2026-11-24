// Taking a flat background colour out of a painting (see readArt in build-art.ts).

/**
 * If the image has hardly any see-through pixels and its border is one flat colour, clear that
 * colour wherever it joins the border, with a soft edge, taking its tint back out of the edge
 * pixels. Changes nothing otherwise. Returns whether it keyed anything.
 */
export function keyBackground(data: Uint8Array, W: number, H: number): boolean {
  let clearPx = 0;
  for (let i = 0; i < W * H; i += 7) if (data[i * 4 + 3] < 200) clearPx++;
  if (clearPx > (W * H) / 7 * 0.02) return false;
  // The border's colour: the middle value of each channel along the edge.
  const border: number[][] = [];
  for (let x = 0; x < W; x += 2) border.push([x, 0], [x, H - 1]);
  for (let y = 0; y < H; y += 2) border.push([0, y], [W - 1, y]);
  const ch = (c: number) => border.map(([x, y]) => data[(y * W + x) * 4 + c]).sort((a, b) => a - b)[border.length >> 1];
  const key = [ch(0), ch(1), ch(2)];
  const dist = (i: number) => Math.hypot(data[i * 4] - key[0], data[i * 4 + 1] - key[1], data[i * 4 + 2] - key[2]);
  const flat = border.filter(([x, y]) => dist(y * W + x) < 30).length / border.length;
  if (flat < 0.9) return false;
  // How far from the key colour counts as background, and where the soft edge ends. A bright
  // key (magenta, green) is far from anything painted; white is close to snow and cream.
  const white = key.every((v) => v > 225);
  const inner = white ? 14 : 70, outer = white ? 34 : 150;
  const seen = new Uint8Array(W * H);
  const q: number[] = [];
  const consider = (i: number) => {
    if (seen[i]) return;
    seen[i] = 1;
    const d = dist(i);
    if (d >= outer) return;
    const a = d <= inner ? 0 : (d - inner) / (outer - inner);
    if (a < 1) data[i * 4 + 3] = Math.min(data[i * 4 + 3], Math.round(a * 255));
    if (a > 0 && !white) {
      // Take the key's tint back out of an edge pixel (un-blend it from the key colour).
      for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round((data[i * 4 + c] - (1 - a) * key[c]) / Math.max(a, 0.2))));
    }
    if (d <= inner + (outer - inner) * 0.5) q.push(i);
  };
  for (let x = 0; x < W; x++) { consider(x); consider((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { consider(y * W); consider(y * W + W - 1); }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i % W, y = (i / W) | 0;
    if (x > 0) consider(i - 1); if (x < W - 1) consider(i + 1);
    if (y > 0) consider(i - W); if (y < H - 1) consider(i + W);
  }
  return true;
}
