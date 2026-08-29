/**
 * THE PDF PAGE IS THE ALBUM'S PAGE — a product row can never collapse it.
 *
 * ── THE INCIDENT THIS FILE EXISTS FOR ──────────────────────────────────────────────────────
 *
 * A generated album PDF showed its content squeezed into the upper-left corner of a mostly blank
 * sheet. It was not a CSS problem and not a coordinate-system mismatch: the page SIZE was zero.
 *
 * `album_products` dimensions are read with `Number(v ?? 0)`, so a NULL, empty or non-numeric
 * column resolves to **0**. Zero is not "missing" — every caller's `?? FALLBACK_DIMENSIONS` was
 * therefore skipped — and it is not printable either, so it travelled intact into the print CSS:
 *
 *     @page { size: 0cm 0cm }            INVALID → Chromium substitutes its DEFAULT sheet
 *                                        (US Letter, 612 × 792 pt — measured, not inferred)
 *     .pdf-page { width: 0; height: 0 }  every page element collapses
 *
 * and the absolutely-positioned artwork inside those collapsed pages painted at the top-left of a
 * Letter sheet. **The builder looked perfectly correct throughout**, because it reads
 * `builderAspectRatio` and never touches `printWidthCm` / `printHeightCm` — so a product whose
 * PRINT columns alone are broken renders beautifully on screen and prints as a corner of a blank
 * page. That asymmetry is why the guard lives in the product layer rather than in a renderer.
 *
 * These assertions are on the SOURCE of the page size, which is what the incident turned on. The
 * geometry downstream of it (fragmentainer rounding, scale-to-fill, the 200%-wide pair, the
 * per-page clip window) already has its own coverage in `print-content-export`, `print-spec` and
 * `preview-pdf-unchanged`, and was measured correct in real headless Chromium during this
 * investigation.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  FALLBACK_DIMENSIONS,
  isUsableDimensions,
  pageAspect,
  printPageCss,
  usableDimensions,
  type ProductDimensions,
} from '@/lib/products/model';

const A4: ProductDimensions = {
  widthCm: 21,
  heightCm: 29.7,
  printWidthCm: 21,
  printHeightCm: 29.7,
  builderAspectRatio: 21 / 29.7,
};

describe('a product row that does not describe a page is refused', () => {
  it('accepts a complete, positive product', () => {
    expect(isUsableDimensions(A4)).toBe(true);
    expect(usableDimensions(A4)).toBe(A4);
  });

  it('REJECTS a zero in any single field — the exact shape `Number(null ?? 0)` produces', () => {
    for (const key of ['widthCm', 'heightCm', 'printWidthCm', 'printHeightCm', 'builderAspectRatio'] as const) {
      const broken = { ...A4, [key]: 0 };
      expect(isUsableDimensions(broken), key).toBe(false);
      expect(usableDimensions(broken), key).toBe(FALLBACK_DIMENSIONS);
    }
  });

  it('REJECTS NaN, Infinity and negatives — a non-numeric column, not just a null one', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -21]) {
      expect(isUsableDimensions({ ...A4, printWidthCm: bad })).toBe(false);
      expect(isUsableDimensions({ ...A4, builderAspectRatio: bad })).toBe(false);
    }
  });

  it('REJECTS the PRINT columns specifically — the case the builder cannot show you', () => {
    // Screen geometry intact, print geometry gone: correct in the editor, corner of a blank sheet
    // in the PDF. This is the combination that was actually shipped.
    const screenFine = { ...A4, printWidthCm: 0, printHeightCm: 0 };
    expect(pageAspect(screenFine)).toBeCloseTo(21 / 29.7, 10); // the builder is none the wiser
    expect(isUsableDimensions(screenFine)).toBe(false);
    expect(usableDimensions(screenFine)).toBe(FALLBACK_DIMENSIONS);
  });

  it('treats null/undefined as unusable, so there is ONE resolution path', () => {
    expect(usableDimensions(null)).toBe(FALLBACK_DIMENSIONS);
    expect(usableDimensions(undefined)).toBe(FALLBACK_DIMENSIONS);
  });

  it('the fallback is itself a printable page — a guard that degrades into nothing is no guard', () => {
    expect(isUsableDimensions(FALLBACK_DIMENSIONS)).toBe(true);
  });
});

describe('no degenerate page size can reach the print CSS', () => {
  it('a resolved page size is always a positive physical length', () => {
    const css = printPageCss(usableDimensions({ ...A4, printWidthCm: 0, printHeightCm: 0 }));
    expect(css.w).toBe('15.24cm');
    expect(css.h).toBe('20.32cm');
    // The value that broke it. `@page { size: 0cm 0cm }` is invalid CSS, and Chromium answers an
    // invalid @page size by using its own default sheet.
    expect(css.w).not.toBe('0cm');
    expect(css.h).not.toBe('0cm');
  });

  it('a healthy product is completely unaffected — the exact same CSS as before', () => {
    expect(printPageCss(usableDimensions(A4))).toEqual({ w: '21cm', h: '29.7cm' });
  });
});

describe('the guard is applied at every boundary the page size crosses', () => {
  const catalog = readFileSync(resolve(__dirname, '../src/lib/products/catalog.ts'), 'utf8');
  const preview = readFileSync(resolve(__dirname, '../src/app/albums/[id]/print/_print-album.tsx'), 'utf8');
  const content = readFileSync(resolve(__dirname, '../src/app/albums/[id]/print/content/_print-content.tsx'), 'utf8');

  it('the DB resolver reports an unusable row as a MISS, so callers get their fallback', () => {
    // `getProductDimensions` returning a zero-sized object is what silently skipped every
    // `?? FALLBACK_DIMENSIONS` in the codebase.
    expect(catalog).toContain('return isUsableDimensions(d) ? d : null;');
  });

  it("the album's product SNAPSHOT cannot record an unusable page either", () => {
    // 0049 snapshots dimensions onto the album; an unusable one would outlive the product row.
    expect(catalog).toContain('dimensions: usableDimensions({');
  });

  it('both print renderers resolve ONCE, at the component boundary', () => {
    // Not inside the CSS builder: the spine page derives its own @page width from `printWidthCm`
    // OUTSIDE that function, so guarding only the builder left `@page spine { size: 0cm … }`
    // behind — and that one page still fell back to Letter. Measured.
    expect(preview).toContain('const dimensions = usableDimensions(dimensionsInput);');
    expect(content).toContain('const dimensions = usableDimensions(dimensionsInput);');
  });

  it('the print page size still comes from the PRODUCT, never from the viewport or a constant', () => {
    // The pipeline must stay deterministic: no window/screen/zoom input anywhere near it.
    for (const src of [preview, content]) {
      expect(src).not.toContain('window.innerWidth');
      expect(src).not.toContain('window.innerHeight');
      expect(src).not.toContain('devicePixelRatio');
      expect(src).not.toContain('visualViewport');
    }
    expect(preview).toContain('printPageCss(dimensions)');
  });
});
