'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackCoverDesign,
  CoverDesignFromConfig,
  SpineDesign,
} from '@/app/(app)/albums/[id]/build/_cover-render';
import PhotoFrame from '@/app/(app)/albums/[id]/build/_photo-frame';
import { coverBackgroundStyle, spinePrintBackgroundStyle, type CoverConfig } from '@/lib/builder/cover';
import type { Background, EditConfig } from '@/lib/builder/model';
import {
  COVER_ARTWORK,
  COVER_BLEED_BANDS,
  COVER_HINGE_FILL,
  COVER_PANEL,
  COVER_PANELS,
  COVER_SPREAD_BOX,
  mmCss,
  mmToPxCeil,
  type CoverPanelName,
  type MmRect,
} from '@/lib/print/spec';

/**
 * PRINTER-READY COVER — ONE flat spread, one PDF page.
 *
 *     487 × 327 mm   =   457 × 297 mm finished spread   +   15 mm wrap on all four sides
 *     457 mm         =   210 back + 10 hinge + 17 spine + 10 hinge + 210 front
 *
 * This is the complete flat artwork a case-maker wraps around the boards — not two unrelated cover
 * PDFs, and not the preview's arrangement (which prints the front, the back and the spine as three
 * separate portrait pages so a customer can page through them). That renderer is untouched.
 *
 * ── THE WRAP IS A FULL BLEED, NOT WHITE ───────────────────────────────────────────────────────
 *
 * The 15 mm turn-in is the paper that folds over the board edge and is glued down inside. It used
 * to print WHITE, which is the one thing a wrapped case cannot afford: the fold and the trim both
 * carry registration drift, so a white turn-in shows as a pale sliver along the finished edge of a
 * dark cover. Each panel's own background now BLEEDS outward into the turn-in beside it — the back
 * cover's into the left and its share of the top/bottom, the front cover's into the right, and the
 * spine and hinges straight up and down — so the cut always lands inside colour.
 *
 * NOTHING MOVED TO ACHIEVE THAT, and that is structural rather than a promise. The bleed is a
 * separate layer painted UNDERNEATH the finished spread, from `COVER_BLEED_BANDS`, which is
 * derived from the very same `COVER_PANELS` the spread is built from. The spread itself still sits
 * at exactly `COVER_SPREAD_BOX` with its five panels at exactly their specified widths, still
 * clipped with `overflow: hidden`, so every panel's artwork is the same size, in the same place,
 * with the same crop as before. The page size is untouched.
 *
 * THE BLEED CARRIES BACKGROUND ONLY — the face's colour/gradient, plus its backdrop photograph
 * where it has one. No text, no sticker, no QR, no placed overlay and no studio mark is drawn out
 * there: the turn-in is glued down out of sight, so an element that reached it would simply be
 * lost, and a partially-visible one at the fold would be worse than nothing.
 *
 * ── THE SPINE CARRIES ONLY BACKGROUND + TITLE ─────────────────────────────────────────────────
 *
 * `SpineDesign` is passed `print`, which swaps the screen-only bound-edge shading for the flat
 * chosen colour, and the flat-spread inset shadow that `CoverSpread` draws in the builder is
 * simply not rendered here. No photo, sticker, QR or album block can appear on the spine because
 * the spine's element list is `config.spine.texts` and nothing else — the same single source of
 * truth the builder edits.
 *
 * ── NO MARKS AND NO GUIDES ────────────────────────────────────────────────────────────────────
 *
 * The exported cover carries NOTHING but the artwork: no crop marks, registration marks, colour
 * bars or slug (`PRINTER_MARKS_ENABLED`), and — since the full-bleed pass — no dotted fold, spine
 * or finished-edge reference lines either (`COVER_GUIDE_LINES_ENABLED`, now false, which records
 * the decision and lets a test assert it). Those lines were reference geometry for a person
 * checking the case construction; on the file the press actually prints they are ink. Nothing was
 * substituted for them. The builder's on-screen fold/trim guides are unaffected — they are editor
 * chrome and have never been exported.
 */

