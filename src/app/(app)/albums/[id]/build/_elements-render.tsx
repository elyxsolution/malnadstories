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

/** Inner text content (fills its positioned box). */
export function TextContent({ el }: { el: TextElement }) {
  const items = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center';
  return (
    <div
      style={{
        ...textStyle(el),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: items,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <span style={{ width: '100%' }}>{el.text || ''}</span>
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
export function TextBox({ el }: { el: TextElement }) {
  return (
    <div
      className="absolute"
      style={{
        left: `${el.x * 100}%`,
        top: `${el.y * 100}%`,
        width: `${el.w * 100}%`,
        height: `${el.h * 100}%`,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
      }}
    >
      <TextContent el={el} />
    </div>
  );
}

/** Positioned, read-only QR box (preview / PDF / thumbnails). */
export function QrBox({ el }: { el: QrElement }) {
  return (
    <div
      className="absolute"
      style={{ left: `${el.x * 100}%`, top: `${el.y * 100}%`, width: `${el.w * 100}%`, height: `${el.h * 100}%` }}
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
export function StickerContent({ el, url }: { el: StickerElement; url?: string }) {
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      draggable={false}
      className="h-full w-full select-none object-contain"
      style={{ opacity: el.opacity }}
    />
  );
}

/** Positioned, read-only sticker box (preview / PDF / thumbnails). Fires onReady on load/error. */
export function StickerBox({ el, url, onReady }: { el: StickerElement; url?: string; onReady?: () => void }) {
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
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" onLoad={onReady} onError={onReady} draggable={false} className="h-full w-full object-contain" />
    </div>
  );
}
