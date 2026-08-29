import { inflateSync, inflateRawSync } from 'node:zlib';
import { PRINT_ARTWORK_MM, mmToPt, type PdfKind } from './pdf-contract.js';

/**
 * PDF GEOMETRY VERIFICATION — the gate that stops a geometrically wrong render being accepted.
 *
 * ── THE FAILURE THIS CATCHES, AND WHY THE MEDIABOX ALONE MISSES IT ────────────────────────────
 *
 * A physical page is a clip window onto a two-page-wide open pair, so the print routes give every
 * page roughly twice its own width in SCROLLABLE OVERFLOW. `overflow: hidden` clips what is painted
 * but does not remove that region, and past about ten pages Chromium could fold it into the sheet it
 * laid the page out on. Measured, from a real album's page-1 content stream:
 *
 *   healthy:  q 3.125     0 0 3.125     0 0 cm ... 0 0  779 1100 re f
 *   enlarged: q 2.1857769 0 0 2.1857769 0 0 cm ... 0 0 1113 1572 re f
 *
 * The sheet became 1113 x 1572 CSS px while the page elements stayed 779 x 1100, so every page's
 * artwork covered the top-left ~70% and the rest printed blank. `contain: strict` on the page
 * element is the root-cause fix; this is the net underneath it.
 *
 * **THE MEDIABOX WAS CORRECT THE WHOLE TIME** — 583.94 x 824.88 pt on all 24 pages, in the broken
 * file as well as the healthy one. A check that reads only page size and page count sees nothing
 * wrong. So the primary check here reads the geometry that actually moved: the CSS-pixel sheet
 * Chromium painted, recovered from each page's own content stream.
 *
 * ── TWO CHECKS, PER PAGE ──────────────────────────────────────────────────────────────────────
 *
 * 1. THE UNIT INVARIANT (every page of every artifact). CSS px and PDF points are two units for one
 *    physical page, related by the fixed ratio 96 px = 72 pt, so:
 *
 *        sheetPx  ===  ceil(mediaPt * 96 / 72)      (ceil = Chromium's own fragmentainer rounding)
 *
 *    That is derived entirely from the file under inspection — no page size is written down for it,
 *    so it introduces no second opinion about how big a page is, and it holds for the interior, the
 *    cover, every album product's preview page and the preview book's narrow spine page alike.
 *
 * 2. THE EXPECTED ARTWORK SIZE (the two printer-ready kinds only). A page could be internally
 *    consistent and still be the wrong paper — if `preferCSSPageSize` were ever not honoured, a
 *    render would come back as Letter, at Letter's own sheet, and pass check 1. The interior and the
 *    cover have sizes a printer is expecting, so their MediaBox is compared against
 *    `PRINT_ARTWORK_MM` — the worker's mirror of `src/lib/print/spec.ts`, kept honest by a test.
 *    The preview book has no single expected size (product-dependent, plus a spine page), so it gets
 *    check 1 only.
 */

/** CSS pixels per PDF point. A unit relationship, not a page size. */
const PX_PER_PT = 96 / 72;

/**
 * Sub-pixel slack on the sheet. The page element is sized at the CEILING of the physical page in px,
 * so a healthy sheet lands within a pixel of the exact conversion. The failure being guarded against
 * is a ~40% divergence, so a tight tolerance costs nothing and cannot produce a false positive.
 */
const SHEET_TOLERANCE_PX = 2;

/**
 * Slack on the MediaBox, in points. Chromium rounds the physical page to hundredths, so the emitted
 * box is a fraction off the exact conversion. The nearest wrong answer is A4 (11 pt narrower than
 * the interior) and the next is Letter (28 pt wider), so 1 pt separates "rounding" from "wrong
 * paper" with an enormous margin.
 */
const MEDIA_TOLERANCE_PT = 1;

export interface PdfPageGeometry {
  /** 1-based page index, in document order. */
  readonly page: number;
  /** The page's MediaBox, in PDF points. */
  readonly mediaPt: { readonly w: number; readonly h: number };
  /** The CSS-pixel sheet Chromium painted, or null when the content stream could not be read. */
  readonly sheetPx: { readonly w: number; readonly h: number } | null;
  /** What `sheetPx` must be, derived from this page's own MediaBox. */
  readonly expectedPx: { readonly w: number; readonly h: number };
}

export type PdfGeometryVerdict =
  | { readonly ok: true; readonly pages: readonly PdfPageGeometry[] }
  | { readonly ok: false; readonly reason: string; readonly pages: readonly PdfPageGeometry[] };

/**
 * The MediaBox every page of this artifact must have, or null when the artifact has no single
 * expected size. Derived from the mirrored print specification — this file states no dimension.
 */
export function expectedMediaPt(kind: PdfKind): { w: number; h: number } | null {
  const mm = PRINT_ARTWORK_MM[kind];
  return mm === null ? null : { w: mmToPt(mm.w), h: mmToPt(mm.h) };
}

// ── minimal PDF reading (offsets only; a 100 MB file must not be sliced object by object) ────────

interface Doc {
  readonly raw: Uint8Array;
  readonly text: string;
  readonly objs: Map<number, { start: number; end: number }>;
}

function parse(bytes: Uint8Array): Doc {
  const text = Buffer.from(bytes).toString('latin1');
  const objs = new Map<number, { start: number; end: number }>();
  const re = /(?:^|[\s>])(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lit = `${m[1]} ${m[2]} obj`;
    const start = m.index + m[0].length - lit.length;
    const end = text.indexOf('endobj', start);
    if (end > 0) objs.set(Number(m[1]), { start, end });
  }
  return { raw: bytes, text, objs };
}

