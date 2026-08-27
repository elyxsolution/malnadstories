/**
 * THE PRINT SPECIFICATION — the single authoritative source of every physical millimetre value
 * in the printer-ready exports (`dimensions.pdf`, Plates 01 + 02).
 *
 * PURE + DETERMINISTIC. No `server-only`, no `'use client'`, no I/O, no React — so the print
 * routes (server components), their renderers (client components), the admin UI and the tests all
 * derive geometry from THIS module and nothing else. A raw millimetre number must never appear in
 * a component, a stylesheet, the worker, or a test fixture; if one is needed, it is added here.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────────────────────────
 *
 * It is NOT the builder's geometry. The builder keeps its own coordinate system (a percentage
 * space inside an open pair, sized from `ProductDimensions`) and is deliberately untouched by
 * this file. The relationship is one-directional and happens only at export time:
 *
 *     album design (builder space)  →  print transformation (here)  →  printer-ready PDF
 *
 * It is also NOT a customer-facing concept. Nothing here is rendered as a guide, a ruler or an
 * overlay in the builder — the safe areas are advisory geometry the export layer reports on, not
 * a crop it applies. Clipping a customer's photo at a safe-area boundary would be a silent,
 * destructive change to their design; the trim is the printer's job, not ours.
 *
 * ── COORDINATE CONVENTION ─────────────────────────────────────────────────────────────────────
 *
 * Every `MmRect` in this module is expressed in the ARTWORK coordinate space of its own export,
 * with a TOP-LEFT origin and millimetre units — the same convention a prepress operator reads off
 * the supplied drawing. For the interior that space is 206 × 291; for the cover it is 483 × 327.
 */

// ── Units ────────────────────────────────────────────────────────────────────────────────────

/** Millimetres per inch. The one conversion constant everything else is derived from. */
export const MM_PER_INCH = 25.4;
/** CSS reference pixels per inch (fixed by the CSS spec — not a device property). */
export const CSS_PX_PER_INCH = 96;
/** PostScript points per inch. A PDF MediaBox is expressed in these. */
export const PDF_PT_PER_INCH = 72;

/** Millimetres → CSS reference pixels (exact, unrounded). */
export function mmToPx(mm: number): number {
  return (mm / MM_PER_INCH) * CSS_PX_PER_INCH;
}

/** Millimetres → PDF points. This is the unit a PDF MediaBox is measured in. */
export function mmToPt(mm: number): number {
  return (mm / MM_PER_INCH) * PDF_PT_PER_INCH;
}

/**
 * Millimetres → CSS pixels, rounded UP to Chromium's print fragmentainer.
 *
 * This mirrors `pageAxisPx` in `_print-album.tsx`, and it exists for the reason measured and
 * documented there: Chromium lays a printed page out in a fragmentainer whose size is the CEILING
 * of the `@page` size in CSS px, while an element sized in the same physical unit is the exact
 * fraction. A page element sized at the exact fraction therefore stops a fraction of a pixel short
 * of the sheet on every page — and that shortfall IS the hairline white band along the page edge
 * (and, where a forced break was not in effect, a sliver of the following page).
 *
 *      206mm  =  778.583… px   ← what an `mm`-sized element measures
 *      fragmentainer   779  px   ← ceil(); the sheet Chromium actually paints
 *
 * The `@page size` stays in exact millimetres, so the PDF's PHYSICAL page size is unchanged and
 * still exact; the sub-pixel of overscan falls outside the media box and is clipped.
 */
export function mmToPxCeil(mm: number): number {
  return Math.ceil(mmToPx(mm));
}

/** A CSS length in exact millimetres — what `@page size` is written in. */
export function mmCss(mm: number): string {
  return `${round(mm, 4)}mm`;
}

/** Round to `places` decimals without accumulating float noise in the output. */
function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

// ── Shared shapes ────────────────────────────────────────────────────────────────────────────

/** A rectangle in millimetres, top-left origin, in its export's artwork coordinate space. */
export type MmRect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** A page size in millimetres. */
export type MmSize = { readonly w: number; readonly h: number };

/** A page size in PDF points — the MediaBox a prepress check reads. */
export type PtSize = { readonly w: number; readonly h: number };

