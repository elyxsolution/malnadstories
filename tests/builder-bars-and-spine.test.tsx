/**
 * TWO BUILDER DEFECTS, and the properties that stop them coming back.
 *
 * 1 · THE OVERLAY TOOLBAR SAT ON TOP OF THE PAGE TOOLBAR. The two floating shells are
 *     independent positioners — each knew only its own anchor — so an overlay near the top of
 *     the spread put its bar exactly where the persistent page bar already was. The fix gives
 *     the object bar a RESERVED BAND to avoid; what is asserted here is that avoiding it is
 *     total, not a well-chosen offset: swept across every anchor position, the placement never
 *     intersects the band.
 *
 * 2 · SPINE TEXT WENT TINY WHILE TYPING. `InlineTextEditor` carried its own copy of the
 *     font-size formula, hardcoded to `cqw`, while `textFontSize` resolves a SPINE object
 *     against `cqh`. The spine face is `container-type: size`, a sliver wide and a page tall,
 *     so the editor rendered a fraction of the real size and snapped back on commit. The fix
 *     deletes the duplicate; the test asserts the editor and the renderer agree.
 *
 * The pointer-capture fix in `_movable.tsx` is NOT covered here — pointer capture, `buttons`
 * and `lostpointercapture` have no meaningful implementation in this suite's node environment.
 * See tests/README.md.
 */
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { placeBar, PAGE_BAR_GAP, type BarBand } from '@/app/(app)/albums/[id]/build/_canvas-bar';
import { InlineTextEditor } from '@/app/(app)/albums/[id]/build/_element-bits';
import { textFontSize } from '@/lib/builder/elements';
import type { TextElement } from '@/lib/builder/model';

const VIEW = { viewportW: 1440, viewportH: 900 };
const BAR = { barW: 420, barH: 44 };

/** The page bar's band, as it lands for a spread whose top edge is at y. */
const pageBandFor = (pageTop: number): BarBand => {
  const { top } = placeBar({
    anchor: { left: 200, top: pageTop, width: 1000, height: 640 },
    ...BAR,
    gap: PAGE_BAR_GAP,
    avoid: null,
    ...VIEW,
  });
  return { top, bottom: top + BAR.barH };
};

const overlaps = (a: BarBand, b: BarBand) => a.top < b.bottom && a.bottom > b.top;

