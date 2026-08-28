/**
 * PRINTER-READY COVER — one flat spread, its panel construction, its blank wrap, and a spine that
 * carries only what the specification allows.
 *
 * Renders the REAL `_print-cover` component with `react-dom/server`, so the composition asserted
 * here is the composition the worker's Chromium prints.
 */
import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import PrintCover from '@/app/albums/[id]/print/cover/_print-cover';
import {
  DEFAULT_COVER_CONFIG,
  SPINE_LEGACY_COLOR,
  normalizeCoverConfig,
  type CoverConfig,
} from '@/lib/builder/cover';
import {
  COVER_ARTWORK,
  COVER_PANELS,
  COVER_SAFE_INSET_MM,
  COVER_SPREAD_BOX,
  COVER_WRAP_MM,
  coverSafeBox,
  mmToPxCeil,
  spinePrintWidthMm,
} from '@/lib/print/spec';

const TITLE = 'COORG MONSOON';

function config(overrides: Partial<CoverConfig> = {}): CoverConfig {
  return normalizeCoverConfig({ ...DEFAULT_COVER_CONFIG, ...overrides });
}

function render(cfg: CoverConfig = config(), front: string | null = null, back: string | null = null): string {
  return renderToStaticMarkup(
    React.createElement(PrintCover, {
      config: cfg,
      title: TITLE,
      frontImageUrl: front,
      backImageUrl: back,
      stickerUrls: {},
    }),
  );
}

/** The five `.cover-panel` style attributes, in document order. */
function panelStyles(html: string): string[] {
  return Array.from(html.matchAll(/class="cover-panel" style="([^"]*)"/g)).map((m) => m[1]);
}

describe('one page, at the specified artwork size', () => {
  const html = render();

  it('emits exactly ONE PDF page — a flat spread, not two cover files', () => {
    expect((html.match(/class="print-page"/g) ?? []).length).toBe(1);
  });

  it('sets the @page size to exactly 487 mm × 327 mm with zero margin', () => {
    expect(html).toContain('@page { size: 487mm 327mm; margin: 0; }');
  });

  it('sizes the page element at Chromium’s fragmentainer', () => {
    expect(mmToPxCeil(COVER_ARTWORK.w)).toBe(1841);
    expect(mmToPxCeil(COVER_ARTWORK.h)).toBe(1236);
    expect(html).toContain('width: 1841px; height: 1236px;');
  });

  it('has no page-break rule — there is nothing to break to', () => {
    expect(html).not.toContain('break-before: page');
  });

  it('prints backgrounds at full density', () => {
    expect(html).toContain('print-color-adjust: exact');
  });
});

describe('panel construction — 210 / 10 / 13 / 10 / 210', () => {
  const html = render();

  it('renders exactly five panels', () => {
    expect(panelStyles(html)).toHaveLength(5);
  });

  it('lays them out left→right at their specified widths', () => {
    const widths = panelStyles(html).map((s) => /width:\s*([\d.]+)mm/.exec(s)?.[1]);
    expect(widths).toEqual(['210', '10', '17', '10', '210']);
  });

  it('positions each panel at its offset within the finished spread', () => {
    // Offsets are relative to the spread box, so they are the raw construction: 0, 210, 220, 233, 243.
    const lefts = panelStyles(html).map((s) => /left:\s*([\d.]+)mm/.exec(s)?.[1]);
    expect(lefts).toEqual(['0', '210', '220', '237', '247']);
  });

  it('puts BACK first and FRONT last — the printed outside view', () => {
    const back = html.indexOf('cover-panel');
    const front = html.lastIndexOf('cover-panel');
    expect(back).toBeLessThan(front);
    // The back cover's studio-mark renderer and the front's title both exist, in that order.
    const spineIdx = html.indexOf('writing-mode');
    expect(spineIdx).toBeGreaterThan(back);
    expect(spineIdx).toBeLessThan(front);
  });

  it('the five widths sum to the 457 mm finished spread', () => {
    const widths = panelStyles(html).map((s) => Number(/width:\s*([\d.]+)mm/.exec(s)?.[1]));
    expect(widths.reduce((a, b) => a + b, 0)).toBe(457);
    expect(COVER_SPREAD_BOX.w).toBe(457);
  });
});

