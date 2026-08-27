/**
 * PRINTER-READY INTERIOR — page count, page order, and what must NOT be in the file.
 *
 * Renders the REAL `_print-content` component with `react-dom/server`, the same way
 * `customer-order-status.test.tsx` renders the real order status. Nothing about the renderer is
 * stubbed; what runs here is what the worker's Chromium runs.
 *
 * THE INVARIANT UNDER TEST: the interior file is the interior printing sequence — exactly the
 * album's content pages, 1 → N, and nothing else. A file with the wrong number of leaves is not a
 * smaller book, it is an unbindable one, and the printer finds out after the paper is cut.
 */
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import PrintContent, { type PrintPhoto } from '@/app/albums/[id]/print/content/_print-content';
import { PAGE_COST, pagesConsumed, type Block } from '@/lib/builder/model';
import { FALLBACK_DIMENSIONS, type ProductDimensions } from '@/lib/products/model';
import { INTERIOR_ARTWORK, mmToPxCeil, scaleToFill, FILL_OVERSCAN_PX } from '@/lib/print/spec';

// The Standard product — A4-derived, and the aspect the scale-to-fill actually maps from.
const STANDARD: ProductDimensions = {
  widthCm: 21,
  heightCm: 29.7,
  printWidthCm: 21,
  printHeightCm: 29.7,
  builderAspectRatio: 21 / 29.7,
};

const photo = (id: string): PrintPhoto => ({ id, url: `https://r2.test/${id}.jpg`, edit: null });

/** One two-page content unit carrying a photo on each page. */
function pair(key: string, left: string, right: string): Block {
  return {
    key,
    template: 'single-pair',
    photoIds: [left, right],
    caption: '',
    overlays: [],
    texts: [],
    qrs: [],
    stickers: [],
    background: null,
  };
}

/** An album of `contentPages` content pages — i.e. contentPages / 2 units. */
function album(contentPages: number): { blocks: Block[]; photos: PrintPhoto[] } {
  const blocks: Block[] = [];
  const photos: PrintPhoto[] = [];
  for (let i = 0; i < contentPages / 2; i++) {
    const l = `p${i * 2 + 1}`;
    const r = `p${i * 2 + 2}`;
    photos.push(photo(l), photo(r));
    blocks.push(pair(`${i}`, l, r));
  }
  return { blocks, photos };
}

function render(blocks: Block[], photos: PrintPhoto[], dimensions = STANDARD): string {
  return renderToStaticMarkup(
    React.createElement(PrintContent, { blocks, photos, dimensions, stickerUrls: {} }),
  );
}

/** Every `.print-page` element in render order — one per physical PDF page. */
function pageCount(html: string): number {
  return (html.match(/class="print-page"/g) ?? []).length;
}

describe('page count follows the album, never a hardcoded number', () => {
  it.each([24, 36, 48])('a %i-page album produces exactly %i PDF pages', (pages) => {
    const { blocks, photos } = album(pages);
    // The fixture really is that album: `size` and the layout agree, as the route requires.
    expect(pagesConsumed(blocks)).toBe(pages);
    expect(pageCount(render(blocks, photos))).toBe(pages);
  });

  it('handles a page count nobody has shipped yet — nothing is keyed to 24/36/48', () => {
    for (const pages of [2, 8, 60, 96]) {
      const { blocks, photos } = album(pages);
      expect(pageCount(render(blocks, photos))).toBe(pages);
    }
  });

  it('emits two pages per unit for BOTH layout templates', () => {
    // A double-spread is one image across two pages; it still costs — and prints — two pages.
    expect(PAGE_COST['single-pair']).toBe(2);
    expect(PAGE_COST['double-spread']).toBe(2);
    const spread: Block = { ...pair('0', 'a', 'b'), template: 'double-spread', photoIds: ['a'] };
    expect(pageCount(render([spread], [photo('a')]))).toBe(2);
  });

  it('produces nothing at all for an album with no content units', () => {
    expect(pageCount(render([], []))).toBe(0);
  });
});

describe('page ORDER is 1 → N', () => {
  it('emits each unit’s left page immediately before its right page, units in order', () => {
    const { blocks, photos } = album(6);
    const html = render(blocks, photos);
    // Each page renders its own half of the pair. The left page shows the pair unshifted; the
    // right page shifts the 2-page-wide pair by one page. Their alternation IS the reading order.
    const clips = Array.from(html.matchAll(/left:\s*(0|-100%)/g)).map((m) => m[1]);
    expect(clips).toEqual(['0', '-100%', '0', '-100%', '0', '-100%']);
  });

  it('renders photos in the order the album stores its pages', () => {
    const { blocks, photos } = album(6);
    const html = render(blocks, photos);
    const order = Array.from(html.matchAll(/https:\/\/r2\.test\/(p\d+)\.jpg/g)).map((m) => m[1]);
    expect(order).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  });

  it('follows the BLOCK order it is given, not the photo ids', () => {
    // The route reads `album_pages` ordered by `page_number`; the renderer must not re-sort.
    const photos = [photo('x'), photo('y'), photo('z'), photo('w')];
    const blocks = [pair('1', 'z', 'w'), pair('0', 'x', 'y')];
    const order = Array.from(render(blocks, photos).matchAll(/r2\.test\/(\w+)\.jpg/g)).map((m) => m[1]);
    expect(order).toEqual(['z', 'w', 'x', 'y']);
  });
});

