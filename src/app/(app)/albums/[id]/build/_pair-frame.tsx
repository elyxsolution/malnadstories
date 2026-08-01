'use client';

import PhotoFrame from './_photo-frame';
import { TextBox, QrBox, StickerBox } from './_elements-render';
import UploadBadge, { stateOpacityClass, type BadgeSize } from './_upload-badge';
import type { PhotoUiState } from './_photo-state';
import { backgroundStyle } from '@/lib/builder/elements';
import type { Block, EditConfig, Overlay } from '@/lib/builder/model';

/**
 * Shared, read-only renderer for ONE content pair (two physical pages) in the OPEN-BOOK
 * coordinate space — both pages laid out side by side as a single 2-wide box.
 *
 * THE single source of pair geometry, reused by:
 *   - the in-app preview (`half="full"`, rendered once full-width with a centre gutter), and
 *   - the print route (`half="left"|"right"`, rendered once per physical page, clipped),
 * so the builder preview and the generated PDF are pixel-identical by construction.
 *
 * Memory (Phase F.1): in PDF mode we render ONLY the frames that belong to the given
 * physical page — `single-pair` renders just that side's photo (so a photo is decoded
 * once, not twice), and overlays render only on the page(s) they overlap. A
 * `double-spread` image inherently spans both pages, so it renders on each.
 *
 * Gutter/seam: the split is at exactly x=0.5 of the 2-wide box, which at the worker's
 * deviceScaleFactor:2 falls on an integer device-pixel boundary (6in·96·2 = 1152 px),
 * so the two halves meet with no sub-pixel gap — pixel-perfect, no stretch, no bleed.
 */

/**
 * `state`/`since` are OPTIONAL and client-only (Phase 4): they let the preview, flipbook and
 * navigator show the same processing language as the tray and the canvas, through the same
 * `UploadBadge`. The print route never supplies them, so a PDF is never decorated.
 */
export type PairPhoto = {
  url: string;
  edit?: EditConfig | null;
  state?: PhotoUiState;
  since?: number | null;
};
export type PairHalf = 'full' | 'left' | 'right';

const overlapsHalf = (o: Overlay, half: PairHalf) =>
  half === 'full' || (half === 'left' ? o.x < 0.5 : o.x + o.w > 0.5);

/** Wraps a frame so an unprocessed photo carries the same badge it has everywhere else. */
function Framed({
  photo,
  badge,
  onFrameReady,
}: {
  photo: PairPhoto;
  badge: BadgeSize | 'none';
  onFrameReady?: () => void;
}) {
  const state = photo.state ?? 'ready';
  const show = badge !== 'none' && state !== 'ready';
  return (
    <>
      <div className={`h-full w-full ${show ? stateOpacityClass(state) : ''}`}>
        <PhotoFrame url={photo.url} edit={photo.edit} onReady={onFrameReady} />
      </div>
      {show && <UploadBadge state={state} size={badge as BadgeSize} />}
    </>
  );
}

