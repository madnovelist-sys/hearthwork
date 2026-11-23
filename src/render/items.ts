// Things people carry and set down (art/items): baskets (empty, or heaped with
// barley, fish or berries), water jars and the well bucket (empty or full),
// storage jars (lid tied on, or off and leaning against it when the stores are
// low) and bundles of firewood. Each painting stands on its own; here they're
// sized against a grown-up and drawn standing on a point.

export type ItemKind = 'basket' | 'basket-grain' | 'basket-fish' | 'basket-berries' | 'water-jar' | 'well-bucket' | 'storage-jar' | 'wood-bundle';
export interface Item { kind: ItemKind; full: boolean }

interface Art { img: HTMLImageElement; ax: number; ay: number; h: number }
const art = new Map<string, Art>();
const scaled = new Map<string, HTMLCanvasElement>();

export function addItemArt(key: string, img: HTMLImageElement, ax: number, ay: number, h: number) {
  art.set(key, { img, ax, ay, h });
  scaled.clear();
}

/** How tall each sort of thing stands, as a share of a grown-up's height. */
const SIZE: Record<string, number> = { basket: 0.31, 'water-jar': 0.34, 'well-bucket': 0.25, 'storage-jar': 0.44, 'wood-bundle': 0.19 };
const family = (kind: ItemKind) => (kind.startsWith('basket') ? 'basket' : kind);

/** The painting for a thing: a full basket shows what's in it; an empty one is just a basket. */
function artFor(item: Item): Art | undefined {
  if (item.kind === 'wood-bundle') return art.get('wood-bundle');
  if (item.kind.startsWith('basket')) return item.full && item.kind !== 'basket' ? art.get(`${item.kind}:full`) : art.get('basket:empty');
  return art.get(`${item.kind}:${item.full ? 'full' : 'empty'}`);
}

/** How many CSS px to a painted px, for this sort of thing beside a grown-up `person` px tall. */
function scaleOf(item: Item, person: number): number {
  const fam = family(item.kind);
  // Measured on the empty one, so filling it doesn't shrink the basket.
  const ref = art.get(fam === 'wood-bundle' ? 'wood-bundle' : `${fam}:empty`) ?? artFor(item);
  return ref ? (SIZE[fam] * person) / ref.h : 0;
}

/** How tall it's drawn, in CSS px, beside a grown-up `person` px tall. */
export function itemHeight(item: Item, person: number): number {
  const a = artFor(item);
  return a ? a.h * scaleOf(item, person) : 0;
}

export const itemsReady = () => art.has('basket:empty') && art.has('water-jar:empty');

/**
 * Draw a thing standing at (x, y) (the middle of its foot), beside a grown-up `person` px tall.
 * Small copies are made once per size, so a crowd carrying baskets stays cheap and smooth.
 */
export function drawItem(g: CanvasRenderingContext2D, item: Item, x: number, y: number, person: number, dpr: number, alpha = 1): boolean {
  const a = artFor(item);
  if (!a) return false;
  const k = scaleOf(item, person);
  const px = Math.max(1, Math.round(a.h * k * dpr));
  const key = `${item.kind}:${item.full}:${px}`;
  let c = scaled.get(key);
  if (!c) {
    if (scaled.size > 200) scaled.clear();
    const s = px / a.h;
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(a.img.width * s));
    c.height = Math.max(1, Math.round(a.img.height * s));
    const cg = c.getContext('2d')!;
    cg.imageSmoothingEnabled = true;
    cg.imageSmoothingQuality = 'high';
    // Halve in steps, so the painting's detail is averaged rather than skipped.
    let src: CanvasImageSource = a.img, sw = a.img.width, sh = a.img.height;
    while (sw / 2 > c.width * 1.1) {
      const half = document.createElement('canvas');
      half.width = Math.ceil(sw / 2); half.height = Math.ceil(sh / 2);
      const hg = half.getContext('2d')!;
      hg.imageSmoothingQuality = 'high';
      hg.drawImage(src, 0, 0, sw, sh, 0, 0, half.width, half.height);
      src = half; sw = half.width; sh = half.height;
    }
    cg.drawImage(src, 0, 0, sw, sh, 0, 0, c.width, c.height);
    scaled.set(key, c);
  }
  const w = c.width / dpr, h = c.height / dpr;
  const was = g.globalAlpha;
  if (alpha < 1) g.globalAlpha = was * alpha;
  g.drawImage(c, x - (a.ax / a.img.width) * w, y - (a.ay / a.img.height) * h, w, h);
  g.globalAlpha = was;
  return true;
}
