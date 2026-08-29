'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PairContent from '@/app/(app)/albums/[id]/build/_pair-frame';
import type { Block, EditConfig } from '@/lib/builder/model';
import type { ProductDimensions } from '@/lib/products/model';
import { pageAspect, usableDimensions } from '@/lib/products/model';
import {
  FILL_OVERSCAN_PX,
  INTERIOR_ARTWORK,
  mmCss,
  mmToPxCeil,
  scaleToFill,
} from '@/lib/print/spec';

export type PrintPhoto = { id: string; url: string; edit: EditConfig | null };

/**
 * PRINTER-READY INTERIOR — the content block and nothing else.
 *
 * One PDF page per CONTENT page, in reading order, at the supplied artwork size:
 *
 *     206 × 291 mm   =   200 × 285 mm trim   +   3 mm bleed on all four sides
 *
 * WHAT IS DELIBERATELY ABSENT, and why it matters: this is the interior printing sequence, so it
 * carries NO front cover, NO back cover, NO spine, NO inside-cover blanks and NO padding. The
 * preview book (`../page.tsx` → `_print-album.tsx`) injects all of those and is untouched — a
 * preview is a book to look at, this is a file to hand a printer. A 24-page album produces pages
 * 1→24 here; the same album produces 30 pages in the preview.
 *
 * NO PRINTER MARKS of any kind are drawn: no crop marks, no registration marks, no colour bars, no
 * slug, no filename strip, no trim lines. The bleed box IS the page; the printer trims it.
 *
 * ── HOW THE DESIGN REACHES THE BLEED BOX ──────────────────────────────────────────────────────
 *
 * The builder works in its own space — a percentage coordinate system inside an open pair, whose
 * proportions come from the album's product (A4-derived ≈ 0.7071 for Standard). The interior bleed
 * box is 206 ÷ 291 ≈ 0.7079. Those are close but not equal, so a decision is unavoidable, and it
 * is SCALE-TO-FILL: the page is scaled UNIFORMLY until it covers the bleed box, then centred. The
 * artwork is never stretched, never letterboxed, and its bleed is never fabricated from mirrored
 * pixels — the fraction of a millimetre that falls outside the box is trimmed away, which is
 * exactly what bleed is for. `scaleToFill` in `lib/print/spec` owns that arithmetic.
 *
 * ── WHY THE PAGE IS SIZED IN PX WHILE `@page` IS IN MM ────────────────────────────────────────
 *
 * Same measured reason as the preview renderer: Chromium's print fragmentainer is the CEILING of
 * the `@page` size in CSS px, so a page element sized at the exact physical fraction stops a
 * fraction of a pixel short of the sheet and leaves a hairline of bare paper. `mmToPxCeil` gives
 * the element the fragmentainer's own value; `@page size` stays in exact millimetres, so the PDF's
 * physical MediaBox is unchanged and still exact. See `lib/print/spec`.
 */

/** Physical page geometry, computed once per render — pure, and identical for every page. */
function buildContentCss(dimensions: ProductDimensions): string {
  const pageW = mmToPxCeil(INTERIOR_ARTWORK.w);
  const pageH = mmToPxCeil(INTERIOR_ARTWORK.h);
  const fill = scaleToFill(pageAspect(dimensions), { w: pageW, h: pageH }, FILL_OVERSCAN_PX);

  return `
  @page { size: ${mmCss(INTERIOR_ARTWORK.w)} ${mmCss(INTERIOR_ARTWORK.h)}; margin: 0; }
  html, body {
    margin: 0; padding: 0; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .print-page {
    position: relative;
    /* The fragmentainer's own dimensions — an exact fit, so no strip of sheet is left bare. */
    width: ${pageW}px; height: ${pageH}px;
    overflow: hidden; background: #fff;
    /*
     * THE PAGE IS A HARD BOUNDARY: its size is fixed, and NOTHING inside it may influence that.
     *
     * "overflow: hidden" clips what is PAINTED, but it does not remove the element's scrollable
     * overflow region. This page legitimately has one: ".pair-clip" below is 200% wide, because a
     * physical page is a clip window onto a two-page-wide open pair. So every page reports a
     * scrollWidth of 1560 against an offsetWidth of 779, and an overlay pushed off the page — which
     * the editor allows — adds more. Past roughly ten pages Chromium folds that region into its
     * PRINT SHEET. Measured on the real album, page 1's content stream, before and after:
     *
     *   enlarged: q 2.1857769 0 0 2.1857769 0 0 cm ... 0 0 1113 1572 re f   (0.24 x 2.1858 = 0.52)
     *   correct:  q 3.125     0 0 3.125     0 0 cm ... 0 0  779 1100 re f   (0.24 x 3.125  = 0.75)
     *
     * The sheet became 1113 x 1572 CSS px while this element stayed 779 x 1100, so every page's
     * artwork covered the top-left ~70% and the rest printed blank — with a correct MediaBox, which
     * is why it read as a scaling bug rather than an overflow bug.
     *
     * SIZE CONTAINMENT is the fix, and the minimal one: it declares that this element's size is
     * computed without reference to its contents, so their overflow can no longer reach the
     * page-size computation. Across the whole "contain" matrix on the real 24-page album, every
     * value including "size" produced the correct sheet and every value without it ("layout",
     * "paint", "style", "layout paint", "content") did not. "strict" is "size layout style paint" —
     * the whole statement we mean: this page is an independent box.
     *
     * It changes nothing else: the width and height above are explicit, so a size that ignores its
     * contents is the size it already had, and children still overflow and are still clipped.
     */
    contain: strict;
  }
  /* break-BEFORE on every page after the first: it cannot produce a trailing blank sheet, and it
     does not depend on where a page sits among its siblings (see the preview renderer's note). */
  .print-page + .print-page { break-before: page; page-break-before: always; }
  /* The uniformly-scaled album page, centred so it covers the whole bleed box. */
  .page-fill {
    position: absolute;
    left: ${fill.x}px; top: ${fill.y}px;
    width: ${fill.w}px; height: ${fill.h}px;
  }
  /* The open pair is 2 pages wide (200% of the scaled page); each physical page is a clip window
     onto it — the same geometry the builder canvas and the preview use. */
  .pair-clip { position: absolute; top: 0; height: 100%; width: 200%; }
`;
}

