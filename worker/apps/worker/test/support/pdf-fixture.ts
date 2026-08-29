/**
 * A HAND-BUILT PDF, for tests that need real bytes rather than a placeholder.
 *
 * The render pipeline verifies the geometry of what Chromium produced before anything is uploaded,
 * so `new Uint8Array([0x25, 0x50, 0x44, 0x46])` is no longer a stand-in for "a PDF" — it has no
 * pages, and the pipeline is right to reject it. This builds a file with the structure the verifier
 * reads: a catalog, a pages tree, and one page per spec whose content stream opens with the
 * full-sheet white fill Chromium emits.
 *
 * Uncompressed on purpose: a fixture whose geometry you cannot read in the file is a fixture you
 * cannot reason about when a test fails.
 */

export interface PageSpec {
  /** MediaBox, in PDF points. */
  readonly media: { w: number; h: number };
  /** The sheet the page is painted on, in CSS px. `null` omits the fill entirely. */
  readonly sheet: { w: number; h: number } | null;
}

export function buildPdf(pages: readonly PageSpec[]): Uint8Array {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`);

  for (const [i, p] of pages.entries()) {
    const contentNum = 4 + i * 2;
    objs.push(
      '<< /Type /Page /Parent 2 0 R ' +
        `/MediaBox [0 0 ${p.media.w} ${p.media.h}] /Contents ${contentNum} 0 R >>`,
    );
    const scale = p.sheet === null ? 1 : p.media.h / p.sheet.h;
    const fill =
      p.sheet === null
        ? '0.24 0 0 -0.24 0 0 cm\n'
        : `0.24 0 0 -0.24 0 ${p.media.h} cm\n` +
          `q ${scale.toFixed(6)} 0 0 ${scale.toFixed(6)} 0 0 cm\n1 1 1 rg\n` +
          `0 0 ${p.sheet.w} ${p.sheet.h} re f\nQ\n`;
    objs.push(`<< /Length ${fill.length} >>\nstream\n${fill}\nendstream`);
  }

  let out = '%PDF-1.4\n';
  for (const [i, body] of objs.entries()) out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

/** The interior artifact's real geometry: 206 × 291 mm, laid out on a 779 × 1100 CSS px sheet. */
export const INTERIOR_PT = { w: 583.94, h: 824.88 };
export const INTERIOR_SHEET_PX = { w: 779, h: 1100 };

/** N interior pages, all correct unless a different sheet is supplied. */
export function interiorPages(n: number, sheet = INTERIOR_SHEET_PX): PageSpec[] {
  return Array.from({ length: n }, () => ({ media: INTERIOR_PT, sheet }));
}

/**
 * A geometrically valid PDF — what a healthy render returns. The preview book's own pages are
 * product-sized, but every kind is judged page-by-page, so interior geometry is a fine stand-in for
 * any pipeline test that is not about geometry itself.
 */
export function validPdf(pages = 2): Uint8Array {
  return buildPdf(interiorPages(pages));
}

/** The cover artifact: one 487 x 327 mm flat spread, on a 1841 x 1236 CSS px sheet. */
export const COVER_PT = { w: 1380.47, h: 926.93 };
export const COVER_SHEET_PX = { w: 1841, h: 1236 };

/**
 * A valid render for whatever the pipeline actually asked for. The verifier holds the two
 * printer-ready kinds to their specified artwork size, so a cover job needs cover-sized pages —
 * exactly as the real print routes produce.
 */
export function validPdfForUrl(url: string): Uint8Array {
  if (url.includes('/print/cover')) return buildPdf([{ media: COVER_PT, sheet: COVER_SHEET_PX }]);
  return validPdf();
}