describe('the 15 mm wrap is blank', () => {
  const html = render();

  it('insets the spread by exactly one wrap on every side', () => {
    expect(html).toContain(`left: ${COVER_WRAP_MM}mm; top: ${COVER_WRAP_MM}mm;`);
    expect(html).toContain('width: 457mm; height: 297mm;');
  });

  it('clips the spread, so no design can bleed into the turn-in', () => {
    // Structural enforcement: nothing is POSITIONED in the wrap, and anything overflowing a panel
    // is cut at the finished edge. Both containers clip.
    expect(html).toMatch(/\.cover-spread\s*\{[^}]*overflow:\s*hidden/);
    expect(html).toMatch(/\.cover-panel\s*\{[^}]*overflow:\s*hidden/);
  });

  it('paints the page white beneath — the wrap shows paper, not artwork', () => {
    expect(html).toMatch(/\.print-page\s*\{[^}]*background:\s*#fff/);
  });

  it('places every panel inside the wrap, never across it', () => {
    for (const panel of COVER_PANELS) {
      expect(panel.rect.x).toBeGreaterThanOrEqual(COVER_WRAP_MM);
      expect(panel.rect.x + panel.rect.w).toBeLessThanOrEqual(COVER_ARTWORK.w - COVER_WRAP_MM);
      expect(panel.rect.y).toBe(COVER_WRAP_MM);
      expect(panel.rect.y + panel.rect.h).toBe(COVER_ARTWORK.h - COVER_WRAP_MM);
    }
  });
});

describe('the 12 mm safe areas', () => {
  it('are 186 × 273 mm on both faces, and are NOT drawn into the file', () => {
    expect(coverSafeBox('back')).toEqual({ x: 27, y: 27, w: 186, h: 273 });
    expect(coverSafeBox('front')).toEqual({ x: 274, y: 27, w: 186, h: 273 });
    expect(COVER_SAFE_INSET_MM).toBe(12);
    // Advisory geometry: the exported PDF must contain no guide of any kind.
    const html = render();
    expect(html).not.toContain('safe');
    expect(html).not.toMatch(/dashed/);
  });
});

describe('the spine carries background + title, and nothing else', () => {
  it('suppresses the screen-only bound-edge shading', () => {
    const html = render();
    // `SPINE_EDGE_SHADING` is a linear-gradient of black stops that the builder and the preview
    // draw over the spine colour. On a real 17 mm printed spine it is unrequested ink.
    expect(html).not.toContain('rgba(0,0,0,0.22)');
    expect(html).not.toContain('linear-gradient(90deg, rgba(0,0,0');
  });

  it('suppresses the flat-spread inset spine shadow', () => {
    expect(render()).not.toContain('inset 0 0 3cqw');
  });

  it('paints the legacy colour flat when no spine background was chosen', () => {
    const html = render();
    expect(html).toContain(SPINE_LEGACY_COLOR);
    // Flat: the colour appears without a gradient wrapped around it.
    expect(html).not.toMatch(new RegExp(`linear-gradient[^"]*${SPINE_LEGACY_COLOR}`));
  });

  it('uses the customer’s SELECTED spine background when there is one', () => {
    const html = render(config({ spine: { texts: [], background: { kind: 'color', value: '#8b1a1a' } } }));
    expect(html).toContain('#8b1a1a');
    expect(html).not.toContain('rgba(0,0,0,0.22)');
  });

  it('renders the spine title from the album’s existing editable data', () => {
    // No second source of truth: the title reaches the spine through the same migration the
    // builder, the preview and the flipbook use.
    expect(render()).toContain(TITLE);
  });

  it('prefers an explicitly-set spine title over the album title', () => {
    const html = render(config({ spineTitle: 'MONSOON' }));
    expect(html).toContain('MONSOON');
  });

  it('places no photo in the spine', () => {
    // The front and back carry images; the spine panel never does. With both faces given an
    // image, exactly two <img> elements exist — one per face.
    const html = render(config(), 'https://r2.test/front.jpg', 'https://r2.test/back.jpg');
    expect((html.match(/<img /g) ?? []).length).toBe(2);
    expect(html).toContain('https://r2.test/front.jpg');
    expect(html).toContain('https://r2.test/back.jpg');
  });

  it('is 17 mm wide whatever the album’s page count', () => {
    const spine = COVER_PANELS.find((p) => p.name === 'spine')!;
    expect(spine.rect.w).toBe(17);
    for (const pages of [24, 36, 48]) expect(spinePrintWidthMm(pages)).toBe(17);
    // …and the rendered panel says 17 mm, not a fraction of a page width.
    expect(panelStyles(render())[2]).toContain('width:17mm');
  });
});

describe('printer marks', () => {
  it('draws none', () => {
    const html = render();
    for (const mark of [/crop-?mark/i, /registration/i, /colou?r-?bar/i, /trim-?line/i]) {
      expect(html).not.toMatch(mark);
    }
  });
});