/** Decoded bytes of an object's stream, or null when it is absent or undecodable. */
function streamOf(doc: Doc, num: number): Buffer | null {
  const o = doc.objs.get(num);
  if (!o) return null;
  const i = doc.text.indexOf('stream', o.start);
  if (i < 0 || i > o.end) return null;
  let j = i + 'stream'.length;
  if (doc.text[j] === '\r') j += 1;
  if (doc.text[j] === '\n') j += 1;
  const e = doc.text.indexOf('endstream', j);
  if (e < 0) return null;
  const body = Buffer.from(doc.raw.subarray(j, e));
  if (!/\/FlateDecode/.test(doc.text.slice(o.start, i))) return body;
  try {
    return inflateSync(body);
  } catch {
    try {
      return inflateRawSync(body);
    } catch {
      return null;
    }
  }
}

const NUM = '-?[\\d.]+';

/**
 * The sheet Chromium painted, read from a page's content stream.
 *
 * Every printed page opens by filling its whole sheet with white, at the page's own scale:
 *
 *     0.24 0 0 -0.24 0 <h> cm  q  <s> 0 0 <s> 0 0 cm  1 1 1 rg  0 0 <W> <H> re f  Q
 *
 * `W x H` is that sheet in CSS px, and it is the only thing read here — nothing else in the stream
 * is interpreted, so this stays indifferent to whatever the page actually draws.
 */
function readSheetPx(data: Buffer): { w: number; h: number } | null {
  const m = new RegExp(`0\\s+0\\s+(${NUM})\\s+(${NUM})\\s+re\\s+f`).exec(data.toString('latin1'));
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
}

/** Every page's geometry, in document order. */
export function readPdfGeometry(bytes: Uint8Array): readonly PdfPageGeometry[] {
  const doc = parse(bytes);
  const mediaRe = new RegExp(
    `\\/MediaBox\\s*\\[\\s*(${NUM})\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})\\s*\\]`,
  );
  const nums = [...doc.objs.keys()].sort((a, b) => a - b);

  const pages: PdfPageGeometry[] = [];
  for (const num of nums) {
    const o = doc.objs.get(num);
    if (!o) continue;
    const head = doc.text.slice(o.start, Math.min(o.end, o.start + 4000));
    if (!/\/Type\s*\/Page[^s]/.test(head)) continue;
    const mb = mediaRe.exec(head);
    if (!mb) continue;
    const mediaPt = {
      w: Number(mb[3]) - Number(mb[1]),
      h: Number(mb[4]) - Number(mb[2]),
    };
    const contents = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(head);
    const data = contents?.[1] === undefined ? null : streamOf(doc, Number(contents[1]));
    pages.push({
      page: pages.length + 1,
      mediaPt,
      sheetPx: data ? readSheetPx(data) : null,
      expectedPx: { w: Math.ceil(mediaPt.w * PX_PER_PT), h: Math.ceil(mediaPt.h * PX_PER_PT) },
    });
  }
  return pages;
}

/**
 * Is this PDF geometrically acceptable?
 *
 * EVERY page is checked, not just the first: the sheet is decided per page, and one page laid out
 * wrong is exactly as unprintable as all of them. Rejects an empty document, a degenerate MediaBox,
 * a page whose content stream cannot be read (a page that cannot be measured cannot be shown to be
 * right), a page that is not the expected artwork size for its kind, and any page whose painted
 * sheet disagrees with its own MediaBox.
 */
export function verifyPdfGeometry(bytes: Uint8Array, kind: PdfKind): PdfGeometryVerdict {
  const pages = readPdfGeometry(bytes);
  if (pages.length === 0) {
    return { ok: false, reason: 'no pages found in the generated PDF', pages };
  }
  const expected = expectedMediaPt(kind);

  for (const p of pages) {
    if (!(p.mediaPt.w > 0) || !(p.mediaPt.h > 0)) {
      return {
        ok: false,
        reason: `page ${p.page}: degenerate MediaBox ${p.mediaPt.w}x${p.mediaPt.h}pt`,
        pages,
      };
    }

    if (expected !== null) {
      const ew = Math.abs(p.mediaPt.w - expected.w);
      const eh = Math.abs(p.mediaPt.h - expected.h);
      if (ew > MEDIA_TOLERANCE_PT || eh > MEDIA_TOLERANCE_PT) {
        return {
          ok: false,
          reason:
            `page ${p.page}: page size is ${p.mediaPt.w.toFixed(2)}x${p.mediaPt.h.toFixed(2)} pt, ` +
            `but this artifact must be ${expected.w.toFixed(2)}x${expected.h.toFixed(2)} pt`,
          pages,
        };
      }
    }

    if (p.sheetPx === null) {
      return {
        ok: false,
        reason: `page ${p.page}: could not read the painted sheet from the content stream`,
        pages,
      };
    }

    const dw = Math.abs(p.sheetPx.w - p.expectedPx.w);
    const dh = Math.abs(p.sheetPx.h - p.expectedPx.h);
    if (dw > SHEET_TOLERANCE_PX || dh > SHEET_TOLERANCE_PX) {
      return {
        ok: false,
        reason:
          `page ${p.page}: laid out on a ${p.sheetPx.w}x${p.sheetPx.h} px sheet, but its ` +
          `${p.mediaPt.w.toFixed(2)}x${p.mediaPt.h.toFixed(2)} pt page requires ` +
          `${p.expectedPx.w}x${p.expectedPx.h} px — the artwork would print at ` +
          `${((p.expectedPx.w / p.sheetPx.w) * 100).toFixed(1)}% of the page`,
        pages,
      };
    }
  }
  return { ok: true, pages };
}
