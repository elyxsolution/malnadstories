/**
 * THE BUILDER'S PRINT GUIDES — real components, rendered.
 *
 * These overlays are the only thing standing between a customer and a photo whose subject gets
 * cut off, so their geometry has to be the specification's and their behaviour has to be inert.
 * Both are asserted here against the actual rendered output rather than described in a comment.
 */
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  TrimGuides,
  SafeAreaGuides,
  TRIM_GUIDE_CAPTION,
  pageInsetStyle,
} from '@/app/(app)/albums/[id]/build/_print-guides';
import {
  INTERIOR_ARTWORK,
  INTERIOR_SAFE_INSET_FRACTION,
  INTERIOR_TRIM,
  INTERIOR_TRIM_INSET_FRACTION,
} from '@/lib/print/spec';

const trim = renderToStaticMarkup(React.createElement(TrimGuides));
const safe = renderToStaticMarkup(React.createElement(SafeAreaGuides));

/** Every `left/top/width/height` percentage on the guide rectangles, in render order. */
function rects(html: string) {
  return Array.from(
    html.matchAll(/left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%;height:([\d.]+)%/g),
  ).map((m) => ({
    left: Number(m[1]),
    top: Number(m[2]),
    width: Number(m[3]),
    height: Number(m[4]),
  }));
}

describe('the trim guide draws one rectangle per PAGE', () => {
  it('draws exactly two — the pair is two separate printed sheets', () => {
    expect(rects(trim)).toHaveLength(2);
  });

  it('insets each page by 3/206 across and 3/291 down', () => {
    const [left, right] = rects(trim);
    const insetX = (INTERIOR_TRIM_INSET_FRACTION.x * 0.5) * 100; // per-page fraction, in pair space
    const insetY = INTERIOR_TRIM_INSET_FRACTION.y * 100;

    expect(left.left).toBeCloseTo(insetX, 6);
    expect(left.top).toBeCloseTo(insetY, 6);
    expect(right.left).toBeCloseTo(50 + insetX, 6);
    expect(right.top).toBeCloseTo(insetY, 6);
  });

  it('gives each rectangle the exact 200/206 × 285/291 proportion of its page', () => {
    for (const r of rects(trim)) {
      // Width is expressed in PAIR space, so a full page is 50%.
      expect(r.width / 50).toBeCloseTo(INTERIOR_TRIM.w / INTERIOR_ARTWORK.w, 9);
      expect(r.width / 50).toBeCloseTo(200 / 206, 9);
      expect(r.height / 100).toBeCloseTo(INTERIOR_TRIM.h / INTERIOR_ARTWORK.h, 9);
      expect(r.height / 100).toBeCloseTo(285 / 291, 9);
    }
  });

  it('ends each rectangle exactly one bleed short of its page edge', () => {
    const [left, right] = rects(trim);
    const insetX = (INTERIOR_TRIM_INSET_FRACTION.x * 0.5) * 100;
    // Left page runs to the gutter; right page runs to the outer edge. Both stop one bleed short.
    expect(left.left + left.width).toBeCloseTo(50 - insetX, 6);
    expect(right.left + right.width).toBeCloseTo(100 - insetX, 6);
    expect(left.top + left.height).toBeCloseTo(100 - INTERIOR_TRIM_INSET_FRACTION.y * 100, 6);
  });

  it('never spans the gutter — the two pages are trimmed independently', () => {
    const [left, right] = rects(trim);
    expect(left.left + left.width).toBeLessThan(50);
    expect(right.left).toBeGreaterThan(50);
  });

  it('is dashed, not solid', () => {
    expect(trim).toContain('border-dashed');
  });
});

