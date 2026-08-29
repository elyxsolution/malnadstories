/**
 * THE PAGE IS A FIXED RECTANGLE — nothing inside it may change its size.
 *
 * ── THE BUG THIS PINS ──────────────────────────────────────────────────────────────────────
 *
 * A physical page is a clip window onto a two-page-wide open pair, so `.pair-clip` is `200%` wide
 * and every page carries scrollable overflow roughly twice its own width (measured: `scrollWidth`
 * 1560 against `offsetWidth` 779). Overlays that hang off the page — which the editor explicitly
 * allows — add more.
 *
 * `overflow: hidden` clips what is PAINTED. It does not remove the element's scrollable overflow
 * region. Past roughly ten pages Chromium folds that region into its PRINT SHEET, and the result is
 * silent and total. Measured on the real album, page 1's content stream, before and after:
 *
 *   enlarged: q 2.1857769 0 0 2.1857769 0 0 cm ... 0 0 1113 1572 re f   → 0.24 × 2.1858 = 0.52
 *   correct:  q 3.125     0 0 3.125     0 0 cm ... 0 0  779 1100 re f   → 0.24 × 3.125  = 0.75
 *
 * The sheet became 1113 × 1572 CSS px while the page elements stayed 779 × 1100, so every page's
 * artwork covered the top-left ~70 % and the rest printed blank — with a perfectly correct
 * MediaBox, which is why it read as a scaling bug rather than an overflow bug.
 *
 * ── WHAT WAS RULED OUT, BY EXPERIMENT ──────────────────────────────────────────────────────
 *
 * Decoded image memory (it reproduces with 2 × 2 px data-URI images in under a second), overlay
 * overflow specifically (clamping every overlay inside the page made it worse, not better), the
 * viewport, `deviceScaleFactor`, and explicit paper size instead of `preferCSSPageSize`. Across the
 * full `contain` matrix on the real 24-page album, every value that includes `size` produced the
 * correct sheet and every value without it (`layout`, `paint`, `style`, `layout paint`, `content`)
 * did not — which is exactly the semantic: the page's size must not be computed from its contents.
 *
 * These assertions are on the emitted CSS, because that is where the invariant lives. The browser
 * proof is a headless-Chromium sweep that cannot run in this node-only suite.
 */
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import PrintContent, { type PrintPhoto } from '@/app/albums/[id]/print/content/_print-content';
import type { Block, Overlay } from '@/lib/builder/model';
import type { ProductDimensions } from '@/lib/products/model';

const STANDARD: ProductDimensions = {
  widthCm: 21,
  heightCm: 29.7,
  printWidthCm: 21,
  printHeightCm: 29.7,
  builderAspectRatio: 21 / 29.7,
};

const photo = (id: string): PrintPhoto => ({ id, url: `https://r2.test/${id}.jpg`, edit: null });

/** A page carrying `overlays` — geometry supplied by the caller, including off-page rects. */
function block(key: string, overlays: Overlay[]): Block {
  return {
    key,
    template: 'single-pair',
    photoIds: [],
    caption: '',
    overlays: overlays as Block['overlays'],
    texts: [],
    qrs: [],
    stickers: [],
    background: null,
  };
}

const ov = (id: string, x: number, y: number, w: number, h: number): Overlay => ({
  id,
  photoId: `p${id}`,
  x,
  y,
  w,
  h,
});

const render = (blocks: Block[], photos: PrintPhoto[]) =>
  renderToStaticMarkup(
    React.createElement(PrintContent, { blocks, photos, dimensions: STANDARD, stickerUrls: {} }),
  );

