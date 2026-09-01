/**
 * THE RENDERERS SHOW EACH PLACEMENT'S OWN PICTURE.
 *
 * `tests/photo-placements.test.ts` pins the MODEL — that a container may carry its own
 * `EditConfig` and that resolution falls back to the source photo. This pins the half that
 * actually reaches a customer and a printer: that the shared renderers apply it.
 *
 * There are exactly two of them, and every surface goes through one or the other:
 *
 *   `PairContent`      the content spread — the builder canvas, the in-app preview, the flipbook,
 *                      the navigator, review mode, AND both printer-ready PDF routes.
 *   `CoverDesign` /    the three cover faces — the builder's cover canvas, the preview, review
 *   `BackCoverDesign`  mode, the dashboard shelf, and the printer-ready cover export.
 *
 * So asserting these two IS asserting the PDF: the print routes render this markup in headless
 * Chromium, with no rendering of their own (see `_print-content.tsx` / `_print-cover.tsx`).
 *
 * ── WHAT IS ASSERTED, AND WHY IT IS THESE FIELDS ───────────────────────────────────────────
 *
 * `PhotoFrame` splits an `EditConfig` in two: the GEOMETRY half (crop / zoom / offset / rotate)
 * needs a measured box and a decoded image, so on a server render it is not yet resolved; the
 * FILTER + FINISH half (`cssFilter` / `frameFinish` — brightness, contrast, saturation, grayscale,
 * opacity, radius, shadow) is pure and lands in the markup immediately. Both halves come from the
 * SAME resolved `edit` prop, so proving the frame received the right object with the filter fields
 * proves it received the right object, full stop.
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import PairContent, { type PairPhoto } from '@/app/(app)/albums/[id]/build/_pair-frame';
import { BackCoverDesign } from '@/app/(app)/albums/[id]/build/_cover-render';
import { DEFAULT_BACK_COVER, type BackCoverConfig } from '@/lib/builder/cover';
import type { Block, EditConfig, Overlay } from '@/lib/builder/model';

const A = '11111111-1111-4111-8111-111111111111';
const URL_A = 'https://r2.example/one.jpg';

/** ONE source photo, with a source-level edit that unforked frames must inherit. */
const SOURCE_EDIT: EditConfig = { brightness: 1.5 };
const photoFor = (id: string | null | undefined): PairPhoto | undefined =>
  id === A ? { url: URL_A, edit: SOURCE_EDIT } : undefined;

const ov = (id: string, edit?: EditConfig | null): Overlay => ({
  id,
  photoId: A,
  x: 0.1,
  y: 0.1,
  w: 0.3,
  h: 0.3,
  ...(edit === undefined ? {} : { edit }),
});

const block = (over: Partial<Block> = {}): Block => ({
  key: 'b1',
  template: 'single-pair',
  photoIds: [],
  caption: '',
  overlays: [],
  texts: [],
  qrs: [],
  stickers: [],
  background: null,
  ...over,
});