describe('the 15 mm safe guide', () => {
  it('also draws one rectangle per page', () => {
    expect(rects(safe)).toHaveLength(2);
  });

  it('sits strictly inside the trim guide on both axes', () => {
    const [t] = rects(trim);
    const [s] = rects(safe);
    expect(s.left).toBeGreaterThan(t.left);
    expect(s.top).toBeGreaterThan(t.top);
    expect(s.width).toBeLessThan(t.width);
    expect(s.height).toBeLessThan(t.height);
  });

  it('is 15 mm inside the trim, measured in real millimetres', () => {
    const [t] = rects(trim);
    const [s] = rects(safe);
    // Convert the pair-space gap back to millimetres of one 206 mm page.
    const gapMmX = ((s.left - t.left) / 50) * INTERIOR_ARTWORK.w;
    const gapMmY = ((s.top - t.top) / 100) * INTERIOR_ARTWORK.h;
    expect(gapMmX).toBeCloseTo(15, 6);
    expect(gapMmY).toBeCloseTo(15, 6);
  });

  it('uses a different colour from the trim, so the two are not confused', () => {
    expect(trim).toContain('border-foreground/45');
    expect(safe).toContain('border-studio/45');
    expect(trim).not.toContain('border-studio/45');
  });
});

describe('the guides are inert reference overlays, not design objects', () => {
  it('never receives pointer events', () => {
    for (const html of [trim, safe]) expect(html).toContain('pointer-events-none');
  });

  it('is hidden from assistive technology', () => {
    for (const html of [trim, safe]) expect(html).toContain('aria-hidden');
  });

  it('carries no id, so nothing can select, address or persist it', () => {
    for (const html of [trim, safe]) {
      expect(html).not.toMatch(/\bid="/);
      expect(html).not.toContain('data-element');
    }
  });

  it('renders no interactive element at all', () => {
    for (const html of [trim, safe]) {
      expect(html).not.toMatch(/<(button|a|input|textarea|select)\b/);
      expect(html).not.toContain('draggable');
      expect(html).not.toContain('contenteditable');
    }
  });

  it('is pure geometry — the same input always renders the same output', () => {
    expect(renderToStaticMarkup(React.createElement(TrimGuides))).toBe(trim);
  });
});

describe('the guides are resolution-independent', () => {
  it('positions everything in percentages, never pixels', () => {
    for (const html of [trim, safe]) {
      expect(html).not.toMatch(/\d px/);
      expect(html).not.toMatch(/:\s*-?\d+(\.\d+)?px/);
    }
  });

  it('holds the same ratio at any rendered size — desktop, tablet or phone', () => {
    const style = pageInsetStyle(INTERIOR_TRIM_INSET_FRACTION, 'left');
    for (const pairWidthPx of [320, 768, 1024, 1700, 4000]) {
      const insetPx = (parseFloat(style.left as string) / 100) * pairWidthPx;
      const pagePx = pairWidthPx / 2;
      expect(insetPx / pagePx).toBeCloseTo(3 / 206, 9);
    }
  });

  it('mirrors the left page onto the right with no drift', () => {
    const l = pageInsetStyle(INTERIOR_SAFE_INSET_FRACTION, 'left');
    const r = pageInsetStyle(INTERIOR_SAFE_INSET_FRACTION, 'right');
    expect(parseFloat(r.left as string) - parseFloat(l.left as string)).toBeCloseTo(50, 9);
    expect(r.width).toBe(l.width);
    expect(r.height).toBe(l.height);
    expect(r.top).toBe(l.top);
  });
});

describe('the caption explains the right boundary', () => {
  it('says what survives the cut, unambiguously', () => {
    expect(TRIM_GUIDE_CAPTION).toMatch(/inside the dotted line/i);
    expect(TRIM_GUIDE_CAPTION).toMatch(/printed/i);
  });

  it('does NOT call the whole sheet the printed area', () => {
    // The printer receives 206 × 291 and trims to 200 × 285. "Only the outer edge is printed"
    // would be precisely backwards, and the bleed is not a margin.
    expect(TRIM_GUIDE_CAPTION).toMatch(/trimmed off/i);
    expect(TRIM_GUIDE_CAPTION).not.toMatch(/\bmargin\b/i);
  });

  it('is builder chrome — it is not rendered by the guide overlays themselves', () => {
    // It lives in the pasteboard beneath the page, never inside the artwork.
    expect(trim).not.toContain(TRIM_GUIDE_CAPTION);
    expect(safe).not.toContain(TRIM_GUIDE_CAPTION);
  });
});