describe('the interior contains ONLY the interior', () => {
  const html = (() => {
    const { blocks, photos } = album(24);
    return render(blocks, photos);
  })();

  it('has no cover — neither face is composed anywhere in the file', () => {
    // Structural, not textual: `object-cover` is a Tailwind class on every photo, so a bare
    // /cover/i search proves nothing. The cover export's own markers are what must be absent.
    expect(html).not.toContain('cover-spread');
    expect(html).not.toContain('cover-panel');
  });

  it('has no spine — the spine renderer sets text vertically and nothing here does', () => {
    expect(html).not.toContain('writing-mode');
    expect(html).not.toContain('pdf-page-spine');
  });

  it('has no injected blank pages', () => {
    // The preview book injects cover + 2 blanks + 2 blanks + back + spine = 6 extra pages.
    // 24 exactly, not 30, is the proof that none of that front/back matter is here.
    expect(pageCount(html)).toBe(24);
    // …and every page carries content, so none of the 24 is a blank filler.
    expect((html.match(/class="page-fill"/g) ?? []).length).toBe(24);
    // Every page renders exactly one photo — 24 pages, 24 images, no filler and no duplication.
    expect((html.match(/<img /g) ?? []).length).toBe(24);
  });

  it('has no printer marks — no crop, registration, colour bar, slug or trim artwork', () => {
    for (const mark of [/crop-?mark/i, /registration/i, /colou?r-?bar/i, /\bslug\b/i, /trim-?line/i]) {
      expect(html).not.toMatch(mark);
    }
  });
});

describe('physical page geometry', () => {
  const html = (() => {
    const { blocks, photos } = album(2);
    return render(blocks, photos);
  })();

  it('sets the @page size to exactly 206 mm × 291 mm with zero margin', () => {
    expect(html).toContain('@page { size: 206mm 291mm; margin: 0; }');
  });

  it('sizes the page element at Chromium’s fragmentainer, not the exact fraction', () => {
    // 779 × 1100 = ceil(206mm), ceil(291mm) — the sheet Chromium actually paints, so no hairline
    // of bare paper is left along an edge. The @page above stays in exact millimetres.
    expect(mmToPxCeil(INTERIOR_ARTWORK.w)).toBe(779);
    expect(mmToPxCeil(INTERIOR_ARTWORK.h)).toBe(1100);
    expect(html).toContain('width: 779px; height: 1100px;');
  });

  it('scales the design to FILL the bleed box, centred', () => {
    const fill = scaleToFill(
      STANDARD.builderAspectRatio,
      { w: 779, h: 1100 },
      FILL_OVERSCAN_PX,
    );
    expect(html).toContain(`width: ${fill.w}px; height: ${fill.h}px;`);
    expect(html).toContain(`left: ${fill.x}px; top: ${fill.y}px;`);
    // Covers on both axes — no letterboxing, no bare sheet.
    expect(fill.w).toBeGreaterThanOrEqual(779);
    expect(fill.h).toBeGreaterThanOrEqual(1100);
    // …and the aspect is untouched, so nothing is stretched.
    expect(fill.w / fill.h).toBeCloseTo(STANDARD.builderAspectRatio, 12);
  });

  it('forces a page break before every page after the first', () => {
    expect(html).toContain('.print-page + .print-page { break-before: page; page-break-before: always; }');
  });

  it('prints backgrounds at full density', () => {
    expect(html).toContain('print-color-adjust: exact');
  });

  it('keeps the page size fixed while the SOURCE aspect changes with the product', () => {
    // A different product changes what is scaled, never the sheet it is scaled onto: the print
    // specification is fixed, and the album's own proportions are the thing being mapped.
    const legacy = render(...Object.values(album(2)).slice(0, 2) as [Block[], PrintPhoto[]], FALLBACK_DIMENSIONS);
    expect(legacy).toContain('@page { size: 206mm 291mm; margin: 0; }');
    expect(legacy).toContain('width: 779px; height: 1100px;');
    // The fill box differs, because 6×8in is a different shape from A4.
    const a4Fill = scaleToFill(STANDARD.builderAspectRatio, { w: 779, h: 1100 }, FILL_OVERSCAN_PX);
    const legacyFill = scaleToFill(FALLBACK_DIMENSIONS.builderAspectRatio, { w: 779, h: 1100 }, FILL_OVERSCAN_PX);
    expect(legacyFill.h).not.toBeCloseTo(a4Fill.h, 6);
    expect(legacy).toContain(`width: ${legacyFill.w}px; height: ${legacyFill.h}px;`);
  });
});