/** Convert a millimetre size to PDF points (2 decimals — enough to compare a MediaBox by eye). */
export function toPt(size: MmSize): PtSize {
  return { w: round(mmToPt(size.w), 2), h: round(mmToPt(size.h), 2) };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INTERIOR / CONTENT PAGES — Plate 01
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Finished (trim) size of one interior page. */
export const INTERIOR_TRIM: MmSize = { w: 200, h: 285 };

/** Bleed on all four sides of an interior page. */
export const INTERIOR_BLEED_MM = 3;

/**
 * Important-content exclusion inset, measured from each TRIM edge.
 *
 * PRODUCT DECISION — 15 mm on ALL FOUR sides. Plate 01 draws its safe guides at 10 mm inside trim
 * and calls out a *separate* 15 mm binding strip on the left/spine edge only. This export
 * deliberately applies the wider 15 mm uniformly, so a page is safe whichever edge ends up in the
 * gutter. Advisory: reported, never enforced by clipping.
 */
export const INTERIOR_SAFE_INSET_MM = 15;

/** The supplied artwork/PDF page size — trim plus bleed on every side. */
export const INTERIOR_ARTWORK: MmSize = {
  w: INTERIOR_TRIM.w + INTERIOR_BLEED_MM * 2,
  h: INTERIOR_TRIM.h + INTERIOR_BLEED_MM * 2,
};

/** The trim box inside the interior artwork — where the printer cuts. */
export const INTERIOR_TRIM_BOX: MmRect = {
  x: INTERIOR_BLEED_MM,
  y: INTERIOR_BLEED_MM,
  w: INTERIOR_TRIM.w,
  h: INTERIOR_TRIM.h,
};

/** The interior safe box — important content must stay inside it. Advisory only. */
export const INTERIOR_SAFE_BOX: MmRect = {
  x: INTERIOR_BLEED_MM + INTERIOR_SAFE_INSET_MM,
  y: INTERIOR_BLEED_MM + INTERIOR_SAFE_INSET_MM,
  w: INTERIOR_TRIM.w - INTERIOR_SAFE_INSET_MM * 2,
  h: INTERIOR_TRIM.h - INTERIOR_SAFE_INSET_MM * 2,
};

/**
 * THE TRIM BOX AS A FRACTION OF THE ARTWORK BOX — the builder's reference guide.
 *
 * The builder draws each page at whatever pixel size the workspace fit produces, in a normalized
 * 0..1 coordinate space. Its page rectangle IS the artwork/bleed area, because that is what the
 * export's scale-to-fill maps it onto. So "where does the paper actually get cut?" is a fixed
 * FRACTION of that rectangle — exactly `3/206` horizontally and `3/291` vertically — and never a
 * hand-tuned percentage. This is what makes the on-screen guide and the printed sheet the same
 * geometry rather than two things that merely look alike.
 */
export const INTERIOR_TRIM_INSET_FRACTION = {
  x: INTERIOR_BLEED_MM / INTERIOR_ARTWORK.w,
  y: INTERIOR_BLEED_MM / INTERIOR_ARTWORK.h,
} as const;

/**
 * The 15 mm important-content boundary, as a fraction of the artwork box.
 * `(3 + 15) / 206` and `(3 + 15) / 291` — measured from the artwork edge, i.e. 15 mm inside trim.
 */
export const INTERIOR_SAFE_INSET_FRACTION = {
  x: (INTERIOR_BLEED_MM + INTERIOR_SAFE_INSET_MM) / INTERIOR_ARTWORK.w,
  y: (INTERIOR_BLEED_MM + INTERIOR_SAFE_INSET_MM) / INTERIOR_ARTWORK.h,
} as const;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// COVER — Plate 02
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** One finished cover panel (front and back are identical). */
export const COVER_PANEL: MmSize = { w: 210, h: 297 };

/** The hinge / fold band on each side of the spine. */
export const COVER_HINGE_MM = 10;

/**
 * THE SPINE WIDTH — 13 mm, for EVERY supported page count.
 *
 * This is a fixed specification value, not a derivation. `spineWidthFor()` in
 * `lib/builder/cover.ts` returns a page-count-dependent FRACTION of a page width and is documented
 * there as "advisory: a faithful preview proportion, not a pre-press measurement". It drives the
 * builder canvas and the in-app preview and is deliberately left alone; it must never reach the
 * print geometry. See `spinePrintWidthMm()` below, which takes the page count and ignores it on
 * purpose so the intent is testable rather than implicit.
 */
export const COVER_SPINE_MM = 13;

/** The wrap / turn-in on all four sides of the cover artwork. Rendered BLANK — see the cover route. */
export const COVER_WRAP_MM = 15;

/**
 * Cover safe inset, measured from each finished edge AND from each hinge fold line.
 *
 * DERIVED FROM PLATE 02, not invented: the drawing's safe guides sit at x = 79, 265, 322, 508 and
 * y = 55, 328 in its own millimetre space, where the finished flat spread occupies x 67→520 and
 * y 43→340 and the folds fall at 277 / 287 / 300 / 310. Every one of those guides is exactly 12 mm
 * inside a finished edge or a fold. Advisory: reported, never enforced by clipping.
 */
export const COVER_SAFE_INSET_MM = 12;

/**
 * The spine's printed width in millimetres.
 *
 * Takes the album's content page count so that "the page count does not affect the spine" is an
 * assertion a test can make against a real signature, rather than a comment nobody checks.
 */
// The parameter is INTENTIONALLY unused — see above. Accepting and ignoring the page count is
// what lets `print-spec.test.ts` assert "13 mm for every page count" against a real signature
// instead of trusting a comment, so the lint rule is disabled here rather than the argument dropped.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function spinePrintWidthMm(_contentPageCount?: number): number {
  return COVER_SPINE_MM;
}

