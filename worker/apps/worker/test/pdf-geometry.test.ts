import { describe, expect, it } from 'vitest';

import {
  expectedMediaPt,
  readPdfGeometry,
  verifyPdfGeometry,
} from '../src/processors/pdf/pdf-geometry.js';
import { VerifyGeometryStage, defaultRenderStages } from '../src/processors/pdf/stages.js';
import { TransientPdfError } from '../src/processors/pdf/errors.js';
import type { RenderContext, RenderDeps } from '../src/processors/pdf/render-context.js';
import {
  INTERIOR_PT as INTERIOR,
  INTERIOR_SHEET_PX,
  buildPdf as pdf,
  interiorPages,
  type PageSpec,
} from './support/pdf-fixture.js';

/**
 * THE GEOMETRY SAFETY NET.
 *
 * The regression it exists for was silent: 24 pages, the right page count, a perfectly correct
 * MediaBox on every page — and every page's artwork squeezed into the top-left ~70% because
 * Chromium had laid the pages out on a sheet 43% larger than the page. `contain: strict` on the
 * print page is the root-cause fix. This is the check that refuses to publish the file if it ever
 * comes back wrong again, whatever the cause.
 *
 * The fixtures are hand-built PDFs with uncompressed content streams, so each case states its own
 * geometry outright rather than depending on a browser being installed.
 */

// ── CASE 1 — a correct render is accepted ───────────────────────────────────────────────────────

describe('CASE 1 — a correctly-sized PDF passes', () => {
  it('accepts a 24-page interior at 583.94 x 824.88 pt on a 779 x 1100 px sheet', () => {
    const verdict = verifyPdfGeometry(pdf(interiorPages(24)), 'print_content');
    expect(verdict.ok).toBe(true);
    expect(verdict.pages).toHaveLength(24);
  });

  it('reads every page, not just the first', () => {
    const pages = readPdfGeometry(pdf(interiorPages(24)));
    expect(pages).toHaveLength(24);
    expect(pages.every((p) => p.sheetPx?.w === 779 && p.sheetPx.h === 1100)).toBe(true);
    // The expectation each page is judged against comes from that page's own MediaBox.
    expect(pages[0]?.expectedPx).toEqual({ w: 779, h: 1100 });
  });

  it('accepts the cover at its own, different size — one rule, not a table of special cases', () => {
    const cover = { w: 1380.47, h: 926.93 };
    const page = { media: cover, sheet: { w: 1841, h: 1236 } };
    expect(verifyPdfGeometry(pdf([page]), 'print_cover').ok).toBe(true);
  });

  it('accepts a preview book whose pages differ in size (the spine page is narrower)', () => {
    // The preview has no single expected size, so each page is judged against its own MediaBox.
    const spread = { media: { w: 1167.87, h: 824.88 }, sheet: { w: 1558, h: 1100 } };
    const spine = { media: { w: 48.19, h: 824.88 }, sheet: { w: 65, h: 1100 } };
    expect(verifyPdfGeometry(pdf([spread, spine, spread]), 'preview').ok).toBe(true);
  });
});

// ── CASE 2 — the actual regression: an enlarged sheet is rejected ────────────────────────────────

describe('CASE 2 — an enlarged print sheet is rejected', () => {
  const broken = pdf(interiorPages(24, { w: 1113, h: 1572 }));

  it('rejects it', () => {
    expect(verifyPdfGeometry(broken, 'print_content').ok).toBe(false);
  });

  it('says what was wrong, in printable terms', () => {
    const verdict = verifyPdfGeometry(broken, 'print_content');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain('1113x1572 px sheet');
    expect(verdict.reason).toContain('70.0% of the page'); // 779 / 1113
  });

  it('is caught even though the page count and MediaBox are both correct', () => {
    const pages = readPdfGeometry(broken);
    expect(pages).toHaveLength(24);
    expect(pages.every((p) => Math.abs(p.mediaPt.w - INTERIOR.w) < 0.01)).toBe(true);
  });
});

// ── CASE 3 / 4 — wrong page width, wrong page height ────────────────────────────────────────────

describe('CASE 3 — a page of the wrong width is rejected', () => {
  it('rejects a sheet that is too wide while its height is right', () => {
    const v = verifyPdfGeometry(pdf(interiorPages(4, { w: 1113, h: 1100 })), 'print_content');
    expect(v.ok).toBe(false);
  });

  it('rejects internally-consistent Letter paper — the interior has ONE correct width', () => {
    // 612 x 792 pt on a 816 x 1056 px sheet satisfies the unit invariant perfectly. It is still the
    // wrong file to hand a printer, so the expected artwork size catches it.
    const letter = pdf([{ media: { w: 612, h: 792 }, sheet: { w: 816, h: 1056 } }]);
    const v = verifyPdfGeometry(letter, 'print_content');
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toContain('must be 583.94x824.88 pt');
  });

  it('and the expected size is derived from the print specification, per kind', () => {
    expect(expectedMediaPt('print_content')?.w).toBeCloseTo(583.94, 1);
    expect(expectedMediaPt('print_cover')?.w).toBeCloseTo(1380.47, 1);
    expect(expectedMediaPt('preview')).toBeNull(); // product-dependent — no single answer
  });
});

