'use client';

import { QRCodeSVG } from 'qrcode.react';
import { textStyle } from '@/lib/builder/elements';
import type { QrElement, StickerElement, TextElement } from '@/lib/builder/model';

/**
 * Read-only renderers for the rich page elements (text · QR). THE single source of their
 * appearance — reused by the editing canvas (`_block`), the in-app preview, the flipbook,
 * and the PDF print route (via `_pair-frame`), so an element looks identical everywhere.
 *
 * Font size is expressed in `cqw` (see elements.ts `textFontSize`) against the open-pair
 * container, which declares `container-type: inline-size`. No measurement, no props beyond
 * the element itself — resolution-independent across canvas, preview, and PDF.
 */

/**
 * Inner text content (fills its positioned box).
 *
 * ONE special case, and it is geometric rather than cosmetic: a `role: 'spine'` object sits on the
 * bound edge of the book, which is a tall sliver a few percent of a page wide. Text runs ALONG it,
 * so it is set vertically — and its size has to be measured against the surface's height (`cqh`)
 * instead of its width, or a 5% size would resolve against ~8% of a page and render invisibly
 * small. `textFontSize` makes that decision from the role, so canvas, preview and PDF cannot
 * disagree about it.
 */
/**
 * A PLACED PHOTO — the positioned, clipped box an overlay is, and nothing more.
 *
 * THE ONE PLACE an overlay's container styling exists, shared by the content spread
 * (`_pair-frame`) and the cover faces (`_cover-render`). It used to be a class string written out
 * per surface, which is how the canvas came to carry `rounded-md border-2 border-white shadow-md`
 * while the printer-ready export carried none of it — the same album, two pictures.
 *
 * `absolute overflow-hidden` is the whole style. No border, no outline, no shadow, no radius: an
 * overlay is the photograph. `overflow-hidden` is not decoration — it is what clips the image to
 * its frame — and it is the only reason this element has a class at all. Selection outlines and
 * resize handles are drawn by `Movable` into a separate chrome layer and are unaffected.
 */
export function OverlayBox({
  el,
  z,
  children,
}: {
  el: { x: number; y: number; w: number; h: number };
  /**
   * WHERE THIS OBJECT PAINTS IN THE SURFACE'S STACK (see `lib/builder/layers`).
   *
   * Paint order used to be the order the renderer's four `.map()` calls ran in, which made it a
   * property of an object's TYPE rather than of the object. An explicit z-index is the CSS
   * primitive for the question, and it leaves the markup — and therefore selection, dragging,
   * drop targets and the crop layers — completely untouched. Omitted ⇒ the element paints in
   * document order exactly as it did before.
   */
  z?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute overflow-hidden"
      style={{ left: `${el.x * 100}%`, top: `${el.y * 100}%`, width: `${el.w * 100}%`, height: `${el.h * 100}%`, zIndex: z }}
    >
      {children}
    </div>
  );
}

export function TextContent({ el }: { el: TextElement }) {
  const spine = el.role === 'spine';
  const items = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center';
  return (
    <div
      style={{
        ...textStyle(el),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: spine ? 'center' : items,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <span
        style={
          spine
            ? { writingMode: 'vertical-rl', whiteSpace: 'nowrap', textAlign: 'center' }
            : { width: '100%' }
        }
      >
        {el.text || ''}
      </span>
    </div>
  );
}

/** Inner QR content — a centred square that fills the box, with quiet-zone padding + radius. */
export function QrContent({ el }: { el: QrElement }) {
  const transparentBg = el.bg === 'transparent';
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        background: transparentBg ? 'transparent' : el.bg,
        borderRadius: el.radius > 0 ? `${el.radius * 40}cqw` : 0,
        boxShadow: transparentBg ? 'none' : '0 0.6cqw 2cqw -0.6cqw rgba(20,30,24,0.25)',
        overflow: 'hidden',
      }}
    >
      <div style={{ width: `${(1 - el.padding) * 100}%`, aspectRatio: '1 / 1' }}>
        <QRCodeSVG
          value={el.data || ' '}
          size={1024}
          level="M"
          marginSize={0}
          bgColor="transparent"
          fgColor={el.fg}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    </div>
  );
}

/** Positioned, read-only text box (preview / PDF / thumbnails). */
export function TextBox({ el, z }: { el: TextElement; z?: number }) {
  return (
    <div
      className="absolute"
      style={{
        left: `${el.x * 100}%`,
        top: `${el.y * 100}%`,
        width: `${el.w * 100}%`,
        height: `${el.h * 100}%`,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        zIndex: z,
      }}
    >
      <TextContent el={el} />
    </div>
  );
}

/** Positioned, read-only QR box (preview / PDF / thumbnails). */
export function QrBox({ el, z }: { el: QrElement; z?: number }) {
  return (
    <div
      className="absolute"
      style={{ left: `${el.x * 100}%`, top: `${el.y * 100}%`, width: `${el.w * 100}%`, height: `${el.h * 100}%`, zIndex: z }}
    >
      <QrContent el={el} />
    </div>
  );
}

/**
 * Inner sticker content (fills its box) — `object-fit: contain` so the artwork keeps its aspect
 * regardless of the box. `url` is resolved by the CALLER (catalog/print resolver, parallel to
 * photos). Missing url → nothing (a since-deleted sticker simply disappears, like a missing photo).
 */
/** Flip transform shared by both sticker renderers (applied to the artwork, inside any rotation). */
function stickerFlip(el: StickerElement): string | undefined {
  const sx = el.flipH ? -1 : 1;
  const sy = el.flipV ? -1 : 1;
  return sx === 1 && sy === 1 ? undefined : `scale(${sx}, ${sy})`;
}

export function StickerContent({ el, url }: { el: StickerElement; url?: string }) {
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      draggable={false}
      className="h-full w-full select-none object-contain"
      style={{ opacity: el.opacity, transform: stickerFlip(el) }}
    />
  );
}

/** Positioned, read-only sticker box (preview / PDF / thumbnails). Fires onReady on load/error. */
export function StickerBox({
  el,
  url,
  onReady,
  z,
}: {
  el: StickerElement;
  url?: string;
  onReady?: () => void;
  /** Paint order within the surface's unified stack (see `OverlayBox`). */
  z?: number;
}) {
  if (!url) return null;
  return (
    <div
      className="absolute"
      style={{
        left: `${el.x * 100}%`,
        top: `${el.y * 100}%`,
        width: `${el.w * 100}%`,
        height: `${el.h * 100}%`,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        opacity: el.opacity,
        zIndex: z,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        onLoad={onReady}
        onError={onReady}
        draggable={false}
        className="h-full w-full object-contain"
        style={{ transform: stickerFlip(el) }}
      />
    </div>
  );
}