/** Every `filter:` declaration in the markup, in document order. */
const filters = (html: string) => Array.from(html.matchAll(/filter:([^;"]+)/g)).map((m) => m[1].trim());
/** Every `opacity:` declaration, in document order. */
const opacities = (html: string) => Array.from(html.matchAll(/opacity:([^;"]+)/g)).map((m) => m[1].trim());

// ===============================================================================================
// The content spread
// ===============================================================================================

describe('PairContent renders each placement independently', () => {
  it('two overlays of the SAME photo render their OWN edits', () => {
    const html = renderToStaticMarkup(
      <PairContent
        block={block({ overlays: [ov('o1', { brightness: 0.5 }), ov('o2', { brightness: 2 })] })}
        photoFor={photoFor}
      />,
    );
    // One image, two pictures.
    expect(html.split(URL_A).length - 1).toBe(2);
    expect(filters(html)).toEqual(['brightness(0.5)', 'brightness(2)']);
  });

  it('an UNFORKED overlay inherits the source photo — legacy albums render exactly as before', () => {
    const html = renderToStaticMarkup(
      <PairContent block={block({ overlays: [ov('o1'), ov('o2', { brightness: 2 })] })} photoFor={photoFor} />,
    );
    expect(filters(html)).toEqual(['brightness(1.5)', 'brightness(2)']);
  });

  it('an EMPTY placement edit (`{}`) is a deliberate reset, not "inherit"', () => {
    const html = renderToStaticMarkup(
      <PairContent block={block({ overlays: [ov('o1', {})] })} photoFor={photoFor} />,
    );
    expect(filters(html)).toEqual(['none']);
  });

  it('the two page halves of one photo carry their own POSITIONAL edits', () => {
    const html = renderToStaticMarkup(
      <PairContent
        block={block({ photoIds: [A, A], baseEdits: [{ brightness: 0.4 }, { brightness: 1.9 }] })}
        photoFor={photoFor}
      />,
    );
    expect(filters(html)).toEqual(['brightness(0.4)', 'brightness(1.9)']);
  });

  it('a half with no edit of its own inherits, while its neighbour keeps its fork', () => {
    const html = renderToStaticMarkup(
      <PairContent block={block({ photoIds: [A, A], baseEdits: [null, { brightness: 1.9 }] })} photoFor={photoFor} />,
    );
    expect(filters(html)).toEqual(['brightness(1.5)', 'brightness(1.9)']);
  });

  it('a legacy block with NO baseEdits key at all is unchanged', () => {
    const html = renderToStaticMarkup(<PairContent block={block({ photoIds: [A, A] })} photoFor={photoFor} />);
    expect(filters(html)).toEqual(['brightness(1.5)', 'brightness(1.5)']);
  });

  it('per-page PDF rendering keeps each half\'s own edit', () => {
    // The interior export renders one physical page at a time (`half`), which is where a
    // positional edit could most easily be read off the wrong index.
    const b = block({ photoIds: [A, A], baseEdits: [{ brightness: 0.4 }, { brightness: 1.9 }] });
    expect(filters(renderToStaticMarkup(<PairContent block={b} photoFor={photoFor} half="left" />))).toEqual([
      'brightness(0.4)',
    ]);
    expect(filters(renderToStaticMarkup(<PairContent block={b} photoFor={photoFor} half="right" />))).toEqual([
      'brightness(1.9)',
    ]);
  });
});

// ===============================================================================================
// The back cover — the same overlay, on a face
// ===============================================================================================

describe('the back cover renders placements the same way a page does', () => {
  const back = (overlays: Overlay[]): BackCoverConfig => ({ ...DEFAULT_BACK_COVER, overlays });

  it('a back-cover overlay renders ITS OWN edit, not the source photo\'s', () => {
    const html = renderToStaticMarkup(
      <BackCoverDesign back={back([ov('c1', { brightness: 0.25 })])} imageUrl={null} photoFor={photoFor} />,
    );
    expect(filters(html)).toEqual(['brightness(0.25)']);
  });

  it('an unforked back-cover overlay inherits — no migration needed for existing covers', () => {
    const html = renderToStaticMarkup(
      <BackCoverDesign back={back([ov('c1')])} imageUrl={null} photoFor={photoFor} />,
    );
    expect(filters(html)).toEqual(['brightness(1.5)']);
  });

  /**
   * THE REPORTED SCENARIO, END TO END IN THE RENDERERS.
   *
   * One image on a page, on another page, and on the back cover. Each is adjusted differently and
   * each draws differently — which is exactly what the printed book will contain, because these
   * are the components the print routes render.
   */
  it('page · page · back cover — three placements of one photo, three pictures', () => {
    const page1 = renderToStaticMarkup(
      <PairContent block={block({ photoIds: [A], baseEdits: [{ opacity: 0.2 }] })} photoFor={photoFor} />,
    );
    const page5 = renderToStaticMarkup(
      <PairContent block={block({ overlays: [ov('o5', { opacity: 0.6 })] })} photoFor={photoFor} />,
    );
    const cover = renderToStaticMarkup(
      <BackCoverDesign back={back([ov('c1', { opacity: 0.9 })])} imageUrl={null} photoFor={photoFor} />,
    );
    expect(opacities(page1)).toContain('0.2');
    expect(opacities(page5)).toContain('0.6');
    expect(opacities(cover)).toContain('0.9');
    // And none of them leaked into the others.
    expect(opacities(page1)).not.toContain('0.9');
    expect(opacities(cover)).not.toContain('0.2');
  });
});
