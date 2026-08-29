'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Sprig } from '@/components/brand';
import { fontStack } from '@/lib/builder/elements';
import PhotoFrame from './_photo-frame';
import { TextBox, StickerBox, QrBox, OverlayBox } from './_elements-render';
import type { PairPhoto } from './_pair-frame';
import {
  coverBackgroundStyle,
  coverLayoutFraming,
  spineBackgroundStyle,
  spinePrintBackgroundStyle,
  spineWidthFor,
  type BackCoverConfig,
  type CoverConfig,
  type CoverLayout,
} from '@/lib/builder/cover';
import { findRole, migrateCoverConfig } from '@/lib/builder/cover-objects';
import type { Background, EditConfig, Overlay, QrElement, StickerElement, TextElement } from '@/lib/builder/model';

/**
 * The cover renderers — shared by the builder canvas, the flipbook preview, review mode, the admin
 * preview and the PDF print route, so a customer's cover design prints exactly as drawn (WYSIWYG
 * by construction, the way `_photo-frame` unifies photos). A printed cover is a spread: BACK (last
 * physical page) · SPINE (binding) · FRONT (physical page 1).
 *
 * ── ONE PATH, AFTER COVER EDITOR 2.0 ───────────────────────────────────────────────────────
 *
 * These components draw ONLY objects. The structured title column (title / subtitle / author,
 * anchored at `posY` and styled by `font`/`color`/`align`) and the bespoke spine `<span>` used to
 * be rendered here from scalar config fields — which is precisely why the cover could not be
 * edited like a page: the renderer, not the model, owned their position. `migrateCoverConfig`
 * turns those scalars into ordinary `TextElement`s, and it runs HERE, at every entry point, so an
 * album that has not been re-saved since the change renders identically in every surface without
 * any database backfill.
 *
 * Image sources are resolved by the CALLER (uploaded photo → cover template → none) and passed as
 * `imageUrl`; `background` is the CSS backdrop when there is no image. Cover images go through
 * `PhotoFrame` so crop/zoom/rotate (`imageEdit`) applies just like a page photo. Text sizing uses
 * container queries (`cqw` against each face's own `container-type: inline-size`, `cqh` for the
 * spine) so the same ratio renders at any size with no measurement.
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

/**
 * ONE FACE of the cover: a backdrop (photo or CSS), an optional legibility scrim, and objects.
 *
 * Front and back differ only in what the caller passes — which is the point. The back used to
 * have its own component because the front had a title block the back did not; with the title as
 * an object there is nothing structural left to differ about, and `BackCoverDesign` is now a thin
 * wrapper kept for its existing call sites.
 */
