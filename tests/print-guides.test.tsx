/**
 * PRINT REFERENCE GUIDES — the geometry of every dotted line, in the exported PDFs and in the
 * builder, plus the white-hairline regression.
 *
 * A guide that is a few millimetres out is worse than no guide: it is a wrong answer someone
 * designs against. So every position here is asserted against `lib/print/spec`, which is asserted
 * against the supplied drawing in `print-spec.test.ts` — one chain, no second copy of the numbers.
 */
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import PrintContent, { type PrintPhoto } from '@/app/albums/[id]/print/content/_print-content';
import PrintCover from '@/app/albums/[id]/print/cover/_print-cover';
import {
  COVER_ARTWORK,
  COVER_FOLD_FRACTIONS,
  COVER_FOLD_LINES_MM,
  COVER_GUIDE_LINES_ENABLED,
  COVER_PANEL_FRACTIONS,
  COVER_SPREAD_BOX,
  GUIDE_STYLE,
  INTERIOR_ARTWORK,
  INTERIOR_SAFE_INSET_FRACTION,
  INTERIOR_TRIM,
  INTERIOR_TRIM_INSET_FRACTION,
  PRINTER_MARKS_ENABLED,
  spinePrintWidthMm,
} from '@/lib/print/spec';
import {
  DEFAULT_COVER_CONFIG,
  normalizeCoverConfig,
  type CoverConfig,
} from '@/lib/builder/cover';
import {
  LEFT_PAGE_OVERLAY_GEOM,
  RIGHT_PAGE_OVERLAY_GEOM,
  type Block,
} from '@/lib/builder/model';
import type { ProductDimensions } from '@/lib/products/model';

const STANDARD: ProductDimensions = {
  widthCm: 21,
  heightCm: 29.7,
  printWidthCm: 21,
  printHeightCm: 29.7,
  builderAspectRatio: 21 / 29.7,
};

// ═════════════════════════════════════════════════════════════════════════════════════════════
// A. The white hairline
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A page built today: photos arrive as FULL-PAGE OVERLAYS, one per side. That is the shape
 * `newUnitOverlayGeoms` gives every new spread, so it is the ordinary case — and it is the case
 * that produced the hairline, because the overlay carried a 2 px white border.
 */
const fullPageOverlays: Block = {
  key: '0',
  template: 'single-pair',
  photoIds: [],
  caption: '',
  overlays: [
    { id: 'o1', photoId: 'pA', ...LEFT_PAGE_OVERLAY_GEOM },
    { id: 'o2', photoId: 'pB', ...RIGHT_PAGE_OVERLAY_GEOM },
  ] as Block['overlays'],
  texts: [],
  qrs: [],
  stickers: [],
  background: null,
};

const photos: PrintPhoto[] = [
  { id: 'pA', url: 'https://r2.test/a.jpg', edit: null },
  { id: 'pB', url: 'https://r2.test/b.jpg', edit: null },
];

const renderContent = (blocks: Block[] = [fullPageOverlays]) =>
  renderToStaticMarkup(
    React.createElement(PrintContent, { blocks, photos, dimensions: STANDARD, stickerUrls: {} }),
  );