/** Physical geometry, computed once. Pure — every value traces back to `lib/print/spec`. */
function buildCoverCss(): string {
  const pageW = mmToPxCeil(COVER_ARTWORK.w);
  const pageH = mmToPxCeil(COVER_ARTWORK.h);

  return `
  @page { size: ${mmCss(COVER_ARTWORK.w)} ${mmCss(COVER_ARTWORK.h)}; margin: 0; }
  html, body {
    margin: 0; padding: 0; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .print-page {
    position: relative;
    /* The fragmentainer's own dimensions (ceil of the physical size), so no strip of sheet is
       left bare along an edge. The @page size stays in exact mm — see lib/print/spec. */
    width: ${pageW}px; height: ${pageH}px;
    overflow: hidden; background: #fff;
    /*
     * THE PAGE IS A HARD BOUNDARY — the same declaration the other two print routes carry, for the
     * same reason (see "print/content/_print-content" for the measurements). This export is a
     * single page, so it sits below the page count where Chromium starts folding a page's
     * scrollable overflow into the print sheet; the containment is here so a cover that overflows
     * its panels can never start doing so, rather than because it is failing today.
     */
    contain: strict;
  }
  /* THE BLEED. One band per panel, spanning the full artwork height, painted UNDER the finished
     spread — so it fills the 15 mm turn-in and is completely hidden everywhere else. */
  .cover-bleed { position: absolute; inset: 0; }
  .bleed-band { position: absolute; top: 0; height: 100%; overflow: hidden; }
  /* THE FINISHED SPREAD. Inset by exactly the wrap, and clipped — unchanged. Everything the
     customer designed is inside this box, at the millimetre it was always at. */
  .cover-spread {
    position: absolute;
    left: ${mmCss(COVER_SPREAD_BOX.x)}; top: ${mmCss(COVER_SPREAD_BOX.y)};
    width: ${mmCss(COVER_SPREAD_BOX.w)}; height: ${mmCss(COVER_SPREAD_BOX.h)};
    overflow: hidden;
  }
  /* Each panel is positioned in absolute millimetres from the spread's own origin, so the
     210 / 10 / 17 / 10 / 210 construction is exact and independent of any page proportion. */
  .cover-panel { position: absolute; top: 0; height: 100%; overflow: hidden; }
`;
}

declare global {
  interface Window {
    __ALBUM_PRINT_READY?: boolean;
  }
}

/** A panel's absolute position INSIDE the spread (the spec's rects are in artwork coordinates). */
function panelStyle(name: CoverPanelName): { left: string; width: string } {
  const rect: MmRect = COVER_PANELS.find((p) => p.name === name)!.rect;
  return { left: mmCss(rect.x - COVER_SPREAD_BOX.x), width: mmCss(rect.w) };
}

/** A bleed band's absolute position on the PAGE (artwork coordinates, full height). */
function bandStyle(name: CoverPanelName): { left: string; width: string } {
  const rect: MmRect = COVER_BLEED_BANDS.find((b) => b.name === name)!.rect;
  return { left: mmCss(rect.x), width: mmCss(rect.w) };
}

/**
 * ONE BLEED BAND — a face's background carried out into the turn-in beside it.
 *
 * It paints exactly what the panel above it paints as its GROUND, from the same functions: the
 * face's chosen colour or gradient via `coverBackgroundStyle`, and — when that face has a backdrop
 * photograph — the same photograph, with the same stored `edit`, through the same `PhotoFrame`.
 * The face renderer switches its own ground to the dark house green behind a photo, so this does
 * the same, and a photo that fails to load leaves the face's colour showing rather than white.
 *
 * `onReady` is deliberately NOT passed: the readiness gate counts the real panels, and a duplicate
 * of an image the browser is already fetching must not be able to move that count. Nor may it hold
 * generation up — it is the same URL, served from the same cache.
 */
function BleedBand({
  name,
  background,
  imageUrl = null,
  imageEdit = null,
  style,
}: {
  name: CoverPanelName;
  /** The face's stored background. `null` resolves to the same default the face itself uses. */
  background?: Background | null;
  imageUrl?: string | null;
  imageEdit?: EditConfig | null;
  /** An explicit ground, for the hinges — whose fill is a policy value, not a face's property. */
  style?: React.CSSProperties;
}) {
  const ground = style ?? (imageUrl ? { background: '#1e3a2f' } : coverBackgroundStyle(background ?? null));
  return (
    <div className="bleed-band" style={{ ...bandStyle(name), ...ground }} aria-hidden>
      {imageUrl && <PhotoFrame url={imageUrl} edit={imageEdit} />}
    </div>
  );
}