/** The finished flat spread: back · hinge · spine · hinge · front, at full cover height. */
export const COVER_FINISHED_SPREAD: MmSize = {
  w: COVER_PANEL.w * 2 + COVER_HINGE_MM * 2 + COVER_SPINE_MM,
  h: COVER_PANEL.h,
};

/** The supplied cover artwork/PDF size — the finished spread plus the wrap on every side. */
export const COVER_ARTWORK: MmSize = {
  w: COVER_FINISHED_SPREAD.w + COVER_WRAP_MM * 2,
  h: COVER_FINISHED_SPREAD.h + COVER_WRAP_MM * 2,
};

/** The finished spread's position inside the cover artwork (i.e. inset by the wrap). */
export const COVER_SPREAD_BOX: MmRect = {
  x: COVER_WRAP_MM,
  y: COVER_WRAP_MM,
  w: COVER_FINISHED_SPREAD.w,
  h: COVER_FINISHED_SPREAD.h,
};

/** The five panels of the flat spread, left to right, as printed (outside view, face up). */
export type CoverPanelName = 'back' | 'hinge-left' | 'spine' | 'hinge-right' | 'front';

/** One panel, positioned in the 483 × 327 artwork coordinate space. */
export type CoverPanel = { readonly name: CoverPanelName; readonly rect: MmRect };

/**
 * The five panels in printed order, positioned in ARTWORK coordinates.
 *
 * Built by walking left to right from the spread's own origin, so the construction
 * 210 + 10 + 13 + 10 + 210 = 453 is expressed once, as arithmetic, and cannot drift.
 */
export const COVER_PANELS: readonly CoverPanel[] = buildCoverPanels();

function buildCoverPanels(): readonly CoverPanel[] {
  const widths: readonly [CoverPanelName, number][] = [
    ['back', COVER_PANEL.w],
    ['hinge-left', COVER_HINGE_MM],
    ['spine', COVER_SPINE_MM],
    ['hinge-right', COVER_HINGE_MM],
    ['front', COVER_PANEL.w],
  ];
  const panels: CoverPanel[] = [];
  let x = COVER_SPREAD_BOX.x;
  for (const [name, w] of widths) {
    panels.push({ name, rect: { x, y: COVER_SPREAD_BOX.y, w, h: COVER_SPREAD_BOX.h } });
    x += w;
  }
  return panels;
}

/** Look one panel up by name. Throws on an unknown name — the panel set is closed. */
export function coverPanel(name: CoverPanelName): CoverPanel {
  const found = COVER_PANELS.find((p) => p.name === name);
  if (!found) throw new Error(`unknown cover panel "${name}"`);
  return found;
}