describe('bar placement', () => {
  it('puts the page bar clear of the book, further than an object bar sits', () => {
    const pageTop = 200;
    const page = placeBar({
      anchor: { left: 200, top: pageTop, width: 1000, height: 640 },
      ...BAR,
      gap: PAGE_BAR_GAP,
      avoid: null,
      ...VIEW,
    });
    // Above the spread, by its own larger gap.
    expect(page.top + BAR.barH).toBe(pageTop - PAGE_BAR_GAP);
    expect(PAGE_BAR_GAP).toBeGreaterThan(10); // the standard object gap
  });

  it('NEVER overlaps the reserved band — swept across every overlay position on the spread', () => {
    const pageTop = 200;
    const pageHeight = 640;
    const band = pageBandFor(pageTop);

    // An overlay anywhere on the spread, at a range of sizes.
    for (let y = pageTop; y <= pageTop + pageHeight; y += 5) {
      for (const h of [20, 60, 160, 400]) {
        const placed = placeBar({
          anchor: { left: 300, top: y, width: 240, height: h },
          ...BAR,
          gap: 10,
          avoid: band,
          ...VIEW,
        });
        const bar: BarBand = { top: placed.top, bottom: placed.top + BAR.barH };
        expect(
          overlaps(bar, band),
          `overlay at y=${y} h=${h} produced bar ${bar.top}–${bar.bottom} inside band ${band.top}–${band.bottom}`,
        ).toBe(false);
      }
    }
  });

  it('still prefers ABOVE the object when that does not hit the band', () => {
    const band = pageBandFor(200);
    // An overlay low on the spread has plenty of room above it.
    const placed = placeBar({
      anchor: { left: 300, top: 600, width: 240, height: 80 },
      ...BAR,
      gap: 10,
      avoid: band,
      ...VIEW,
    });
    expect(placed.below).toBe(false);
    expect(placed.top + BAR.barH).toBe(600 - 10);
  });

  it('flips BELOW the object rather than into the band, for an overlay at the top of the spread', () => {
    const band = pageBandFor(200);
    const placed = placeBar({
      anchor: { left: 300, top: 210, width: 240, height: 80 }, // hugging the top edge
      ...BAR,
      gap: 10,
      avoid: band,
      ...VIEW,
    });
    expect(placed.below).toBe(true);
    expect(placed.top).toBeGreaterThanOrEqual(band.bottom);
  });

  it('behaves exactly as before when no band is reserved (the cover bar path)', () => {
    const anchor = { left: 300, top: 500, width: 240, height: 80 };
    const withNull = placeBar({ anchor, ...BAR, gap: 10, avoid: null, ...VIEW });
    expect(withNull.top + BAR.barH).toBe(500 - 10);
    expect(withNull.below).toBe(false);
  });

  it('keeps the bar horizontally centred on its anchor and inside the viewport', () => {
    const centred = placeBar({
      anchor: { left: 600, top: 500, width: 200, height: 80 },
      ...BAR,
      gap: 10,
      avoid: null,
      ...VIEW,
    });
    expect(centred.left).toBe(600 + 100 - BAR.barW / 2);

    // Hard against the right edge — clamped, never overflowing.
    const clamped = placeBar({
      anchor: { left: 1400, top: 500, width: 40, height: 80 },
      ...BAR,
      gap: 10,
      avoid: null,
      ...VIEW,
    });
    expect(clamped.left + BAR.barW).toBeLessThanOrEqual(VIEW.viewportW);
  });
});

const textEl = (over: Partial<TextElement> = {}): TextElement =>
  ({
    id: 't1',
    kind: 'text',
    role: undefined,
    text: 'Kodachadri',
    x: 0.1,
    y: 0.1,
    w: 0.5,
    h: 0.2,
    font: 'serif',
    size: 40,
    weight: 400,
    italic: false,
    underline: false,
    align: 'center',
    color: '#1e3a2f',
    letterSpacing: 0,
    lineHeight: 1.3,
    opacity: 1,
    rotation: 0,
    shadow: false,
    ...over,
  }) as TextElement;

describe('inline text editor font size', () => {
  it('uses the SAME size the renderer uses, for a spine object', () => {
    const spine = textEl({ role: 'spine' });
    const html = renderToStaticMarkup(<InlineTextEditor initial={spine.text} el={spine} onCommit={() => {}} />);

    // The renderer's answer for a spine is measured against HEIGHT.
    expect(textFontSize(spine)).toContain('cqh');
    expect(html).toContain(`font-size:${textFontSize(spine)}`);
  });

  it('never renders a spine editor in cqw — the bug that made typing shrink the text', () => {
    const spine = textEl({ role: 'spine' });
    const html = renderToStaticMarkup(<InlineTextEditor initial={spine.text} el={spine} onCommit={() => {}} />);
    expect(html).not.toMatch(/font-size:[\d.]+cqw/);
  });

  it('leaves every non-spine object on cqw, exactly as before', () => {
    for (const role of [undefined, 'title', 'subtitle', 'author'] as const) {
      const el = textEl({ role });
      const html = renderToStaticMarkup(<InlineTextEditor initial={el.text} el={el} onCommit={() => {}} />);
      expect(textFontSize(el)).toContain('cqw');
      expect(html).toContain(`font-size:${textFontSize(el)}`);
    }
  });

  it('is stable across text length — size depends on the element, never on what is typed', () => {
    const short = textEl({ role: 'spine', text: 'A' });
    const long = textEl({ role: 'spine', text: 'A'.repeat(200) });
    const empty = textEl({ role: 'spine', text: '' });
    expect(textFontSize(long)).toBe(textFontSize(short));
    expect(textFontSize(empty)).toBe(textFontSize(short));
  });
});