declare global {
  interface Window {
    __ALBUM_PRINT_READY?: boolean;
  }
}

export default function PrintContent({
  blocks,
  photos,
  dimensions: dimensionsInput,
  stickerUrls = {},
}: {
  blocks: Block[];
  photos: PrintPhoto[];
  /** The album product's page proportions — the SOURCE aspect the scale-to-fill maps from. */
  dimensions: ProductDimensions;
  stickerUrls?: Record<string, string>;
}) {
  /**
   * Resolved ONCE, at the door, exactly as the preview renderer does. The interior sheet is fixed
   * by the print specification, but the SOURCE aspect the design is scaled from still comes from
   * the product — and `scaleToFill` throws on a non-positive one, so a product row with a blank
   * column would fail the whole export rather than degrade to the documented fallback page.
   */
  const dimensions = usableDimensions(dimensionsInput);
  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const photoFor = useCallback(
    (id: string | null | undefined) => {
      const p = id ? photoMap.get(id) : undefined;
      return p ? { url: p.url, edit: p.edit } : undefined;
    },
    [photoMap],
  );
  const stickerUrlFor = useCallback((id: string) => stickerUrls[id], [stickerUrls]);

  // Frames the worker must wait for — counted to MATCH what each physical page renders (a
  // single-pair photo renders once on its own page, overlays only on the page(s) they overlap, a
  // double-spread image on both). Identical accounting to the preview renderer, minus the cover.
  const totalFrames = useMemo(() => {
    const framesOnHalf = (b: Block, half: 'left' | 'right') => {
      let n = 0;
      if (b.template === 'double-spread') {
        if (b.photoIds[0] && photoMap.has(b.photoIds[0])) n += 1; // image spans both pages
      } else {
        const id = half === 'left' ? b.photoIds[0] : b.photoIds[1];
        if (id && photoMap.has(id)) n += 1;
      }
      for (const o of b.overlays) {
        const onHalf = half === 'left' ? o.x < 0.5 : o.x + o.w > 0.5;
        if (onHalf && o.photoId && photoMap.has(o.photoId)) n += 1;
      }
      return n;
    };
    return blocks.reduce(
      (s, b) =>
        s +
        framesOnHalf(b, 'left') +
        framesOnHalf(b, 'right') +
        b.stickers.filter((st) => stickerUrls[st.stickerId]).length * 2,
      0,
    );
  }, [blocks, photoMap, stickerUrls]);

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

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: buildContentCss(dimensions) }} />

      {/*
        Each content pair → two physical pages (left half, right half), in `page_number` order.
        A React Fragment, NOT a `display: contents` element: every `.print-page` must be a true
        sibling of every other one, or the CSS fragmentation rules that key off sibling position
        (`.print-page + .print-page`) silently skip pages.
      */}
      {blocks.map((block) => (
        <Fragment key={block.key}>
          <PhysicalPage side="left" block={block} photoFor={photoFor} stickerUrlFor={stickerUrlFor} onFrameReady={onFrameReady} />
          <PhysicalPage side="right" block={block} photoFor={photoFor} stickerUrlFor={stickerUrlFor} onFrameReady={onFrameReady} />
        </Fragment>
      ))}
    </>
  );
}

function PhysicalPage({
  side,
  block,
  photoFor,
  stickerUrlFor,
  onFrameReady,
}: {
  side: 'left' | 'right';
  block: Block;
  photoFor: (id: string | null | undefined) => { url: string; edit?: EditConfig | null } | undefined;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  onFrameReady: () => void;
}) {
  // The left page shows the first half of the open pair; the right page shifts it by one page.
  // `half` makes PairContent render ONLY this page's frames (memory: a photo decodes once).
  return (
    <div className="print-page">
      <div className="page-fill">
        <div className="pair-clip" style={{ left: side === 'left' ? '0' : '-100%' }}>
          {/* Overlays carry no border or shadow on ANY surface now, so there is nothing left for
              this route to suppress — the white hairline cannot come back through a missed flag. */}
          <PairContent block={block} photoFor={photoFor} stickerUrlFor={stickerUrlFor} onFrameReady={onFrameReady} half={side} />
        </div>
      </div>
    </div>
  );
}
