'use client';

import { useEffect, useRef } from 'react';
import { Sprig } from '@/components/brand';
import { fontStack } from '@/lib/builder/elements';
import PhotoFrame from './_photo-frame';
import { TextBox, StickerBox, QrBox } from './_elements-render';
import {
  coverBackgroundStyle,
  coverLayoutFraming,
  spineWidthFor,
  type BackCoverConfig,
  type CoverConfig,
  type CoverLayout,
} from '@/lib/builder/cover';
import type {
  Background,
  EditConfig,
  QrElement,
  StickerElement,
  TextAlign,
  TextElement,
  TextFontKey,
} from '@/lib/builder/model';

/**
 * The cover renderers — shared by the builder canvas, the flipbook preview, and the PDF print
 * route, so a customer's cover design prints exactly as drawn (WYSIWYG by construction, the way
 * `_photo-frame` unifies photos). A printed cover is a spread: BACK (last physical page) · SPINE
 * (binding) · FRONT (physical page 1). `CoverDesign` renders the front, `BackCoverDesign` the
 * back, and `CoverSpread` composes all three for a read-only preview / thumbnail.
 *
 * Image sources are resolved by the CALLER (uploaded photo → cover template → none) and passed as
 * `imageUrl`; `background` is the CSS backdrop when there is no image. Cover images go through
 * `PhotoFrame` so crop/zoom/rotate (`imageEdit`) applies just like a page photo. Title sizing uses
 * container queries (cqw against each page's own `container-type: inline-size`) so the same ratio
 * renders at any size with no measurement.
 */

/**
 * Geometry of the cover spread for a given album leaf count (shared by canvas + preview).
 * `pageAspectRatio` (width/height of ONE cover page) defaults to the legacy 0.75 (3:4) so
 * existing callers are unchanged; the builder passes the ACTIVE product's page aspect (Phase B)
 * so the cover spread matches the printed page proportions.
 */
export function coverSpreadMetrics(size: number, pageAspectRatio: number = 0.75) {
  const spineFrac = spineWidthFor(size);
  const totalUnits = 2 + spineFrac;
  return {
    pagePct: (1 / totalUnits) * 100, // each cover page's width as % of the spread
    spinePct: (spineFrac / totalUnits) * 100, // the spine's width as % of the spread
    aspect: pageAspectRatio * totalUnits, // spread width / height (each page = pageAspectRatio)
  };
}