/**
 * The safe box of a finished cover panel, in artwork coordinates.
 *
 * Only the two cover faces have one: the hinges and the spine sit entirely OUTSIDE the safe area
 * by construction (each face's safe box stops 12 mm short of its hinge fold), which is exactly
 * what Plate 02's guides at x = 265 and x = 322 record.
 */
export function coverSafeBox(face: 'back' | 'front'): MmRect {
  const { rect } = coverPanel(face);
  return {
    x: rect.x + COVER_SAFE_INSET_MM,
    y: rect.y + COVER_SAFE_INSET_MM,
    w: rect.w - COVER_SAFE_INSET_MM * 2,
    h: rect.h - COVER_SAFE_INSET_MM * 2,
  };
}

/** The back cover's safe box — 186 × 273 mm at x 27→213, y 27→300. */
export const COVER_BACK_SAFE_BOX: MmRect = coverSafeBox('back');
/** The front cover's safe box — 186 × 273 mm at x 270→456, y 27→300. */
export const COVER_FRONT_SAFE_BOX: MmRect = coverSafeBox('front');

/**
 * THE FOUR FOLD LINES, in artwork coordinates — where the case actually creases.
 *
 * Derived by walking the panels, never restated: back|hinge at 225, hinge|spine at 235,
 * spine|hinge at 248, hinge|front at 258. Plate 02 draws its fold guides at x = 277 / 287 / 300 /
 * 310 in the drawing's own millimetre space, where the finished spread starts at 67 — i.e. at
 * 210 / 220 / 233 / 243 from the spread's left edge, which is exactly what these are.
 */
export const COVER_FOLD_LINES_MM: readonly number[] = COVER_PANELS.slice(0, -1).map(
  (p) => p.rect.x + p.rect.w,
);

/**
 * The same four folds as a fraction of the FINISHED SPREAD's width — the form the builder overlay
 * needs, since the builder draws the spread at whatever pixel width the workspace fit produces.
 */
export const COVER_FOLD_FRACTIONS: readonly number[] = COVER_FOLD_LINES_MM.map(
  (x) => (x - COVER_SPREAD_BOX.x) / COVER_SPREAD_BOX.w,
);

/** Each panel's span as a fraction of the finished spread — back · hinge · spine · hinge · front. */
export const COVER_PANEL_FRACTIONS: readonly { name: CoverPanelName; start: number; width: number }[] =
  COVER_PANELS.map((p) => ({
    name: p.name,
    start: (p.rect.x - COVER_SPREAD_BOX.x) / COVER_SPREAD_BOX.w,
    width: p.rect.w / COVER_SPREAD_BOX.w,
  }));

/**
 * GUIDE LINE STYLE — measured out of `dimensions.pdf`, not invented.
 *
 * Plate 02 draws its guides as explicit filled paths rather than PDF dash arrays, so the pattern
 * had to be read off the geometry. The fold lines at x = 277/287/300/310 are 0.55 mm wide and
 * repeat `7 mm dash · 2 mm gap · 1.6 mm dash · 2 mm gap` — the dash-dot centre line an engineering
 * drawing uses for a fold. The finer guides (the safe-area rules at x = 79/265/322/508) are 0.5 mm
 * wide and repeat `3 mm dash · 2.2 mm gap`.
 *
 * The drawing strokes them in a blue-grey (`.349 .502 .651`); the exported cover uses BLACK, which
 * is an explicit product decision — these are reference lines a person reads off the printed
 * artwork, and they have to survive a greyscale proof.
 */
export const GUIDE_STYLE = {
  /** Fold / panel divisions: the dash-dot centre line, 7 · 2 · 1.6 · 2 mm. */
  fold: { dashMm: [7, 2, 1.6, 2] as readonly number[], widthMm: 0.55 },
  /** Finished-edge / trim references: 3 · 2.2 mm. */
  trim: { dashMm: [3, 2.2] as readonly number[], widthMm: 0.5 },
  /** Black — see above. */
  color: '#000000',
} as const;

/** A CSS/SVG `stroke-dasharray` value in millimetres for one of the guide patterns. */
export function dashArray(pattern: readonly number[]): string {
  return pattern.join(' ');
}

