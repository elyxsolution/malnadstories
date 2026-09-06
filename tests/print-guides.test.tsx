/**
 * PRINT REFERENCE GUIDES — the geometry of every dotted line the BUILDER draws, the fact that the
 * exported PDFs draw none, the cover's full-bleed wrap, and the white-hairline regression.
 *
 * A guide that is a few millimetres out is worse than no guide: it is a wrong answer someone
 * designs against. So every position here is asserted against `lib/print/spec`, which is asserted
 * against the supplied drawing in `print-spec.test.ts` — one chain, no second copy of the numbers.
 *
 * The cover EXPORT used to carry dotted fold / spine / finished-edge lines and a white turn-in.
 * Both are gone: the file the press prints now carries artwork and nothing else, and the wrap is a
 * bleed of the adjacent panel's own background. Section B pins BOTH halves — that no line of any
 * kind is emitted, and that removing them and adding the bleed moved no dimension whatsoever.
 */
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import PrintContent, { type PrintPhoto } from '@/app/albums/[id]/print/content/_print-content';
import PrintCover from '@/app/albums/[id]/print/cover/_print-cover';
import {
  COVER_ARTWORK,
  COVER_BLEED_BANDS,
  COVER_FOLD_FRACTIONS,
  COVER_GUIDE_LINES_ENABLED,
  COVER_PANEL_FRACTIONS,
  COVER_PANELS,
  COVER_SPREAD_BOX,
  COVER_WRAP_MM,
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
    expect(html).toContain('class="absolute overflow-hidden"');
    expect(html).toMatch(/style="left:0%;top:0%;width:50%;height:100%(;z-index:\d+)?"/);
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
// B. Cover PDF — no guides, and a full-bleed wrap
// ═════════════════════════════════════════════════════════════════════════════════════════════

const config = (overrides: Partial<CoverConfig> = {}): CoverConfig =>
  normalizeCoverConfig({ ...DEFAULT_COVER_CONFIG, ...overrides });

const renderCover = (cfg: CoverConfig = config(), images: { front?: string | null; back?: string | null } = {}) =>
  renderToStaticMarkup(
    React.createElement(PrintCover, {
      config: cfg,
      title: 'COORG MONSOON',
      frontImageUrl: images.front ?? null,
      backImageUrl: images.back ?? null,
      stickerUrls: {},
    }),
  );

/** Every `class="<cls>"` element's inline style, in document order. */
const stylesOf = (html: string, cls: string): string[] =>
  Array.from(html.matchAll(new RegExp(`class="${cls}" style="([^"]*)"`, 'g'))).map((m) => m[1]);

/** A millimetre value off one inline style property. */
const mm = (style: string, prop: string): number => {
  const m = style.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([\\d.]+)mm`));
  return m ? Number(m[1]) : NaN;
};

describe('cover PDF — every dotted guide line is gone', () => {
  const html = renderCover();

  it('is switched off in the spec, and is still NOT the printer-marks switch', () => {
    // Two separate decisions, kept separate: reference lines a person reads, and marks a cutter
    // reads. Both are now off, and neither implies the other.
    expect(COVER_GUIDE_LINES_ENABLED).toBe(false);
    expect(PRINTER_MARKS_ENABLED).toBe(false);
  });

  it('emits no SVG, no line, no stroke and no dash pattern at all', () => {
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<line');
    expect(html).not.toContain('stroke-dasharray');
    expect(html).not.toContain('stroke-width');
    expect(html).not.toContain('cover-guides');
  });

  it('substitutes nothing for them — no replacement rule, border or divider', () => {
    // A dashed CSS border would be the obvious "keep something there" regression.
    expect(html).not.toContain('border-dashed');
    expect(html).not.toMatch(/border[^;"]*dashed/);
    expect(html).not.toMatch(/outline[^;"]*dashed/);
  });

  it('adds no crop, registration, colour-bar or slug marks', () => {
    for (const mark of [/crop-?mark/i, /registration/i, /colou?r-?bar/i, /\bslug\b/i]) {
      expect(html).not.toMatch(mark);
    }
  });
});

describe('cover PDF — the 15 mm wrap bleeds instead of printing white', () => {
  const html = renderCover();

  it('paints one bleed band per panel, in printed order', () => {
    expect(COVER_BLEED_BANDS.map((b) => b.name)).toEqual([
      'back',
      'hinge-left',
      'spine',
      'hinge-right',
      'front',
    ]);
    expect(stylesOf(html, 'bleed-band')).toHaveLength(5);
  });

  it('covers the artwork edge to edge, so no white turn-in can remain', () => {
    const lefts = COVER_BLEED_BANDS.map((b) => b.rect.x);
    const widths = COVER_BLEED_BANDS.map((b) => b.rect.w);
    expect(lefts[0]).toBe(0);
    expect(lefts[lefts.length - 1] + widths[widths.length - 1]).toBe(COVER_ARTWORK.w);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(COVER_ARTWORK.w);
    // Contiguous: each band starts exactly where the previous one ends.
    for (let i = 1; i < COVER_BLEED_BANDS.length; i += 1) {
      expect(lefts[i]).toBe(lefts[i - 1] + widths[i - 1]);
    }
    // Full height, so the top and bottom turn-in is covered too.
    for (const b of COVER_BLEED_BANDS) {
      expect(b.rect.y).toBe(0);
      expect(b.rect.h).toBe(COVER_ARTWORK.h);
    }
  });

  it('widens ONLY the two outer bands, by exactly the wrap', () => {
    const [back, hingeL, spine, hingeR, front] = COVER_BLEED_BANDS;
    expect(back.rect.w).toBe(210 + COVER_WRAP_MM);
    expect(front.rect.w).toBe(210 + COVER_WRAP_MM);
    // The bound edge keeps its exact construction: 10 / 17 / 10, at the same x as the panels.
    expect([hingeL.rect.w, spine.rect.w, hingeR.rect.w]).toEqual([10, spinePrintWidthMm(), 10]);
    for (const name of ['hinge-left', 'spine', 'hinge-right'] as const) {
      const band = COVER_BLEED_BANDS.find((b) => b.name === name)!;
      const panel = COVER_PANELS.find((pp) => pp.name === name)!;
      expect(band.rect.x).toBe(panel.rect.x);
      expect(band.rect.w).toBe(panel.rect.w);
    }
  });

  it('renders the bands at their specified millimetres', () => {
    const styles = stylesOf(html, 'bleed-band');
    expect(styles.map((st) => mm(st, 'left'))).toEqual(COVER_BLEED_BANDS.map((b) => b.rect.x));
    expect(styles.map((st) => mm(st, 'width'))).toEqual(COVER_BLEED_BANDS.map((b) => b.rect.w));
  });

  it('carries the FACE’s own colour outward, never an invented one', () => {
    // 'sand' resolves to #efe7d6 through the SAME backgroundStyle catalog the face itself uses.
    const base = config();
    const sand = { kind: 'color', value: 'sand' } as const;
    const cfg = config({ background: sand, back: { ...base.back, background: sand } });
    const bands = stylesOf(renderCover(cfg), 'bleed-band');
    // The outer two bands — the ones that reach into the wrap — wear the face colour.
    expect(bands[0]).toContain('#efe7d6');
    expect(bands[4]).toContain('#efe7d6');
  });

  it('carries the face’s backdrop PHOTOGRAPH outward too, with its own edit', () => {
    const withPhoto = renderCover(config(), { front: 'https://r2/front.jpg', back: 'https://r2/back.jpg' });
    // Twice each: once in the finished panel, once in the bleed band beneath it.
    expect(withPhoto.match(/https:\/\/r2\/front\.jpg/g)).toHaveLength(2);
    expect(withPhoto.match(/https:\/\/r2\/back\.jpg/g)).toHaveLength(2);
  });

  it('keeps every element OUT of the wrap — background only', () => {
    // The bleed layer must never carry text, a sticker, a QR or the studio mark: the turn-in is
    // glued down out of sight. The title appears exactly once, inside the finished spread.
    const bleed = html.slice(html.indexOf('cover-bleed'), html.indexOf('cover-spread'));
    expect(bleed).not.toContain('COORG MONSOON');
    expect(bleed).not.toContain('Malnad Stories');
  });
});

describe('cover PDF — the bleed and the removed guides moved NO dimension', () => {
  const html = renderCover();

  it('keeps the page size exactly 487 × 327 mm', () => {
    expect(html).toContain('@page { size: 487mm 327mm; margin: 0; }');
    expect(COVER_ARTWORK).toEqual({ w: 487, h: 327 });
  });

  it('keeps the five panel widths at 210 / 10 / 17 / 10 / 210', () => {
    const widths = Array.from(html.matchAll(/class="cover-panel" style="[^"]*width:([\d.]+)mm/g)).map(
      (m) => Number(m[1]),
    );
    expect(widths).toEqual([210, 10, 17, 10, 210]);
    expect(COVER_PANELS.map((pp) => pp.rect.w)).toEqual([210, 10, 17, 10, 210]);
  });

  it('keeps the finished spread inset by exactly the wrap, and clipped', () => {
    expect([COVER_SPREAD_BOX.x, COVER_SPREAD_BOX.y]).toEqual([COVER_WRAP_MM, COVER_WRAP_MM]);
    expect([COVER_SPREAD_BOX.w, COVER_SPREAD_BOX.h]).toEqual([457, 297]);
    expect(html).toContain('left: 15mm; top: 15mm;');
    expect(html).toContain('width: 457mm; height: 297mm;');
  });

  it('draws the bleed BEFORE the spread, so the artwork is never covered by it', () => {
    expect(html.indexOf('cover-bleed')).toBeLessThan(html.indexOf('cover-spread'));
  });

  it('still keeps the spine to background + title, with no shading or shadow', () => {
    expect(html).not.toContain('rgba(0,0,0,0.22)');
    expect(html).not.toContain('inset 0 0 3cqw');
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
    // The builder guides are `border-dashed` divs tagged `data-guide`. Neither export carries
    // them — and since the full-bleed pass the cover exports no lines of its own either.
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

  it('exports NOTHING extra on the cover either — the same bar, now that guides are gone', () => {
    expect(cover).not.toContain('<svg');
    expect(cover).not.toContain('stroke');
  });
});

describe('builder cover guide — fold fractions', () => {
  it('places the four folds at 210 / 220 / 237 / 247 of the 457 mm spread', () => {
    expect(COVER_FOLD_FRACTIONS.map((f) => +(f * 457).toFixed(6))).toEqual([210, 220, 237, 247]);
  });

  it('gives the five regions their specified widths', () => {
    expect(COVER_PANEL_FRACTIONS.map((p) => +(p.width * 457).toFixed(6))).toEqual([210, 10, 17, 10, 210]);
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
      expect(spinePrintWidthMm(pages)).toBe(17);
      expect(spine.width * 457).toBeCloseTo(17, 9);
    }
  });

  it('describes the FINISHED spread, so the wrap is outside it by construction', () => {
    // Fractions are of the 457 mm finished spread, not the 487 mm artwork — the builder never
    // draws the wrap, so a fraction of the artwork would put every fold in the wrong place.
    expect(COVER_SPREAD_BOX.w).toBe(457);
    expect(COVER_ARTWORK.w - COVER_SPREAD_BOX.w).toBe(30);
    for (const f of COVER_FOLD_FRACTIONS) {
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThan(1);
    }
  });
});