export default function PairContent({
  block,
  photoFor,
  stickerUrlFor,
  onFrameReady,
  half = 'full',
  showPlaceholders = false,
  badge = 'none',
}: {
  block: Block;
  photoFor: (id: string | null | undefined) => PairPhoto | undefined;
  /**
   * Density of the processing badge for this surface: `compact` for the in-app preview and
   * flipbook, `micro` (a bare dot) for navigator thumbs where text would be illegible, and
   * `none` — the default — for the print route and blueprint previews.
   */
  badge?: BadgeSize | 'none';
  /** Resolve a sticker id → presigned URL (parallel to photoFor). Optional; stickers render only if resolved. */
  stickerUrlFor?: (stickerId: string) => string | undefined;
  onFrameReady?: () => void;
  half?: PairHalf;
  /**
   * When true, an EMPTY overlay (photoId=null, or an unresolved photo) draws a visible slot
   * outline instead of rendering nothing. This is what makes a BLUEPRINT preview/thumbnail
   * represent the template (its overlay containers) rather than a completed album. The real
   * customer PDF/print/preview leaves it false, so unfilled placeholders never print.
   */
  showPlaceholders?: boolean;
}) {
  const isDouble = block.template === 'double-spread';
  const left = photoFor(block.photoIds[0]);
  const right = photoFor(block.photoIds[1]);
  const showLeft = half === 'full' || half === 'left';
  const showRight = half === 'full' || half === 'right';

  return (
    // `container-type: inline-size` makes text `cqw` units scale with the open-pair width
    // (identical ratio in canvas, preview, and PDF). Background renders beneath everything.
    <div className="absolute inset-0" style={{ containerType: 'inline-size' }}>
      {block.background && <div className="absolute inset-0" style={backgroundStyle(block.background)} />}
      {isDouble ? (
        // One image across the whole open pair; per-page clipping performs the split.
        left ? (
          <Framed photo={left} badge={badge} onFrameReady={onFrameReady} />
        ) : (
          <EmptyHalf full label="Double-page image" />
        )
      ) : (
        <>
          {showLeft && (
            <div className="absolute left-0 top-0 h-full w-1/2 overflow-hidden">
              {left ? <Framed photo={left} badge={badge} onFrameReady={onFrameReady} /> : <EmptyHalf label="Left page" />}
            </div>
          )}
          {showRight && (
            <div className="absolute left-1/2 top-0 h-full w-1/2 overflow-hidden">
              {right ? <Framed photo={right} badge={badge} onFrameReady={onFrameReady} /> : <EmptyHalf label="Right page" />}
            </div>
          )}
        </>
      )}

      {block.overlays.map((o, i) => {
        if (!overlapsHalf(o, half)) return null;
        const photo = photoFor(o.photoId);
        const style = { left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%` };
        // Empty (placeholder) overlay: draw the slot outline only when explicitly previewing a
        // template; otherwise render nothing (real albums never print an unfilled container).
        if (!photo) {
          if (!showPlaceholders) return null;
          return <OverlayPlaceholder key={i} style={style} />;
        }
        return (
          <div key={i} className="absolute overflow-hidden border-2 border-white shadow" style={style}>
            <Framed photo={photo} badge={badge} onFrameReady={onFrameReady} />
          </div>
        );
      })}

      {/* Text + QR sit above the photo layers. They carry no remote loads (cqw text, inline
          SVG QR), so the PDF readiness counter is unaffected. The per-page clip window
          handles half-splitting in PDF mode — no overlapsHalf filtering needed here. */}
      {(block.texts ?? []).map((t) => (
        <TextBox key={t.id} el={t} />
      ))}
      {(block.qrs ?? []).map((q) => (
        <QrBox key={q.id} el={q} />
      ))}

      {/* Stickers — decorative artwork on top. Resolved via stickerUrlFor (a since-deleted
          sticker resolves to undefined → renders nothing, like a missing photo). */}
      {(block.stickers ?? []).map((s) => (
        <StickerBox key={s.id} el={s} url={stickerUrlFor?.(s.stickerId)} onReady={onFrameReady} />
      ))}
    </div>
  );
}

/**
 * THE PRINT GUTTER — where the two pages of a spread meet and the paper physically folds.
 *
 * ONE component for every surface that shows a spread (canvas, preview, review, the flat
 * spread view), because a fold that looks different in each place teaches the customer nothing.
 * It is an EDITING AID and nothing more: it is never rendered by the print route, and it changes
 * no geometry — export is byte-for-byte what it was.
 *
 * The look is deliberately restrained: a soft symmetric shading that falls off toward the centre,
 * the way an open book darkens into its spine, plus a hairline exactly on the fold. `multiply`
 * blending means it reads on a white page and on a dark photo without ever becoming a grey stripe
 * across someone's picture. Purely decorative, so it is `aria-hidden` and inert.
 */
export function PrintGutter({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute inset-y-0 left-1/2 z-[6] -translate-x-1/2 ${className}`}>
      <span
        className="absolute inset-y-0 left-1/2 -translate-x-1/2"
        style={{
          width: '5.5cqw',
          mixBlendMode: 'multiply',
          background:
            'linear-gradient(90deg, rgba(24,32,28,0) 0%, rgba(24,32,28,0.10) 42%, rgba(24,32,28,0.16) 50%, rgba(24,32,28,0.10) 58%, rgba(24,32,28,0) 100%)',
        }}
      />
      {/* The fold itself — a hairline the eye can measure against when placing content. */}
      <span
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
        style={{ mixBlendMode: 'multiply', background: 'rgba(24,32,28,0.22)' }}
      />
    </span>
  );
}

/** An unfilled overlay container — a dashed slot outline shown only in template previews. */
function OverlayPlaceholder({ style }: { style: React.CSSProperties }) {
  return (
    <div
      className="absolute flex items-center justify-center rounded-[3px] border-2 border-dashed border-black/25 bg-black/[0.04]"
      style={style}
    >
      <span className="text-[9px] font-medium uppercase tracking-wide text-black/30">Photo</span>
    </div>
  );
}

function EmptyHalf({ label, full }: { label: string; full?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center bg-muted text-xs text-muted-foreground ${
        full ? 'absolute inset-0' : 'h-full w-full'
      }`}
    >
      {label}
    </div>
  );
}
