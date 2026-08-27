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
  COVER_FOLD_LINES_MM,
  COVER_HINGE_FILL,
  COVER_PANEL,
  COVER_PANELS,
  COVER_SPREAD_BOX,
  GUIDE_STYLE,
  dashArray,
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
 * ── REFERENCE LINES, BUT NO PRINTER MARKS ─────────────────────────────────────────────────────
 *
 * The cover DOES carry black dotted fold / spine / finished-edge reference lines — an explicit
 * project requirement, with the pattern and positions taken from the supplied drawing. See
 * `CoverGuides` for why those are not printer marks. No crop marks, registration marks, colour
 * bars or slug are drawn, here or anywhere else.
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
  /* The reference lines sit ABOVE the artwork so they stay readable over a dark photo, and cover
     the whole page so their millimetre viewBox maps 1:1 onto the artwork coordinates. */
  .cover-guides { position: absolute; inset: 0; width: 100%; height: 100%; }
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

/**
 * THE REFERENCE / PARTITION LINES — an explicit requirement, drawn from `dimensions.pdf`.
 *
 * These are NOT printer marks. A crop mark tells a machine where to cut; these tell a PERSON where
 * the case creases, so the back / hinge / spine / hinge / front construction can be checked
 * against the specification on the printed artwork itself. No crop marks, registration marks,
 * colour bars or slug are drawn anywhere.
 *
 * ── WHY SVG, IN MILLIMETRES ───────────────────────────────────────────────────────────────────
 *
 * The viewBox is the artwork in millimetres, so every coordinate below IS the spec value — 225,
 * 235, 248, 258 — with no conversion to get wrong. `preserveAspectRatio="none"` maps the box onto
 * the fragmentainer-ceilinged page exactly, so the lines land on the folds to within the same
 * sub-pixel the whole page already carries.
 *
 * VERIFIED IN THE EXPORTED FILE, not assumed: Chromium converts a dashed SVG stroke into explicit
 * filled VECTOR subpaths — one thin quad per dash — which is the same encoding `dimensions.pdf`
 * itself uses for its guides. Nothing is rasterised. In a generated cover the dash subpaths sit at
 * x = 225.275 / 235.275 / 248.275 / 258.275 (each fold ± half of the 0.55 mm width) and the
 * finished-edge rule at x = 14.75 / 468.25, in black.
 *
 * ── THE PATTERN ───────────────────────────────────────────────────────────────────────────────
 *
 * Measured out of Plate 02 rather than invented (`GUIDE_STYLE`): the folds use the drawing's
 * dash-dot centre line (7 · 2 · 1.6 · 2 mm at 0.55 mm), the finished edge its finer 3 · 2.2 mm at
 * 0.5 mm. Black, per the product decision recorded in the spec.
 *
 * ── THE WRAP STAYS BLANK ──────────────────────────────────────────────────────────────────────
 *
 * Every line is confined to the finished spread (y 15 → 312, x 15 → 468). The drawing runs its
 * fold guides through the full artwork height, but the 15 mm turn-in is required to be blank and a
 * reference line is not an exception to that — it would be glued down inside the case anyway.
 */
function CoverGuides() {
  const { fold, trim, color } = GUIDE_STYLE;
  const top = COVER_SPREAD_BOX.y;
  const bottom = COVER_SPREAD_BOX.y + COVER_SPREAD_BOX.h;

  return (
    <svg
      className="cover-guides"
      viewBox={`0 0 ${COVER_ARTWORK.w} ${COVER_ARTWORK.h}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* The finished edge — where the 483 × 327 artwork is trimmed back to 453 × 297. */}
      <rect
        x={COVER_SPREAD_BOX.x}
        y={COVER_SPREAD_BOX.y}
        width={COVER_SPREAD_BOX.w}
        height={COVER_SPREAD_BOX.h}
        fill="none"
        stroke={color}
        strokeWidth={trim.widthMm}
        strokeDasharray={dashArray(trim.dashMm)}
      />
      {/* The four folds: back|hinge · hinge|spine · spine|hinge · hinge|front. The middle pair IS
          the 13 mm spine, so its width is readable straight off the printed sheet. */}
      {COVER_FOLD_LINES_MM.map((x) => (
        <line
          key={x}
          x1={x}
          y1={top}
          x2={x}
          y2={bottom}
          stroke={color}
          strokeWidth={fold.widthMm}
          strokeDasharray={dashArray(fold.dashMm)}
        />
      ))}
    </svg>
  );
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

        {/* Dotted fold / spine / finished-edge reference lines — an explicit requirement, drawn
            from dimensions.pdf. Above the artwork, never inside the wrap. */}
        <CoverGuides />
      </div>
    </>
  );
}