describe('CASE 4 — a page of the wrong height is rejected', () => {
  it('rejects a sheet that is too tall while its width is right', () => {
    const v = verifyPdfGeometry(pdf(interiorPages(4, { w: 779, h: 1572 })), 'print_content');
    expect(v.ok).toBe(false);
  });

  it('rejects an A4 page — 17 pt shorter than the interior, and consistent with itself', () => {
    const a4 = pdf([{ media: { w: 595.28, h: 841.89 }, sheet: { w: 794, h: 1123 } }]);
    expect(verifyPdfGeometry(a4, 'print_content').ok).toBe(false);
  });
});

// ── CASE 5 — malformed / unreadable geometry is rejected ────────────────────────────────────────

describe('CASE 5 — malformed geometry is rejected', () => {
  it('rejects bytes that are not a PDF at all', () => {
    const v = verifyPdfGeometry(new Uint8Array(Buffer.from('not a pdf')), 'print_content');
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toContain('no pages');
  });

  it('rejects an empty file', () => {
    expect(verifyPdfGeometry(new Uint8Array(), 'print_content').ok).toBe(false);
  });

  it('rejects a page with a degenerate MediaBox', () => {
    const v = verifyPdfGeometry(
      pdf([{ media: { w: 0, h: 0 }, sheet: INTERIOR_SHEET_PX }]),
      'preview',
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toContain('degenerate MediaBox');
  });

  it('rejects a page whose sheet cannot be read — unmeasurable is not the same as correct', () => {
    const v = verifyPdfGeometry(pdf([{ media: INTERIOR, sheet: null }]), 'print_content');
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toContain('could not read the painted sheet');
  });
});

// ── CASE 6 — right page count, right MediaBox, ONE abnormal internal sheet ───────────────────────

describe('CASE 6 — a single page laid out on the wrong sheet is rejected', () => {
  /**
   * The most important case, and the one every cheaper check misses: 24 pages, every MediaBox
   * correct, and page 17 alone laid out on an enlarged sheet. Validating only page 1 — or only the
   * page count and page size — accepts this file and ships a book with one ruined leaf.
   */
  const pages: PageSpec[] = interiorPages(24).map((p, i) =>
    i === 16 ? { media: INTERIOR, sheet: { w: 1113, h: 1572 } } : p,
  );
  const file = pdf(pages);

  it('has a correct page count and a correct MediaBox on every page', () => {
    const read = readPdfGeometry(file);
    expect(read).toHaveLength(24);
    expect(read.every((p) => Math.abs(p.mediaPt.h - INTERIOR.h) < 0.01)).toBe(true);
  });

  it('is rejected anyway, and names the page', () => {
    const v = verifyPdfGeometry(file, 'print_content');
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toContain('page 17');
  });

  it('page 1 on its own would have passed — which is why every page is checked', () => {
    expect(verifyPdfGeometry(pdf([pages[0] as PageSpec]), 'print_content').ok).toBe(true);
  });
});

// ── the pipeline placement: nothing is uploaded or finalized before this passes ──────────────────

describe('the verification runs after the render and before anything is published', () => {
  const stages = defaultRenderStages().map((s) => s.name);

  it('sits between render and upload', () => {
    expect(stages).toEqual([
      'validate',
      'snapshot',
      'prepare',
      'render',
      'verify',
      'upload',
      'finalize',
    ]);
  });

  const ctx = (bytes: Uint8Array): RenderContext => ({
    albumId: 'a1',
    token: 't',
    kind: 'print_content',
    correlationId: 'c1',
    userId: 'u1',
    pdfBytes: bytes,
  });
  const deps = { logger: { log() {} } } as unknown as RenderDeps;

  it('passes a good render straight through, untouched', async () => {
    const good = ctx(pdf(interiorPages(24)));
    await expect(new VerifyGeometryStage().run(good, deps)).resolves.toBe(good);
  });

  it('fails a bad render as TRANSIENT, so the recovery sweep re-drives it', async () => {
    const bad = ctx(pdf(interiorPages(24, { w: 1113, h: 1572 })));
    const error = await new VerifyGeometryStage().run(bad, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransientPdfError);
    expect((error as TransientPdfError).code).toBe('render_geometry_invalid');
    // Retries are bounded by the sweep's attempt cap, which then abandons the row as `failed`
    // carrying this code — loud, not an infinite quiet retry.
  });
});
