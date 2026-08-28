/**
 * THE PREVIEW PDF IS UNCHANGED.
 *
 * The print-export work reaches into shared code — the cover renderers, the PDF generator, the
 * `album_pdfs` schema, the worker contract — so "the customer's preview book still renders exactly
 * as it did" cannot be left as an assurance. This file renders the REAL `_print-album` (the preview
 * renderer, which the print work did not touch) and pins the properties that would break first if
 * a shared change leaked into it.
 *
 * It is deliberately written against the PREVIEW's own contract, not the print specification: the
 * preview is one PDF containing cover + blanks + content + back + spine at the album PRODUCT's
 * dimensions, and none of the printer-ready geometry belongs in it.
 */
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import PrintAlbum, { type PrintPhoto, type PrintCover } from '@/app/albums/[id]/print/_print-album';
import { DEFAULT_COVER_CONFIG, normalizeCoverConfig, spineWidthFor } from '@/lib/builder/cover';
import { FRONT_MATTER_PAGES, type Block } from '@/lib/builder/model';
import type { ProductDimensions } from '@/lib/products/model';

const STANDARD: ProductDimensions = {
  widthCm: 21,
  heightCm: 29.7,
  printWidthCm: 21,
  printHeightCm: 29.7,
  builderAspectRatio: 21 / 29.7,
};

const photo = (id: string): PrintPhoto => ({ id, url: `https://r2.test/${id}.jpg`, edit: null });

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

function album(contentPages: number) {
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

const cover = (size: number): PrintCover => ({
  imageUrl: null,
  backImageUrl: null,
  config: normalizeCoverConfig(DEFAULT_COVER_CONFIG),
  title: 'COORG MONSOON',
  size,
});

function render(contentPages: number, dimensions = STANDARD): string {
  const { blocks, photos } = album(contentPages);
  return renderToStaticMarkup(
    React.createElement(PrintAlbum, {
      blocks,
      photos,
      cover: cover(contentPages),
      dimensions,
      stickerUrls: {},
    }),
  );
}

const pdfPages = (html: string) => (html.match(/class="pdf-page/g) ?? []).length;

describe('the preview book keeps its own page sequence', () => {
  it('is cover + 2 blanks + N content + 2 blanks + back + spine', () => {
    // 1 cover + 2 blanks + 24 content + 2 blanks + 1 back + 1 spine = 31.
    expect(pdfPages(render(24))).toBe(1 + 2 + 24 + 2 + 1 + 1);
    expect(FRONT_MATTER_PAGES).toBe(3);
  });

  it.each([24, 36, 48])('scales with the album (%i content pages)', (pages) => {
    expect(pdfPages(render(pages))).toBe(pages + 7);
  });

  it('still emits the spine as its own named page at the END', () => {
    const html = render(24);
    expect(html).toContain('pdf-page-spine');
    // Appending cannot shift anything: the spine is the last page in the document.
    expect(html.lastIndexOf('pdf-page-spine')).toBeGreaterThan(html.lastIndexOf('class="pdf-page"'));
  });

  it('is NOT the interior export — it contains all the matter the print file drops', () => {
    const html = render(24);
    expect(pdfPages(html)).toBeGreaterThan(24);
    expect(html).toContain('pdf-page-spine');
  });
});

describe('the preview book keeps the PRODUCT’s dimensions, never the print specification', () => {
  it('sizes @page from the album product', () => {
    const html = render(24);
    expect(html).toContain('@page { size: 21cm 29.7cm; margin: 0; }');
  });

  it('never adopts the interior bleed box', () => {
    const html = render(24);
    expect(html).not.toContain('206mm');
    expect(html).not.toContain('291mm');
  });

  it('never adopts the cover artwork size', () => {
    const html = render(24);
    expect(html).not.toContain('487mm');
    expect(html).not.toContain('327mm');
  });

  it('follows a different product without any print constant leaking in', () => {
    const premium: ProductDimensions = {
      widthCm: 25,
      heightCm: 35,
      printWidthCm: 25,
      printHeightCm: 35,
      builderAspectRatio: 25 / 35,
    };
    expect(render(24, premium)).toContain('@page { size: 25cm 35cm; margin: 0; }');
  });
});

describe('the preview spine keeps its ADVISORY, page-count-dependent width', () => {
  it('still derives from spineWidthFor, so a thicker book still reads thicker', () => {
    // The print export fixes the spine at 13 mm; the PREVIEW deliberately does not, and that
    // difference is the whole reason `spineWidthFor` was left alone.
    expect(spineWidthFor(24)).toBeCloseTo(0.06, 10);
    expect(spineWidthFor(48)).toBeCloseTo(0.12, 10);
    expect(spineWidthFor(48)).toBeGreaterThan(spineWidthFor(24));

    const thin = /@page spine \{ size: ([\d.]+)cm/.exec(render(24))?.[1];
    const thick = /@page spine \{ size: ([\d.]+)cm/.exec(render(48))?.[1];
    expect(Number(thin)).toBeCloseTo(spineWidthFor(24) * STANDARD.printWidthCm, 3);
    expect(Number(thick)).toBeCloseTo(spineWidthFor(48) * STANDARD.printWidthCm, 3);
    expect(Number(thick)).toBeGreaterThan(Number(thin));
  });

  it('KEEPS the on-screen bound-edge shading that print suppresses', () => {
    // `SpineDesign`'s new `print` prop defaults to false, so every pre-existing caller — including
    // this one — paints exactly what it always painted.
    expect(render(24)).toContain('rgba(0,0,0,0.22)');
  });
});

describe('the preview book KEEPS the overlay chrome the print export drops', () => {
  /**
   * The converse of the white-hairline fix, and the reason it is safe.
   *
   * `PairContent`'s `print` prop defaults to false, so the preview still draws the white photo
   * border and its drop shadow exactly as it always did. If a future change made the suppression
   * unconditional, the customer's preview would silently change appearance — this fails first.
   */
  const withOverlay: Block = {
    key: '0',
    template: 'single-pair',
    photoIds: [],
    caption: '',
    overlays: [
      { id: 'o1', photoId: 'p1', x: 0, y: 0, w: 0.5, h: 1 },
      { id: 'o2', photoId: 'p2', x: 0.5, y: 0, w: 0.5, h: 1 },
    ] as Block['overlays'],
    texts: [],
    qrs: [],
    stickers: [],
    background: null,
  };

  const html = renderToStaticMarkup(
    React.createElement(PrintAlbum, {
      blocks: [withOverlay],
      photos: [photo('p1'), photo('p2')],
      cover: cover(2),
      dimensions: STANDARD,
      stickerUrls: {},
    }),
  );

  it('still draws the white photo border', () => {
    expect(html).toContain('border-2 border-white');
  });

  it('still draws the drop shadow', () => {
    expect(html).toMatch(/class="[^"]*\bshadow\b/);
  });

  it('carries none of the printer-ready guide geometry', () => {
    expect(html).not.toContain('stroke-dasharray');
    expect(html).not.toContain('data-guide');
    expect(html).not.toMatch(/inside the dotted line/i);
  });
});