/**
 * WHAT IS PAINTED IN THE TWO 10 MM HINGES.
 *
 * The supplied specification fixes the hinge WIDTH but says nothing about its content. The hinge
 * is the folding groove of the case on either side of the spine, so this export continues the
 * SPINE's background across it: the coloured band of the bound edge reads as one continuous
 * surface, and no photo, sticker, text or other cover artwork is ever introduced into a region the
 * drawing does not describe.
 *
 * The alternative — extending the adjacent cover panel's artwork across the hinge — is equally
 * defensible physically. It is one value, in one place, precisely so the print partner's answer
 * can be applied without touching the renderer. THIS REQUIRES CONFIRMATION FROM THE PRINTER.
 */
export const COVER_HINGE_FILL: 'spine' | 'blank' = 'spine';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Design → print transformation
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * SCALE-TO-FILL. Uniformly scale a source of aspect `sourceAspect` (width ÷ height) until it
 * completely covers `target`, then centre it. Returns the scaled box in the target's own units.
 *
 * This is the answer to the aspect-ratio mismatch between the builder's page (A4-derived, 0.7071)
 * and the interior bleed box (206 ÷ 291 = 0.7079): the design is never stretched, never
 * letterboxed, and its bleed is never fabricated from mirrored pixels — it is enlarged until the
 * bleed box is covered and the fraction of a millimetre that falls outside is trimmed away.
 *
 * `overscan` is added to the covering dimension before centring. It exists for the same measured
 * reason as `mmToPxCeil`: Chromium resolves sub-pixel layout independently of our arithmetic, so a
 * box that covers EXACTLY can still leave a hairline of bare sheet at one edge. One reference
 * pixel of uniform overscan removes that possibility. It is a scale, not a distortion — the aspect
 * ratio of the result is exactly `sourceAspect`.
 */
export function scaleToFill(
  sourceAspect: number,
  target: { readonly w: number; readonly h: number },
  overscan = 0,
): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  if (!Number.isFinite(sourceAspect) || sourceAspect <= 0) {
    throw new Error(`scaleToFill: sourceAspect must be a positive finite number (got ${sourceAspect})`);
  }
  // Cover on whichever axis is binding: match the target's width, or the width the target's
  // height demands at this aspect — whichever is larger.
  const w = Math.max(target.w, target.h * sourceAspect) + overscan;
  const h = w / sourceAspect;
  return { x: (target.w - w) / 2, y: (target.h - h) / 2, w, h };
}

/** One reference pixel of overscan — see `scaleToFill`. */
export const FILL_OVERSCAN_PX = 1;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Resolution
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The specification's target resolution at final size. Used to REPORT on a page's effective
 * resolution; it is deliberately not a gate — a customer's photograph is the photograph they have,
 * and refusing to print a book because one frame lands at 280 ppi is not a decision this layer
 * gets to make. Upscaling to manufacture the number would be worse: it would claim a quality the
 * source never had.
 */
export const TARGET_PPI = 300;

/** The printed width of one interior page, in inches — the denominator of any effective-ppi sum. */
export function interiorPageWidthInches(): number {
  return INTERIOR_TRIM.w / MM_PER_INCH;
}

/**
 * The effective resolution a source image achieves across a printed width.
 * `sourcePx` is the number of source pixels mapped onto `printedMm` millimetres of paper.
 */
export function effectivePpi(sourcePx: number, printedMm: number): number {
  if (printedMm <= 0) return 0;
  return sourcePx / (printedMm / MM_PER_INCH);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Printer marks
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * NO PRINTER MARKS are emitted: no crop marks, no registration marks, no colour bars, no slug and
 * no filename strip. This constant exists so the intent is assertable by a test rather than
 * provable only by reading every renderer.
 *
 * THE COVER'S DOTTED PARTITION LINES ARE NOT PRINTER MARKS, and this is a deliberate distinction
 * rather than a loophole. A crop mark tells a cutting machine where to cut and is stripped before
 * production; the cover's fold/spine lines are REFERENCE geometry a person reads off the artwork
 * to check the case was built to the right widths — an explicit project requirement, drawn from
 * the supplied specification, and confined to the cover. The interior emits nothing at all.
 */
export const PRINTER_MARKS_ENABLED = false;

/**
 * The cover export draws the dotted fold / spine / finished-edge reference lines described above.
 * Deliberately separate from `PRINTER_MARKS_ENABLED`, which stays false.
 */
export const COVER_GUIDE_LINES_ENABLED = true;
