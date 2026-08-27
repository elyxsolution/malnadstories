'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackCoverDesign,
  CoverDesignFromConfig,
  SpineDesign,
} from '@/app/(app)/albums/[id]/build/_cover-render';
import { spinePrintBackgroundStyle, type CoverConfig } from '@/lib/builder/cover';
import {
  COVER_ARTWORK,
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
 *     483 × 327 mm   =   453 × 297 mm finished spread   +   15 mm wrap on all four sides
 *     453 mm         =   210 back + 10 hinge + 13 spine + 10 hinge + 210 front
 *
 * This is the complete flat artwork a case-maker wraps around the boards — not two unrelated cover
 * PDFs, and not the preview's arrangement (which prints the front, the back and the spine as three
 * separate portrait pages so a customer can page through them). That renderer is untouched.
 *
 * ── THE WRAP IS BLANK, AND THAT IS ENFORCED STRUCTURALLY ──────────────────────────────────────
 *
 * The 15 mm turn-in is the paper that folds over the board edge and is glued down inside. Nothing
 * is drawn there: no artwork extension, no photo, no decorative element, no spine text, no
 * gradient. It is enforced by GEOMETRY rather than by a rule someone has to remember — the page is
 * white, and every panel is a child of a `.cover-spread` box inset by exactly the wrap and clipped
 * with `overflow: hidden`. A design that overflowed its panel is cut at the finished edge; it
 * cannot reach the wrap.
 *
 * ── THE SPINE CARRIES ONLY BACKGROUND + TITLE ─────────────────────────────────────────────────
 *
 * `SpineDesign` is passed `print`, which swaps the screen-only bound-edge shading for the flat
 * chosen colour, and the flat-spread inset shadow that `CoverSpread` draws in the builder is
 * simply not rendered here. No photo, sticker, QR or album block can appear on the spine because
 * the spine's element list is `config.spine.texts` and nothing else — the same single source of
 * truth the builder edits.
 *
 * ── NO PRINTER MARKS ──────────────────────────────────────────────────────────────────────────
 *
 * No crop marks, registration marks, colour bars, slug or trim-line artwork are drawn anywhere.
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
  /* THE WRAP. The page is white and the spread is inset by exactly 15 mm on every side, so the
     turn-in region is blank because nothing is positioned in it — not because anything erases it. */
  .print-page {
    position: relative;
    /* The fragmentainer's own dimensions (ceil of the physical size), so no strip of sheet is
       left bare along an edge. The @page size stays in exact mm — see lib/print/spec. */
    width: ${pageW}px; height: ${pageH}px;
    overflow: hidden; background: #fff;
  }
  .cover-spread {
    position: absolute;
    left: ${mmCss(COVER_SPREAD_BOX.x)}; top: ${mmCss(COVER_SPREAD_BOX.y)};
    width: ${mmCss(COVER_SPREAD_BOX.w)}; height: ${mmCss(COVER_SPREAD_BOX.h)};
    overflow: hidden;
  }
  /* Each panel is positioned in absolute millimetres from the spread's own origin, so the
     210 / 10 / 13 / 10 / 210 construction is exact and independent of any page proportion. */
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

export default function PrintCover({
  config,
  title,
  frontImageUrl,
  backImageUrl,
  stickerUrls = {},
}: {
  config: CoverConfig;
  /** The album title — the fallback a v1 cover's spine and title objects migrate from. */
  title: string;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  stickerUrls?: Record<string, string>;
}) {
  const stickerUrlFor = useCallback((id: string) => stickerUrls[id], [stickerUrls]);

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
    // Both face renderers signal readiness once whether or not they carry an image (an
    // image-less face fires on mount), so both always count.
    return 2 + faceStickers;
  }, [config, stickerUrls]);

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

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: buildCoverCss() }} />

      <div className="print-page">
        <div className="cover-spread">
          {/* BACK COVER — 210 mm. The left-hand panel of the printed spread. */}
          <div className="cover-panel" style={panelStyle('back')}>
            <BackCoverDesign
              back={config.back}
              imageUrl={backImageUrl}
              stickerUrlFor={stickerUrlFor}
              onReady={onFrameReady}
            />
          </div>

          {/* LEFT HINGE — 10 mm. */}
          <div className="cover-panel" style={{ ...panelStyle('hinge-left'), ...hingeStyle }} />

          {/* SPINE — 13 mm, fixed for every page count. Background colour + title text only. */}
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