/** The `.print-page` declaration block — the page's own geometry, comments stripped. */
function pageRule(html: string): string {
  return html
    .slice(html.indexOf('.print-page {'), html.indexOf('.print-page + .print-page'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ===============================================================================================
// GROUP 1 + 4 — the page rectangle never depends on how many children it has
// ===============================================================================================

describe('the page rectangle is fixed, whatever the page contains', () => {
  const cases: [string, Block[], PrintPhoto[]][] = [
    ['0 overlays', [block('0', [])], []],
    ['1 overlay', [block('0', [ov('a', 0, 0, 0.5, 1)])], [photo('pa')]],
    ['2 overlays', [block('0', [ov('a', 0, 0, 0.5, 1), ov('b', 0.5, 0, 0.5, 1)])], [photo('pa'), photo('pb')]],
    [
      '4 overlays',
      [block('0', [ov('a', 0, 0, 0.5, 0.5), ov('b', 0.5, 0, 0.5, 0.5), ov('c', 0, 0.5, 0.5, 0.5), ov('d', 0.5, 0.5, 0.5, 0.5)])],
      ['pa', 'pb', 'pc', 'pd'].map(photo),
    ],
    [
      '24 overlays',
      [block('0', Array.from({ length: 24 }, (_, i) => ov(`o${i}`, (i % 6) * 0.16, Math.floor(i / 6) * 0.25, 0.15, 0.24)))],
      Array.from({ length: 24 }, (_, i) => photo(`po${i}`)),
    ],
  ];

  const reference = pageRule(render(cases[0][1], cases[0][2]));

  it.each(cases)('%s produces the identical page rule', (_label, blocks, photos) => {
    expect(pageRule(render(blocks, photos))).toBe(reference);
  });

  it('and that rule pins an explicit, content-independent size', () => {
    expect(reference).toContain('width: 779px; height: 1100px;');
  });
});

// ===============================================================================================
// GROUP 2 — off-page content changes nothing about the page
// ===============================================================================================

describe('an element outside the page does not change the page', () => {
  const inside = [block('0', [ov('a', 0.1, 0.1, 0.3, 0.3)])];
  const offPage: [string, Block[]][] = [
    ['extends left', [block('0', [ov('a', -0.4, 0.1, 0.3, 0.3)])]],
    ['extends right', [block('0', [ov('a', 0.9, 0.1, 0.3, 0.3)])]],
    ['extends above', [block('0', [ov('a', 0.1, -0.4, 0.3, 0.3)])]],
    ['extends below', [block('0', [ov('a', 0.1, 0.9, 0.3, 0.3)])]],
    ['crosses a corner', [block('0', [ov('a', -0.2, -0.2, 0.4, 0.4)])]],
    ['spans the whole pair and beyond', [block('0', [ov('a', -0.5, -0.5, 1, 1)])]],
    ['entirely outside', [block('0', [ov('a', -0.5, -0.5, 0.2, 0.2)])]],
  ];

  const reference = pageRule(render(inside, [photo('pa')]));

  it.each(offPage)('%s leaves the page rule identical', (_label, blocks) => {
    expect(pageRule(render(blocks, [photo('pa')]))).toBe(reference);
  });

  it.each(offPage)('%s leaves the @page size identical', (_label, blocks) => {
    expect(render(blocks, [photo('pa')])).toContain('@page { size: 206mm 291mm; margin: 0; }');
  });
});

// ===============================================================================================
// GROUP 3 — the page is a hard clipping boundary
// ===============================================================================================

describe('the page clips, and its size is contained', () => {
  const html = render([block('0', [ov('a', 0.9, 0.9, 0.4, 0.4)])], [photo('pa')]);

  it('clips what is painted', () => {
    expect(pageRule(html)).toContain('overflow: hidden');
  });

  it('CONTAINS ITS SIZE — the declaration that stops overflow reaching the print sheet', () => {
    // `strict` is `size layout style paint`; `size` is the part that matters and the minimal one
    // that worked. Anything without `size` left the sheet enlarged.
    const rule = pageRule(html);
    expect(rule).toMatch(/contain:\s*(strict|[^;]*\bsize\b[^;]*);/);
  });

  it('still lets the overlay overflow — clipping is not repositioning', () => {
    // The off-page overlay keeps its true geometry; only the visible intersection is painted.
    expect(html).toContain('left:90%;top:90%;width:40%;height:40%');
  });

  it('keeps the overlay container itself clipped, with no frame', () => {
    expect(html).toContain('class="absolute overflow-hidden"');
    expect(html).not.toContain('border-white');
  });
});

// ===============================================================================================
// Every print route carries the same boundary
// ===============================================================================================

describe('all three print routes declare the page a containment boundary', () => {
  const files = {
    interior: 'src/app/albums/[id]/print/content/_print-content.tsx',
    preview: 'src/app/albums/[id]/print/_print-album.tsx',
    cover: 'src/app/albums/[id]/print/cover/_print-cover.tsx',
  };

  it.each(Object.entries(files))('%s contains the page size', (_name, file) => {
    const src = readFileSync(resolve(__dirname, '..', file), 'utf8');
    expect(src).toMatch(/contain:\s*strict;/);
  });

  it('the preview book is the most exposed — it is always 30+ pages', () => {
    const src = readFileSync(resolve(__dirname, '..', files.preview), 'utf8');
    const rule = src.slice(src.indexOf('.pdf-page {'), src.indexOf('.pdf-page + .pdf-page'));
    expect(rule).toContain('contain: strict;');
    expect(rule).toContain('overflow: hidden');
  });
});