describe('the white hairline around content artwork', () => {
  it('draws NO white border on a printed overlay', () => {
    // ROOT CAUSE: `border-2 border-white` on the overlay container. With a full-page overlay it
    // lands exactly between the artwork and the trimmed page edge.
    const html = renderContent();
    expect(html).not.toContain('border-white');
    expect(html).not.toContain('border-2');
  });

  it('draws NO drop shadow on a printed overlay', () => {
    // The companion defect: Tailwind `shadow` prints as grey haze along the same edge.
    expect(renderContent()).not.toMatch(/class="[^"]*\bshadow\b/);
  });

  it('lets the photo reach the overlay box on every side', () => {
    // No border means no content-box inset: the <img> fills the overlay, which fills the page.
    const html = renderContent();
    expect(html).toContain('class="absolute overflow-hidden" style="left:0%;top:0%;width:50%;height:100%"');
    expect(html).toContain('class="absolute inset-0 h-full w-full select-none object-cover"');
  });

  it('still clips the overlay, so nothing escapes the page', () => {
    expect(renderContent()).toContain('overflow-hidden');
  });

  it('keeps the artwork covering the whole bleed page', () => {
    // The fill box still overscans the fragmentainer on both axes — the hairline fix removed
    // chrome, it did not shrink, stretch or reposition the artwork.
    const html = renderContent();
    const fill = /width: ([\d.]+)px; height: ([\d.]+)px;/.exec(html.slice(html.indexOf('.page-fill')));
    expect(Number(fill![1])).toBeGreaterThanOrEqual(779);
    expect(Number(fill![2])).toBeGreaterThanOrEqual(1100);
  });

  it('leaves the PDF page size untouched', () => {
    expect(renderContent()).toContain('@page { size: 206mm 291mm; margin: 0; }');
  });

  it('adds no guide lines to the interior — the fix introduced no new ink', () => {
    const html = renderContent();
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('stroke-dasharray');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B. Cover PDF guides
// ═════════════════════════════════════════════════════════════════════════════════════════════

const config = (overrides: Partial<CoverConfig> = {}): CoverConfig =>
  normalizeCoverConfig({ ...DEFAULT_COVER_CONFIG, ...overrides });

const renderCover = (cfg: CoverConfig = config()) =>
  renderToStaticMarkup(
    React.createElement(PrintCover, {
      config: cfg,
      title: 'COORG MONSOON',
      frontImageUrl: null,
      backImageUrl: null,
      stickerUrls: {},
    }),
  );

describe('cover PDF — dotted partition lines', () => {
  const html = renderCover();

  it('is enabled, and is NOT the printer-marks switch', () => {
    // Reference lines a person reads are a different thing from marks a cutter reads.
    expect(COVER_GUIDE_LINES_ENABLED).toBe(true);
    expect(PRINTER_MARKS_ENABLED).toBe(false);
  });

  it('draws the guides in a millimetre viewBox, so coordinates ARE the specification', () => {
    expect(html).toContain(`viewBox="0 0 ${COVER_ARTWORK.w} ${COVER_ARTWORK.h}"`);
    expect(html).toContain('viewBox="0 0 483 327"');
  });

  it('draws exactly four fold lines, at 225 / 235 / 248 / 258 mm', () => {
    expect(COVER_FOLD_LINES_MM).toEqual([225, 235, 248, 258]);
    const xs = Array.from(html.matchAll(/<line x1="([\d.]+)"/g)).map((m) => Number(m[1]));
    expect(xs).toEqual([225, 235, 248, 258]);
  });

  it('derives the spine boundaries rather than hardcoding them', () => {
    // spine left  = wrap + back + hinge = 15 + 210 + 10 = 235
    // spine right = spine left + 13     = 248
    const [, spineLeft, spineRight] = COVER_FOLD_LINES_MM;
    expect(spineLeft).toBe(COVER_SPREAD_BOX.x + 210 + 10);
    expect(spineRight).toBe(spineLeft + spinePrintWidthMm());
    expect(spineRight - spineLeft).toBe(13);
  });

  it('uses the drawing’s dash-dot pattern for the folds, in millimetres', () => {
    // Measured off Plate 02: 7 dash · 2 gap · 1.6 dash · 2 gap, 0.55 mm wide.
    expect(GUIDE_STYLE.fold.dashMm).toEqual([7, 2, 1.6, 2]);
    expect(GUIDE_STYLE.fold.widthMm).toBe(0.55);
    expect(html).toContain('stroke-dasharray="7 2 1.6 2"');
    expect(html).toContain('stroke-width="0.55"');
  });

  it('marks the finished edge with the drawing’s finer pattern', () => {
    expect(GUIDE_STYLE.trim.dashMm).toEqual([3, 2.2]);
    expect(html).toContain('stroke-dasharray="3 2.2"');
    expect(html).toContain(`<rect x="${COVER_SPREAD_BOX.x}" y="${COVER_SPREAD_BOX.y}" width="453" height="297"`);
  });

  it('is BLACK, thin, and dashed — never a solid border', () => {
    expect(GUIDE_STYLE.color).toBe('#000000');
    expect(html).toContain('stroke="#000000"');
    // Every stroked element carries a dash array: nothing is drawn solid.
    const strokes = Array.from(html.matchAll(/<(line|rect)\b[^>]*>/g)).map((m) => m[0]);
    expect(strokes.length).toBeGreaterThan(0);
    for (const el of strokes) expect(el).toContain('stroke-dasharray');
  });

  it('confines every line to the finished spread, so the 15 mm wrap stays blank', () => {
    const top = COVER_SPREAD_BOX.y;
    const bottom = COVER_SPREAD_BOX.y + COVER_SPREAD_BOX.h;
    expect([top, bottom]).toEqual([15, 312]);
    for (const m of Array.from(html.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g))) {
      const [, x1, y1, , y2] = m.map(Number);
      expect(Number(y1)).toBeGreaterThanOrEqual(top);
      expect(Number(y2)).toBeLessThanOrEqual(bottom);
      expect(Number(x1)).toBeGreaterThanOrEqual(COVER_SPREAD_BOX.x);
      expect(Number(x1)).toBeLessThanOrEqual(COVER_SPREAD_BOX.x + COVER_SPREAD_BOX.w);
    }
  });

  it('does not change the artwork underneath', () => {
    // The panel construction and page size are exactly what they were before the guides existed.
    expect(html).toContain('@page { size: 483mm 327mm; margin: 0; }');
    const widths = Array.from(html.matchAll(/class="cover-panel" style="[^"]*width:([\d.]+)mm/g)).map(
      (m) => Number(m[1]),
    );
    expect(widths).toEqual([210, 10, 13, 10, 210]);
  });

  it('still keeps the spine to background + title, with no shading or shadow', () => {
    expect(html).not.toContain('rgba(0,0,0,0.22)');
    expect(html).not.toContain('inset 0 0 3cqw');
    // Guides are strokes, never fills — they cannot become spine artwork.
    expect(html).toContain('fill="none"');
  });

  it('adds no crop, registration, colour-bar or slug marks', () => {
    for (const mark of [/crop-?mark/i, /registration/i, /colou?r-?bar/i, /\bslug\b/i]) {
      expect(html).not.toMatch(mark);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C. Builder guide geometry (the numbers the overlays consume)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('builder content guide — outer bleed, inner trim', () => {
  it('insets the trim by exactly 3/206 and 3/291 of the artwork', () => {
    expect(INTERIOR_TRIM_INSET_FRACTION.x).toBeCloseTo(3 / 206, 12);
    expect(INTERIOR_TRIM_INSET_FRACTION.y).toBeCloseTo(3 / 291, 12);
  });

  it('reproduces the physical ratio 200/206 and 285/291 exactly', () => {
    const w = 1 - INTERIOR_TRIM_INSET_FRACTION.x * 2;
    const h = 1 - INTERIOR_TRIM_INSET_FRACTION.y * 2;
    expect(w).toBeCloseTo(INTERIOR_TRIM.w / INTERIOR_ARTWORK.w, 12);
    expect(h).toBeCloseTo(INTERIOR_TRIM.h / INTERIOR_ARTWORK.h, 12);
    expect(w).toBeCloseTo(200 / 206, 12);
    expect(h).toBeCloseTo(285 / 291, 12);
  });

  it('is NOT the old hand-picked percentage geometry', () => {
    // The guides used to be drawn at inset-[1.5%] / 4% / 6% — numbers that corresponded to no
    // physical dimension at all.
    expect(INTERIOR_TRIM_INSET_FRACTION.x).not.toBeCloseTo(0.015, 4);
    expect(INTERIOR_TRIM_INSET_FRACTION.y).not.toBeCloseTo(0.015, 4);
    expect(INTERIOR_SAFE_INSET_FRACTION.x).not.toBeCloseTo(0.04, 4);
    expect(INTERIOR_SAFE_INSET_FRACTION.y).not.toBeCloseTo(0.06, 4);
  });

  it('keeps the trim strictly inside the artwork, and the safe area strictly inside the trim', () => {
    expect(INTERIOR_TRIM_INSET_FRACTION.x).toBeGreaterThan(0);
    expect(INTERIOR_SAFE_INSET_FRACTION.x).toBeGreaterThan(INTERIOR_TRIM_INSET_FRACTION.x);
    expect(INTERIOR_SAFE_INSET_FRACTION.y).toBeGreaterThan(INTERIOR_TRIM_INSET_FRACTION.y);
  });

  it('puts the safe boundary 15 mm inside the trim, measured from the artwork edge', () => {
    expect(INTERIOR_SAFE_INSET_FRACTION.x).toBeCloseTo((3 + 15) / 206, 12);
    expect(INTERIOR_SAFE_INSET_FRACTION.y).toBeCloseTo((3 + 15) / 291, 12);
    // The gap between the two guides IS the 15 mm safe margin.
    expect((INTERIOR_SAFE_INSET_FRACTION.x - INTERIOR_TRIM_INSET_FRACTION.x) * 206).toBeCloseTo(15, 9);
    expect((INTERIOR_SAFE_INSET_FRACTION.y - INTERIOR_TRIM_INSET_FRACTION.y) * 291).toBeCloseTo(15, 9);
  });

  it('is proportional — the fractions carry no pixel or viewport assumption', () => {
    for (const pageWidthPx of [320, 768, 1024, 1700]) {
      const insetPx = INTERIOR_TRIM_INSET_FRACTION.x * pageWidthPx;
      expect(insetPx / pageWidthPx).toBeCloseTo(3 / 206, 12);
    }
  });
});

describe('builder chrome never reaches an exported PDF', () => {
  const content = renderContent();
  const cover = renderCover();

  it('does not export the explanatory caption', () => {
    for (const html of [content, cover]) {
      expect(html).not.toMatch(/inside the dotted line/i);
      expect(html).not.toMatch(/trimmed off/i);
    }
  });

  it('does not export the builder’s trim or safe-area rectangles', () => {
    // The builder guides are `border-dashed` divs tagged `data-guide`; the cover's exported lines
    // are SVG strokes. Neither export may carry the builder's overlay.
    for (const html of [content, cover]) {
      expect(html).not.toContain('data-guide');
      expect(html).not.toContain('border-dashed');
    }
  });

  it('does not export the cover canvas’s region labels', () => {
    for (const label of ['Back', 'Hinge', 'Front']) {
      expect(cover).not.toMatch(new RegExp(`>${label}<`));
    }
    expect(cover).not.toMatch(/Spine \d+mm/);
  });

  it('exports NOTHING extra on the interior — no lines, no labels, no marks', () => {
    expect(content).not.toContain('<svg');
    expect(content).not.toContain('stroke');
  });
});

describe('builder cover guide — fold fractions', () => {
  it('places the four folds at 210 / 220 / 233 / 243 of the 453 mm spread', () => {
    expect(COVER_FOLD_FRACTIONS.map((f) => +(f * 453).toFixed(6))).toEqual([210, 220, 233, 243]);
  });

  it('gives the five regions their specified widths', () => {
    expect(COVER_PANEL_FRACTIONS.map((p) => +(p.width * 453).toFixed(6))).toEqual([210, 10, 13, 10, 210]);
    expect(COVER_PANEL_FRACTIONS.map((p) => p.name)).toEqual([
      'back',
      'hinge-left',
      'spine',
      'hinge-right',
      'front',
    ]);
  });

  it('covers the spread exactly — the five fractions sum to 1', () => {
    expect(COVER_PANEL_FRACTIONS.reduce((s, p) => s + p.width, 0)).toBeCloseTo(1, 12);
    const last = COVER_PANEL_FRACTIONS[COVER_PANEL_FRACTIONS.length - 1];
    expect(last.start + last.width).toBeCloseTo(1, 12);
  });

  it('keeps the spine fraction at 13 mm for every supported page count', () => {
    const spine = COVER_PANEL_FRACTIONS.find((p) => p.name === 'spine')!;
    for (const pages of [24, 36, 48]) {
      expect(spinePrintWidthMm(pages)).toBe(13);
      expect(spine.width * 453).toBeCloseTo(13, 9);
    }
  });

  it('describes the FINISHED spread, so the wrap is outside it by construction', () => {
    // Fractions are of the 453 mm finished spread, not the 483 mm artwork — the builder never
    // draws the wrap, so a fraction of the artwork would put every fold in the wrong place.
    expect(COVER_SPREAD_BOX.w).toBe(453);
    expect(COVER_ARTWORK.w - COVER_SPREAD_BOX.w).toBe(30);
    for (const f of COVER_FOLD_FRACTIONS) {
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThan(1);
    }
  });
});