export default function CoverDesign({
  imageUrl,
  imageEdit = null,
  background,
  layout = 'classic',
  texts = [],
  stickers = [],
  qrs = [],
  overlays = [],
  photoFor,
  stickerUrlFor,
  renderElements = true,
  onReady,
}: {
  imageUrl: string | null;
  imageEdit?: EditConfig | null;
  background: Background | null;
  /** The cover THEME — chooses the scrim that keeps text legible over a photo. */
  layout?: CoverLayout;
  /** Text objects on this face — including the title / subtitle / author metadata views. */
  texts?: TextElement[];
  stickers?: StickerElement[];
  qrs?: QrElement[];
  /**
   * PLACED PHOTOS on this face — the same `Overlay` a content page carries. `imageUrl` above is
   * the face's BACKDROP (one image, edge to edge); these sit on top of it in their own frames.
   * Rendered through the shared `OverlayBox`, so a cover overlay and a page overlay are the same
   * plain, borderless, clipped picture.
   */
  overlays?: Overlay[];
  /** Resolve an overlay's photo id → its URL + edits. Absent ⇒ overlays render nothing. */
  photoFor?: (photoId: string | null | undefined) => PairPhoto | undefined;
  /** Resolve a sticker id → presigned URL (parallel to photoFor on pages). */
  stickerUrlFor?: (stickerId: string) => string | undefined;
  /** When false, the host (the editing cover canvas) renders interactive elements itself. */
  renderElements?: boolean;
  onReady?: () => void;
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

  return (
    <div
      className="relative h-full w-full select-none overflow-hidden"
      style={{ containerType: 'inline-size', ...(imageUrl ? { background: '#1e3a2f' } : coverBackgroundStyle(background)) }}
    >
      {imageUrl && (
        <div className="absolute inset-0">
          <PhotoFrame url={imageUrl} edit={imageEdit} onReady={ready} />
        </div>
      )}

      {framing.scrim && <div className="pointer-events-none absolute inset-0" style={framing.scrim} />}

      {/* Overlays sit ABOVE the backdrop and its scrim, BELOW text/QR/stickers — the same stacking
          order a content page uses, so an element that is on top in the builder is on top in the
          PDF. An unfilled frame (no photo yet, or one that has since been deleted) renders nothing
          rather than an empty box: a placeholder must never print. */}
      {renderElements &&
        overlays.map((o, i) => {
          const photo = photoFor?.(o.photoId);
          if (!photo) return null;
          return (
            <OverlayBox key={o.id ?? i} el={o}>
              <PhotoFrame url={photo.url} edit={photo.edit} onReady={onReady} />
            </OverlayBox>
          );
        })}

      {renderElements && texts.map((t) => <TextBox key={t.id} el={t} />)}
      {renderElements && qrs.map((q) => <QrBox key={q.id} el={q} />)}
      {renderElements &&
        stickers.map((s) => <StickerBox key={s.id} el={s} url={stickerUrlFor?.(s.stickerId)} onReady={onReady} />)}
    </div>
  );
}

/**
 * The BACK cover (the left page of the printed spread / the final physical page): the same face
 * renderer plus the optional studio mark, which is the one thing only the back has.
 */
export function BackCoverDesign({
  back,
  imageUrl,
  photoFor,
  stickerUrlFor,
  renderElements = true,
  onReady,
}: {
  back: BackCoverConfig;
  imageUrl: string | null;
  /** Resolve a placed overlay's photo. Absent ⇒ the face's overlays render nothing. */
  photoFor?: (photoId: string | null | undefined) => PairPhoto | undefined;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  renderElements?: boolean;
  onReady?: () => void;
}) {
  return (
    <div className="relative h-full w-full">
      <CoverDesign
        imageUrl={imageUrl}
        imageEdit={back.imageEdit}
        background={back.background}
        texts={back.texts}
        stickers={back.stickers}
        qrs={back.qrs}
        overlays={back.overlays}
        photoFor={photoFor}
        stickerUrlFor={stickerUrlFor}
        renderElements={renderElements}
        onReady={onReady}
      />
      {back.showLogo && (
        <div
          className="pointer-events-none absolute bottom-[6%] left-1/2 flex -translate-x-1/2 flex-col items-center gap-[1.5cqw]"
          style={{ color: imageUrl || back.background ? '#ffffff' : '#1e3a2f', containerType: 'inline-size' }}
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

/**
 * THE SPINE — the bound edge, a surface with objects rather than a hardcoded label.
 *
 * `container-type: size` (not `inline-size`) because a spine object is sized in `cqh`: the edge is
 * a few percent of a page wide and many times that tall, so height is the only axis that can
 * carry a legible measurement. See `textFontSize`.
 *
 * It takes the WHOLE config and migrates, for the same reason `CoverDesignFromConfig` does: a
 * legacy album's spine text still lives in the `spineTitle` scalar, and every surface that draws
 * a spine — builder, preview, review, PDF — has to see it. One rule for every cover renderer
 * ("migrate your input"), rather than each caller remembering.
 */
export function SpineDesign({
  config,
  title,
  pageAspect = 0.75,
  renderElements = true,
  print = false,
}: {
  config: CoverConfig;
  /**
   * The album title — the spine's fallback text when no spine text was set. Optional: an
   * already-migrated config carries it in its own title object, so a host holding a live cover
   * (the builder canvas) need not thread it. A host reading straight from the database (the PDF,
   * review) must pass it, because a v1 row has no title object to read it from yet.
   */
  title?: string;
  pageAspect?: number;
  renderElements?: boolean;
  /**
   * PRINT MODE — suppress the bound-edge shading so the printed spine carries only the customer's
   * chosen background colour and their spine text. Off everywhere except the printer-ready cover
   * export, so the builder and the preview are pixel-identical to before. See
   * `spinePrintBackgroundStyle`.
   */
  print?: boolean;
}) {
  // A SUPPLIED, NON-EMPTY album title still wins: renaming an album in Album Settings writes only
  // `albums.title`, and this load-direction sync is what carries that rename onto the cover.
  //
  // An EMPTY one falls through to the cover's own title object instead of winning with "". `??`
  // alone could not do this — `'' ?? x` is `''`, so an empty album title used to beat a perfectly
  // good stored title. That is the last place a migrated cover still depended on `albums.title`.
  const resolvedTitle =
    title !== undefined && title.trim() !== '' ? title : (findRole(config.texts, 'title')?.text ?? '');
  const c = useMemo(
    () => migrateCoverConfig(config, { title: resolvedTitle }, pageAspect),
    [config, resolvedTitle, pageAspect],
  );
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      /* The spine's colour is its own, exactly like the front's and the back's. `null` resolves
         to the legacy paint this used to hardcode, so an untouched cover is pixel-identical.
         In print mode the same colour is painted WITHOUT the screen-only edge shading. */
      style={{
        ...(print ? spinePrintBackgroundStyle(c.spine.background) : spineBackgroundStyle(c.spine.background)),
        containerType: 'size',
      }}
    >
      {renderElements && c.spine.texts.map((t) => <TextBox key={t.id} el={t} />)}
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
}) {
  const aspectRatio = pageAspect ?? 0.75;
  const { pagePct, spinePct, aspect } = coverSpreadMetrics(size, aspectRatio);
  const c = useMemo(() => migrateCoverConfig(config, { title }, aspectRatio), [config, title, aspectRatio]);
  return (
    <div className="relative w-full overflow-hidden ring-1 ring-black/10" style={{ aspectRatio: String(aspect) }}>
      <div className="flex h-full w-full">
        <div className="relative h-full" style={{ width: `${pagePct}%` }}>
          <BackCoverDesign back={c.back} imageUrl={backImageUrl} stickerUrlFor={stickerUrlFor} onReady={onReady} />
        </div>
        <div className="relative h-full" style={{ width: `${spinePct}%` }}>
          <SpineDesign config={c} title={title} pageAspect={aspectRatio} />
        </div>
        <div className="relative h-full" style={{ width: `${pagePct}%` }}>
          <CoverDesign
            imageUrl={frontImageUrl}
            imageEdit={c.imageEdit}
            background={c.background}
            layout={c.layout}
            texts={c.texts}
            stickers={c.stickers}
            qrs={c.qrs}
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

/**
 * Render the FRONT cover straight from a CoverConfig + resolved image URL.
 *
 * THE migration entry point for every read-only surface: the flipbook, the in-app preview, review
 * mode, the template galleries, the admin preview and the PDF print route all come through here,
 * so a legacy cover is converted in memory before it is drawn and every one of them shows the same
 * thing. Pure and memoized — a v2 config returns the same reference and costs one comparison.
 */
export function CoverDesignFromConfig({
  config,
  title,
  imageUrl,
  pageAspect = 0.75,
  stickerUrlFor,
  renderElements = true,
  onReady,
}: {
  config: CoverConfig;
  title: string;
  imageUrl: string | null;
  /** One cover page's width/height — migration needs it to place a legacy title block. */
  pageAspect?: number;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  renderElements?: boolean;
  onReady?: () => void;
}) {
  const c = useMemo(() => migrateCoverConfig(config, { title }, pageAspect), [config, title, pageAspect]);
  return (
    <CoverDesign
      imageUrl={imageUrl}
      imageEdit={c.imageEdit}
      background={c.background}
      layout={c.layout}
      texts={c.texts}
      stickers={c.stickers}
      qrs={c.qrs}
      stickerUrlFor={stickerUrlFor}
      renderElements={renderElements}
      onReady={onReady}
    />
  );
}
