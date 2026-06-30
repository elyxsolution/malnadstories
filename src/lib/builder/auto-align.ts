/**
 * Album builder — Auto Align (PURE, shared).
 *
 * A deterministic "tidy" for the FREE decorative elements on a page or the cover (text +
 * stickers): horizontally centre each element on the page axis and evenly distribute them
 * top-to-bottom within the safe band, preserving their current visual order. Base photos and
 * photo overlays are layout-driven and intentionally left untouched.
 *
 * This is the working v1 behind the toolbar "Auto Align" button (which replaced the old AI
 * Assistant). It's a pure transform — easy to extend later with smarter edge/gap alignment.
 */
import type { Block, StickerElement, TextElement } from './model';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const TOP = 0.1;
const BOTTOM = 0.9;

type Pos = { x: number; y: number; w: number; h: number };

/** Centre horizontally + evenly distribute vertically, preserving each item's array index. */
function tidyPositions<T extends Pos>(items: T[]): T[] {
  if (items.length === 0) return items;
  // Visual (top-to-bottom) order drives the vertical distribution; array order is preserved.
  const order = items
    .map((el, i) => ({ el, i }))
    .sort((a, b) => a.el.y + a.el.h / 2 - (b.el.y + b.el.h / 2));
  const n = order.length;
  const out = [...items];
  order.forEach(({ i, el }, k) => {
    const cy = n === 1 ? clamp(el.y + el.h / 2, TOP, BOTTOM) : TOP + (BOTTOM - TOP) * ((k + 0.5) / n);
    out[i] = { ...el, x: clamp(0.5 - el.w / 2, 0, 1 - el.w), y: clamp(cy - el.h / 2, 0, 1 - el.h) };
  });
  return out;
}

/** Auto-align a cover's free elements (text + stickers); the image/title block is left as-is. */
export function autoAlignCover(
  texts: TextElement[],
  stickers: StickerElement[],
): { texts: TextElement[]; stickers: StickerElement[] } {
  const combined: (TextElement | StickerElement)[] = [...texts, ...stickers];
  const tidied = tidyPositions(combined);
  return {
    texts: tidied.slice(0, texts.length) as TextElement[],
    stickers: tidied.slice(texts.length) as StickerElement[],
  };
}

/** Auto-align a page block's free elements (text + stickers); photos are left as laid out. */
export function autoAlignBlock(block: Block): Block {
  const combined: (TextElement | StickerElement)[] = [...block.texts, ...block.stickers];
  const tidied = tidyPositions(combined);
  return {
    ...block,
    texts: tidied.slice(0, block.texts.length) as TextElement[],
    stickers: tidied.slice(block.texts.length) as StickerElement[],
  };
}