export default function CoverDesign({
  imageUrl,
  imageEdit = null,
  background,
  title,
  subtitle,
  author = '',
  font,
  color,
  align,
  layout,
  posY,
  texts = [],
  stickers = [],
  qrs = [],
  stickerUrlFor,
  renderElements = true,
  onReady,
  rounded = false,
}: {
  imageUrl: string | null;
  imageEdit?: EditConfig | null;
  background: Background | null;
  title: string;
  subtitle: string;
  author?: string;
  font: TextFontKey;
  color: string;
  align: TextAlign;
  layout: CoverLayout;
  posY: number;
  /** Free text elements on the cover (same type as page text). Default none. */
  texts?: TextElement[];
  /** Sticker elements on the cover (same type as page stickers). Default none. */
  stickers?: StickerElement[];
  /** QR elements on the cover (same type as page QR). Default none. */
  qrs?: QrElement[];
  /** Resolve a sticker id → presigned URL (parallel to photoFor on pages). */
  stickerUrlFor?: (stickerId: string) => string | undefined;
  /** When false, the host (the editing cover canvas) renders interactive elements itself. */
  renderElements?: boolean;
  onReady?: () => void;
  rounded?: boolean;
}) {
  const fired = useRef(false);
  const ready = () => {
    if (fired.current) return;
    fired.current = true;
    onReady?.();
  };
  // No image to wait on → signal readiness once on mount (keeps the PDF gate honest).
  useEffect(() => {
    if (!imageUrl) ready();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  const framing = coverLayoutFraming(layout, !!imageUrl);
  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  return (
    <div
      className={`relative h-full w-full select-none overflow-hidden ${rounded ? 'rounded-[14px]' : ''}`}
      style={{ containerType: 'inline-size', ...(imageUrl ? { background: '#1e3a2f' } : coverBackgroundStyle(background)) }}
    >
      {imageUrl && (
        <div className="absolute inset-0">
          <PhotoFrame url={imageUrl} edit={imageEdit} onReady={ready} />
        </div>
      )}

      {framing.scrim && <div className="pointer-events-none absolute inset-0" style={framing.scrim} />}

      {/* Title block — anchored at posY, nudged onto the page with safe side padding. */}
      <div
        className="pointer-events-none absolute inset-x-0 flex flex-col px-[9%]"
        style={{ top: `${posY * 100}%`, transform: 'translateY(-50%)', alignItems: justify }}
      >
        <div
          className={framing.band ? 'w-full' : ''}
          style={
            framing.band
              ? {
                  background: 'rgba(12,18,15,0.42)',
                  padding: '4cqw 6cqw',
                  borderRadius: '1.5cqw',
                  backdropFilter: 'blur(2px)',
                }
              : undefined
          }
        >
          {title.trim() && (
            <h1
              style={{
                fontFamily: fontStack(font),
                color,
                textAlign: align,
                fontSize: '8.5cqw',
                fontWeight: 600,
                lineHeight: 1.04,
                letterSpacing: '-0.01em',
                textShadow: imageUrl ? '0 0.4cqw 2cqw rgba(8,12,10,0.4)' : 'none',
                margin: 0,
                wordBreak: 'break-word',
              }}
            >
              {title}
            </h1>
          )}
          {subtitle.trim() && (
            <p
              style={{
                fontFamily: fontStack(font),
                color,
                textAlign: align,
                fontSize: '3.6cqw',
                fontWeight: 400,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                opacity: 0.92,
                marginTop: '2.4cqw',
                textShadow: imageUrl ? '0 0.3cqw 1.5cqw rgba(8,12,10,0.4)' : 'none',
                wordBreak: 'break-word',
              }}
            >
              {subtitle}
            </p>
          )}
          {author.trim() && (
            <p
              style={{
                fontFamily: fontStack(font),
                color,
                textAlign: align,
                fontSize: '2.9cqw',
                fontWeight: 400,
                letterSpacing: '0.04em',
                opacity: 0.82,
                marginTop: '3cqw',
                textShadow: imageUrl ? '0 0.3cqw 1.5cqw rgba(8,12,10,0.4)' : 'none',
                wordBreak: 'break-word',
              }}
            >
              {author}
            </p>
          )}
        </div>
      </div>

      {/* Free elements (same types as page elements) — drawn above the title block. The
          editing canvas passes renderElements={false} and draws interactive versions itself. */}
      {renderElements && texts.map((t) => <TextBox key={t.id} el={t} />)}
      {renderElements && qrs.map((q) => <QrBox key={q.id} el={q} />)}
      {renderElements &&
        stickers.map((s) => <StickerBox key={s.id} el={s} url={stickerUrlFor?.(s.stickerId)} onReady={onReady} />)}
    </div>
  );
}

/**
 * The BACK cover (the left page of the printed spread / the final physical page). A composition
 * of an image-or-background backdrop + free elements + an optional studio mark — no structured
 * title block (that belongs to the front). Mirrors `CoverDesign`'s readiness contract so the PDF
 * gate waits for the back image + stickers.
 */
export function BackCoverDesign({
  back,
  imageUrl,
  stickerUrlFor,
  renderElements = true,
  onReady,
  rounded = false,
}: {
  back: BackCoverConfig;
  imageUrl: string | null;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  renderElements?: boolean;
  onReady?: () => void;
  rounded?: boolean;
}) {
  const fired = useRef(false);
  const ready = () => {
    if (fired.current) return;
    fired.current = true;
    onReady?.();
  };
  useEffect(() => {
    if (!imageUrl) ready();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  return (
    <div
      className={`relative h-full w-full select-none overflow-hidden ${rounded ? 'rounded-[14px]' : ''}`}
      style={{ containerType: 'inline-size', ...(imageUrl ? { background: '#1e3a2f' } : coverBackgroundStyle(back.background)) }}
    >
      {imageUrl && (
        <div className="absolute inset-0">
          <PhotoFrame url={imageUrl} edit={back.imageEdit} onReady={ready} />
        </div>
      )}

      {renderElements && back.texts.map((t) => <TextBox key={t.id} el={t} />)}
      {renderElements && back.qrs.map((q) => <QrBox key={q.id} el={q} />)}
      {renderElements &&
        back.stickers.map((s) => <StickerBox key={s.id} el={s} url={stickerUrlFor?.(s.stickerId)} onReady={onReady} />)}

      {back.showLogo && (
        <div
          className="pointer-events-none absolute bottom-[6%] left-1/2 flex -translate-x-1/2 flex-col items-center gap-[1.5cqw]"
          style={{ color: imageUrl || back.background ? '#ffffff' : '#1e3a2f' }}
        >
          <Sprig style={{ width: '10cqw', height: '10cqw', opacity: 0.9 }} />
          <span
            style={{
              fontFamily: fontStack('serif'),
              fontSize: '3cqw',
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              opacity: 0.75,
            }}
          >
            Malnad Stories
          </span>
        </div>
      )}
    </div>
  );
}

/** The book spine — a thin bound edge carrying the title vertically. Pure CSS (no load wait). */
function Spine({ title, color }: { title: string; color: string }) {
  return (
    <div
      className="relative h-full overflow-hidden"
      style={{
        flex: '0 0 auto',
        background: 'linear-gradient(90deg, rgba(0,0,0,0.22), rgba(0,0,0,0.04) 40%, rgba(0,0,0,0.04) 60%, rgba(0,0,0,0.22)), #1e3a2f',
        containerType: 'size',
      }}
    >
      {title.trim() && (
        <span
          className="absolute left-1/2 top-1/2"
          style={{
            transform: 'translate(-50%, -50%)',
            writingMode: 'vertical-rl',
            whiteSpace: 'nowrap',
            color,
            fontFamily: fontStack('serif'),
            fontSize: '5cqh',
            letterSpacing: '0.12em',
            opacity: 0.92,
            textShadow: '0 0.4cqh 1cqh rgba(0,0,0,0.35)',
          }}
        >
          {title}
        </span>
      )}
    </div>
  );
}

/**
 * Read-only composition of the WHOLE cover: Back · Spine · Front, in true proportions for the
 * album's leaf count. Used by the timeline thumbnail + any static cover preview. The editing
 * canvas builds its own spread (with interactive element layers) but shares `coverSpreadMetrics`.
 */
export function CoverSpread({
  config,
  title,
  frontImageUrl,
  backImageUrl,
  size,
  pageAspect,
  stickerUrlFor,
  onReady,
  rounded = false,
}: {
  config: CoverConfig;
  title: string;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  size: number;
  /** One cover page's width/height (from ProductDimensions). Omitted → legacy 0.75. */
  pageAspect?: number;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  onReady?: () => void;
  rounded?: boolean;
}) {
  const { pagePct, spinePct, aspect } = coverSpreadMetrics(size, pageAspect);
  return (
    <div
      className={`relative w-full overflow-hidden ${rounded ? 'rounded-[14px] ring-1 ring-black/10' : ''}`}
      style={{ aspectRatio: String(aspect) }}
    >
      <div className="flex h-full w-full">
        <div className="relative h-full" style={{ width: `${pagePct}%` }}>
          <BackCoverDesign back={config.back} imageUrl={backImageUrl} stickerUrlFor={stickerUrlFor} onReady={onReady} />
        </div>
        <div className="relative h-full" style={{ width: `${spinePct}%` }}>
          <Spine title={config.spineTitle || title} color={config.spineColor} />
        </div>
        <div className="relative h-full" style={{ width: `${pagePct}%` }}>
          <CoverDesign
            imageUrl={frontImageUrl}
            imageEdit={config.imageEdit}
            background={config.background}
            title={title}
            subtitle={config.subtitle}
            author={config.author}
            font={config.font}
            color={config.color}
            align={config.align}
            layout={config.layout}
            posY={config.posY}
            texts={config.texts}
            stickers={config.stickers}
            qrs={config.qrs}
            stickerUrlFor={stickerUrlFor}
            onReady={onReady}
          />
        </div>
      </div>
      {/* Spine-edge depth so the spread reads as a bound book. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 z-[2]"
        style={{ left: `${pagePct}%`, width: `${spinePct}%`, boxShadow: 'inset 0 0 3cqw rgba(0,0,0,0.3)' }}
      />
    </div>
  );
}

/** Convenience: render the FRONT cover straight from a CoverConfig + resolved image URL. */
export function CoverDesignFromConfig({
  config,
  title,
  imageUrl,
  stickerUrlFor,
  renderElements = true,
  onReady,
  rounded,
}: {
  config: CoverConfig;
  title: string;
  imageUrl: string | null;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  renderElements?: boolean;
  onReady?: () => void;
  rounded?: boolean;
}) {
  return (
    <CoverDesign
      imageUrl={imageUrl}
      imageEdit={config.imageEdit}
      background={config.background}
      title={title}
      subtitle={config.subtitle}
      author={config.author}
      font={config.font}
      color={config.color}
      align={config.align}
      layout={config.layout}
      posY={config.posY}
      texts={config.texts}
      stickers={config.stickers}
      qrs={config.qrs}
      stickerUrlFor={stickerUrlFor}
      renderElements={renderElements}
      onReady={onReady}
      rounded={rounded}
    />
  );
}