export default function PrintCover({
  config,
  title,
  frontImageUrl,
  backImageUrl,
  stickerUrls = {},
  coverPhotos = {},
}: {
  config: CoverConfig;
  /** The album title — the fallback a v1 cover's spine and title objects migrate from. */
  title: string;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  stickerUrls?: Record<string, string>;
  /** Photos placed as overlays on a cover face, by id — resolved by `loadPrintAlbum`. */
  coverPhotos?: Record<string, { url: string; edit: EditConfig | null }>;
}) {
  const stickerUrlFor = useCallback((id: string) => stickerUrls[id], [stickerUrls]);
  const photoFor = useCallback(
    (id: string | null | undefined) => {
      const p = id ? coverPhotos[id] : undefined;
      return p ? { url: p.url, edit: p.edit } : undefined;
    },
    [coverPhotos],
  );

  /**
   * The migration entry points (`CoverDesignFromConfig` / `BackCoverDesign` / `SpineDesign`) need
   * the page proportions a legacy cover's title block was laid out against. A cover FACE is
   * 210 × 297 mm here — the finished panel — so print uses the panel's own aspect rather than the
   * album product's, and a legacy title stack lands where the geometry says it should.
   */
  const facePageAspect = COVER_PANEL.w / COVER_PANEL.h;

  // Readiness: the worker waits on this flag. Count only frames that actually load a remote image
  // — the two face backdrops (when they have one) and each resolvable sticker. The spine loads
  // nothing (text only), so it never affects the gate.
  const totalFrames = useMemo(() => {
    const faceStickers =
      config.stickers.filter((s) => stickerUrls[s.stickerId]).length +
      config.back.stickers.filter((s) => stickerUrls[s.stickerId]).length;
    // Each RESOLVABLE cover overlay loads one more remote image, and the renderer skips the ones
    // it cannot resolve — so the count and what actually renders agree, and a deleted photo can
    // never leave the gate waiting for a frame that will never arrive.
    const faceOverlays = config.back.overlays.filter((o) => o.photoId && coverPhotos[o.photoId]).length;
    // Both face renderers signal readiness once whether or not they carry an image (an
    // image-less face fires on mount), so both always count.
    return 2 + faceStickers + faceOverlays;
  }, [config, stickerUrls, coverPhotos]);

  const [, setLoaded] = useState(0);
  const loadedRef = useRef(0);

  const markReady = useCallback(() => {
    window.__ALBUM_PRINT_READY = true;
  }, []);

  useEffect(() => {
    if (totalFrames === 0) markReady();
  }, [totalFrames, markReady]);

  // Safety net so a stuck <img> can't hang the worker for its full render budget.
  useEffect(() => {
    const t = setTimeout(markReady, 12_000);
    return () => clearTimeout(t);
  }, [markReady]);

  const onFrameReady = useCallback(() => {
    loadedRef.current += 1;
    setLoaded(loadedRef.current);
    if (loadedRef.current >= totalFrames) markReady();
  }, [totalFrames, markReady]);

  /**
   * The hinge fill. `COVER_HINGE_FILL` is the single, documented policy value (see lib/print/spec):
   * the folding groove continues the SPINE's chosen colour so the bound edge reads as one surface,
   * and no cover artwork is introduced into a region the specification does not describe.
   */
  const hingeStyle =
    COVER_HINGE_FILL === 'spine' ? spinePrintBackgroundStyle(config.spine.background) : undefined;

  /** The spine's own ground, reused for its bleed band so the bound edge runs edge to edge. */
  const spineStyle = spinePrintBackgroundStyle(config.spine.background);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: buildCoverCss() }} />

      <div className="print-page">
        {/*
          THE BLEED, UNDERNEATH EVERYTHING. Five bands, one per panel, each carrying that panel's
          ground out to the artwork's own edges. Only the outer two widen (into the left and right
          turn-in); the three interior bands keep the exact fold widths, so the spine reads 17 mm
          from top to bottom of the sheet and the hinges stay 10 mm. Every visible pixel of the
          finished spread is drawn by the layer below, which covers this completely.
        */}
        <div className="cover-bleed">
          <BleedBand
            name="back"
            background={config.back.background}
            imageUrl={backImageUrl}
            imageEdit={config.back.imageEdit}
          />
          <BleedBand name="hinge-left" style={hingeStyle} />
          <BleedBand name="spine" style={spineStyle} />
          <BleedBand name="hinge-right" style={hingeStyle} />
          <BleedBand
            name="front"
            background={config.background}
            imageUrl={frontImageUrl}
            imageEdit={config.imageEdit}
          />
        </div>

        <div className="cover-spread">
          {/* BACK COVER — 210 mm. The left-hand panel of the printed spread. */}
          <div className="cover-panel" style={panelStyle('back')}>
            <BackCoverDesign
              back={config.back}
              imageUrl={backImageUrl}
              photoFor={photoFor}
              stickerUrlFor={stickerUrlFor}
              onReady={onFrameReady}
            />
          </div>

          {/* LEFT HINGE — 10 mm. */}
          <div className="cover-panel" style={{ ...panelStyle('hinge-left'), ...hingeStyle }} />

          {/* SPINE — 17 mm, fixed for every page count. Background colour + title text only. */}
          <div className="cover-panel" style={panelStyle('spine')}>
            <SpineDesign config={config} title={title} pageAspect={facePageAspect} print />
          </div>

          {/* RIGHT HINGE — 10 mm. */}
          <div className="cover-panel" style={{ ...panelStyle('hinge-right'), ...hingeStyle }} />

          {/* FRONT COVER — 210 mm. The book's face. */}
          <div className="cover-panel" style={panelStyle('front')}>
            <CoverDesignFromConfig
              config={config}
              title={title}
              imageUrl={frontImageUrl}
              pageAspect={facePageAspect}
              stickerUrlFor={stickerUrlFor}
              onReady={onFrameReady}
            />
          </div>
        </div>
      </div>
    </>
  );
}
