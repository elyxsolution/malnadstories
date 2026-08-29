/**
 * Album Product — shared, PURE model (0047).
 *
 * The single source of album dimensions. No 'server-only'/'use client', no I/O — safe to
 * import in server code, client components, AND the print route so the builder, preview,
 * flipbook, cover, and PDF all derive geometry from the SAME product data (loaded from the
 * DB). This is what replaces the old hardcoded `6in × 8in` / `3:4` / `3:2` constants.
 *
 * Units:
 *   • widthCm/heightCm      — the marketed physical size.
 *   • printWidthCm/HeightCm — the size the PDF @page is generated at (usually == physical).
 *   • builderAspectRatio    — ONE page's width ÷ height (unitless). Persisted so it can be
 *                             tuned independently, but seeded as widthCm/heightCm.
 * An OPEN PAIR (two pages side by side) is therefore `2 × builderAspectRatio` wide.
 */

export type ProductDimensions = {
  widthCm: number;
  heightCm: number;
  printWidthCm: number;
  printHeightCm: number;
  builderAspectRatio: number; // one page: width / height
};

/** Full catalog shape used by pickers/admin (dimensions + presentation). */
export type AlbumProductCore = ProductDimensions & {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  displayOrder: number;
  isDefault: boolean;
  isActive: boolean;
};

/**
 * Safety-net dimensions, used ONLY when a product row can't be resolved (an album whose
 * product_id is still null — i.e. pre-migration or a resolution failure). Deliberately equal
 * to the LEGACY page size (6in × 8in = 15.24 × 20.32 cm, aspect 0.75), NOT A4, so an album with
 * no product renders EXACTLY as it did before 0047. Once the migration assigns it a product
 * (Standard = A4), it renders at the product's real dimensions. The builder never reads this
 * directly — it always receives resolved product dimensions. Kept here (product layer), not the builder.
 */
export const FALLBACK_DIMENSIONS: ProductDimensions = {
  widthCm: 15.24, // 6in
  heightCm: 20.32, // 8in
  printWidthCm: 15.24,
  printHeightCm: 20.32,
  builderAspectRatio: 0.75, // 6/8 — the legacy fixed aspect
};

/**
 * IS THIS GEOMETRY USABLE FOR LAYOUT AND FOR PRINT?
 *
 * ── THE FAILURE THIS EXISTS TO STOP ────────────────────────────────────────────────────────
 *
 * Dimensions are read out of `album_products` with `Number(v ?? 0)`, so a column that is NULL,
 * empty or non-numeric resolves to **0** — a value that is not missing (so the `?? FALLBACK`
 * never fires) but is not printable either. Zero then reaches the print CSS, and the failure is
 * silent and total:
 *
 *     @page { size: 0cm 0cm }        →  INVALID, so Chromium falls back to its DEFAULT sheet
 *                                       (US Letter, 612 × 792 pt — not the album's page at all)
 *     .pdf-page { width: 0; height: 0 }  →  every page element collapses
 *
 * and the absolutely-positioned artwork inside those collapsed pages lands in the TOP-LEFT CORNER
 * of a Letter sheet with the rest blank. Measured in real headless Chromium, not inferred.
 *
 * The builder shows nothing wrong, because it reads `builderAspectRatio` and `widthCm` and never
 * touches `printWidthCm`/`printHeightCm` — so a product with only its PRINT columns broken looks
 * perfect on screen and prints as a corner of a blank page. That asymmetry is exactly why the
 * guard belongs here, in the one place a product's geometry becomes a `ProductDimensions`, rather
 * than in whichever renderer notices first.
 *
 * Every field must be a FINITE POSITIVE number. Zero is not a small page; it is a missing one.
 */
export function isUsableDimensions(d: ProductDimensions | null | undefined): d is ProductDimensions {
  if (!d) return false;
  const ok = (v: number) => Number.isFinite(v) && v > 0;
  return ok(d.widthCm) && ok(d.heightCm) && ok(d.printWidthCm) && ok(d.printHeightCm) && ok(d.builderAspectRatio);
}

/**
 * THE CANONICAL RESOLUTION. Unusable geometry degrades to the documented legacy page rather than
 * reaching a renderer — a book printed at the fallback size is a visible, explicable problem; a
 * book printed on a blank Letter sheet with the artwork in the corner is not.
 */
export function usableDimensions(d: ProductDimensions | null | undefined): ProductDimensions {
  return isUsableDimensions(d) ? d : FALLBACK_DIMENSIONS;
}

/** One page's aspect (width / height). */
export function pageAspect(d: ProductDimensions): number {
  return d.builderAspectRatio;
}

/** The OPEN PAIR aspect (two pages wide). Replaces the hardcoded PAIR_ASPECT (was 3/2). */
export function pairAspect(d: ProductDimensions): number {
  return 2 * d.builderAspectRatio;
}

/**
 * The CSS `@page size` for the PDF, one physical page. CSS supports `cm` natively, so the
 * generated PDF is exactly the print size — no unit conversion, no hardcoded inches.
 */
export function printPageCss(d: ProductDimensions): { w: string; h: string } {
  return { w: `${d.printWidthCm}cm`, h: `${d.printHeightCm}cm` };
}

/** cm → CSS inches helper (kept for any raster/DPI math that needs physical inches). */
export const CM_PER_INCH = 2.54;
export function cmToIn(cm: number): number {
  return cm / CM_PER_INCH;
}

// ── Validation (shared by admin action + client form) ────────────────────────────

export type ProductValidationInput = {
  name: string;
  widthCm: number;
  heightCm: number;
  printWidthCm: number;
  printHeightCm: number;
};

/** Positive-dimension + non-empty-name checks. Prices/page-counts validated separately. */
export function validateProductInput(input: ProductValidationInput): { ok: boolean; error?: string } {
  if (!input.name.trim()) return { ok: false, error: 'Name is required.' };
  const dims = [input.widthCm, input.heightCm, input.printWidthCm, input.printHeightCm];
  if (dims.some((v) => !Number.isFinite(v) || v <= 0)) {
    return { ok: false, error: 'All dimensions must be positive numbers.' };
  }
  return { ok: true };
}

/** Derive the builder aspect from the physical size (single source of the ratio). */
export function aspectFromCm(widthCm: number, heightCm: number): number {
  return Math.round((widthCm / heightCm) * 100000) / 100000;
}

export function isPositivePrice(v: number): boolean {
  return Number.isFinite(v) && v >= 0;
}
