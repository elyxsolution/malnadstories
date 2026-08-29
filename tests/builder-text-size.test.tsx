/**
 * TEXT SIZE — one property, three affordances, and the overlay that carries no frame.
 *
 * `TextElement.size` is the only representation of how big text is: `textFontSize` derives every
 * surface's `font-size` from it, so anything that changes text size has to change THAT number.
 * This file pins the three ways it can change (the numeric field, the up/down steppers, a corner
 * drag) to the same authority, and pins the removal of the overlay's white frame.
 *
 * What it does NOT do is simulate pointer events — the suite runs in `node` with no DOM. The
 * gesture maths is therefore exercised as the pure functions the canvas calls, frame by frame, in
 * exactly the order `Movable` calls them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  TEXT_SIZE_STEP,
  boxForTextSize,
  clampTextSize,
  commitTextSize,
  fontScaleForResize,
  parseTextSize,
  resizedTextSize,
  stepTextSize,
} from '@/lib/builder/text-size';
import { makeText, textFontSize, textStyle } from '@/lib/builder/elements';
import { REF_PAIR_W, type Block, type Rect, type TextElement } from '@/lib/builder/model';
import { SaveLayoutSchema } from '@/lib/validations';
import PairContent from '@/app/(app)/albums/[id]/build/_pair-frame';
import FontSizeField from '@/app/(app)/albums/[id]/build/_font-size-field';
import { TextContent } from '@/app/(app)/albums/[id]/build/_elements-render';

const text = (over: Partial<TextElement> = {}): TextElement => makeText('heading', { id: 't1', ...over });

// ===============================================================================================
// A. Manual input
// ===============================================================================================

describe('typing a size', () => {
  /**
   * THE ROOT CAUSE. The old control clamped on every keystroke against a 10 minimum, so reaching
   * 180 meant passing through "1" — which was rewritten to "10" under the caret, and the next
   * keystroke appended to that. Parsing must not clamp; only committing may.
   */
  it('does not clamp a partially-typed number', () => {
    expect(parseTextSize('1')).toBe(1);
    expect(parseTextSize('18')).toBe(18);
    expect(parseTextSize('180')).toBe(180);
  });

  it('reports "nothing was typed" rather than inventing a size', () => {
    expect(parseTextSize('')).toBeNull();
    expect(parseTextSize('   ')).toBeNull();
    expect(parseTextSize('-')).toBeNull();
    expect(parseTextSize('24px')).toBeNull();
    expect(parseTextSize('abc')).toBeNull();
  });

  it('accepts every value the brief names, exactly', () => {
    for (const v of [24, 72, 180, 300]) expect(commitTextSize(String(v), 32)).toBe(v);
  });

  it('leaves the element alone when the edit said nothing — it never resets to a default', () => {
    expect(commitTextSize('', 87)).toBe(87);
    expect(commitTextSize('nonsense', 87)).toBe(87);
  });

  it('clamps only at the bounds, and echoes what it accepted', () => {
    expect(commitTextSize('999999', 32)).toBe(MAX_TEXT_SIZE);
    expect(commitTextSize('0', 32)).toBe(MIN_TEXT_SIZE);
    expect(commitTextSize('-40', 32)).toBe(MIN_TEXT_SIZE);
    expect(clampTextSize(Number.NaN)).toBe(MIN_TEXT_SIZE);
    expect(clampTextSize(Number.POSITIVE_INFINITY)).toBe(MIN_TEXT_SIZE);
  });

  it('stores integers, so the field can never display a value the model does not hold', () => {
    expect(commitTextSize('74.6', 32)).toBe(75);
    expect(Number.isInteger(commitTextSize('80.2', 32))).toBe(true);
  });
});

describe('the 160 maximum is gone from every layer that had one', () => {
  it('the shared bound is far above the old ceiling', () => {
    expect(MAX_TEXT_SIZE).toBeGreaterThan(160);
    // A page is REF_PAIR_W units wide by definition, so a full-page word must be expressible.
    expect(MAX_TEXT_SIZE).toBeGreaterThanOrEqual(REF_PAIR_W);
  });

  it('the SAVE SCHEMA accepts what the editor accepts — no silent refusal on save', () => {
    const layout = (size: number) => ({
      albumId: '00000000-0000-4000-8000-000000000001',
      blocks: [
        {
          template: 'single-pair' as const,
          photoIds: [],
          caption: '',
          overlays: [],
          texts: [text({ size })],
          qrs: [],
          stickers: [],
          background: null,
        },
      ],
    });
    // The values the brief asks for — every one of them was above the old UI maximum of 160.
    for (const size of [180, 300, 1000, MAX_TEXT_SIZE]) {
      expect(SaveLayoutSchema.safeParse(layout(size)).success).toBe(true);
    }
    // …and the bound is still a bound.
    expect(SaveLayoutSchema.safeParse(layout(MAX_TEXT_SIZE + 1)).success).toBe(false);
    expect(SaveLayoutSchema.safeParse(layout(MIN_TEXT_SIZE - 1)).success).toBe(false);
  });
});

// ===============================================================================================
// B. The up / down steppers
// ===============================================================================================

describe('the up and down controls', () => {
  it('step by 1px from the current size', () => {
    expect(TEXT_SIZE_STEP).toBe(1);
    expect(stepTextSize(80, 1)).toBe(81);
    expect(stepTextSize(81, -1)).toBe(80);
  });

  it('are reversible — up then down returns to the same number', () => {
    let v = 32;
    for (let i = 0; i < 40; i++) v = stepTextSize(v, 1);
    for (let i = 0; i < 40; i++) v = stepTextSize(v, -1);
    expect(v).toBe(32);
  });

  it('cannot step outside the bounds', () => {
    expect(stepTextSize(MIN_TEXT_SIZE, -1)).toBe(MIN_TEXT_SIZE);
    expect(stepTextSize(MAX_TEXT_SIZE, 1)).toBe(MAX_TEXT_SIZE);
  });

  it('keep working well past the old 160 ceiling', () => {
    expect(stepTextSize(160, 1)).toBe(161);
    expect(stepTextSize(299, 1)).toBe(300);
  });
});

describe('the rendered control', () => {
  const html = renderToStaticMarkup(React.createElement(FontSizeField, { value: 180, onChange: () => {} }));

  it('displays the model value', () => {
    expect(html).toContain('value="180"');
  });

  it('offers exactly one increase and one decrease button, both labelled', () => {
    expect((html.match(/aria-label="Increase font size"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-label="Decrease font size"/g) ?? []).length).toBe(1);
  });

  it('advertises the real range to assistive technology', () => {
    expect(html).toContain(`aria-valuemax="${MAX_TEXT_SIZE}"`);
    expect(html).toContain(`aria-valuemin="${MIN_TEXT_SIZE}"`);
    expect(html).not.toContain('max="160"');
  });

  it('is not a native number input — the parsing is ours, not the browser default', () => {
    expect(html).toContain('type="text"');
    expect(html).toContain('inputMode="numeric"');
  });
});

// ===============================================================================================
// C. Drag-resize -> font size
// ===============================================================================================

const CORNER = { ex: 1, ey: 1 } as const;
const SIDE_X = { ex: 1, ey: 0 } as const;
const SIDE_Y = { ex: 0, ey: -1 } as const;
const start: Rect = { x: 0.2, y: 0.2, w: 0.4, h: 0.2 };

describe('resizing text with a corner handle', () => {
  it('larger increases the font size', () => {
    const next = { ...start, w: 0.8, h: 0.4 }; // 2x on both axes
    expect(resizedTextSize(80, start, next, CORNER)).toBe(160);
  });

  it('smaller decreases the font size', () => {
    const next = { ...start, w: 0.2, h: 0.1 }; // half on both axes
    expect(resizedTextSize(80, start, next, CORNER)).toBe(40);
  });

  it('responds to a drag that moved mainly on one axis', () => {
    const next = { ...start, w: 0.8, h: 0.2 }; // 2x wide, unchanged tall
    const s = fontScaleForResize(start, next, CORNER)!;
    expect(s).toBeCloseTo(Math.SQRT2, 10);
    expect(resizedTextSize(80, start, next, CORNER)).toBe(113);
  });
});

describe('resizing text with a SIDE handle reflows instead of scaling', () => {
  it('changes no font size, so the words can still be re-wrapped', () => {
    expect(fontScaleForResize(start, { ...start, w: 0.9 }, SIDE_X)).toBeNull();
    expect(fontScaleForResize(start, { ...start, h: 0.5 }, SIDE_Y)).toBeNull();
    expect(resizedTextSize(80, start, { ...start, w: 0.9 }, SIDE_X)).toBeNull();
  });
});

describe('repeated resizes stay stable', () => {
  /**
   * THE CUMULATIVE-SCALING TRAP. A drag emits many pointer-moves, and each one already sees the
   * size the previous one wrote. Scaling the LIVE size per frame compounds (a steady 2x drag
   * would land far past 2x); scaling the START size does not. Same gesture, 200 frames.
   */
  it('a single drag lands on the same size however many frames it took', () => {
    const startSize = 80;
    let last = startSize;
    for (let i = 1; i <= 200; i++) {
      const k = 1 + i / 200; // 1 -> 2
      last = resizedTextSize(startSize, start, { ...start, w: start.w * k, h: start.h * k }, CORNER)!;
    }
    expect(last).toBe(160);
  });

  it('is reversible inside one gesture, even after touching a bound', () => {
    const startSize = 80;
    // Push far past the maximum...
    const blown = { ...start, w: start.w * 60, h: start.h * 60 };
    expect(resizedTextSize(startSize, start, blown, CORNER)).toBe(MAX_TEXT_SIZE);
    // ...then come back to where the drag began: the ORIGINAL size, not a fraction of the clamp.
    expect(resizedTextSize(startSize, start, start, CORNER)).toBe(startSize);
  });

  it('four separate 1.5x drags multiply, they do not decay', () => {
    // Each gesture begins from the size the last one committed — the real sequence.
    let size = 32;
    for (let i = 0; i < 4; i++) {
      const to: Rect = { ...start, w: start.w * 1.5, h: start.h * 1.5 };
      size = resizedTextSize(size, start, to, CORNER)!;
    }
    expect(size).toBe(162); // 32 -> 48 -> 72 -> 108 -> 162
  });

  it('refuses a degenerate gesture rather than producing Infinity', () => {
    expect(fontScaleForResize({ x: 0, y: 0, w: 0, h: 0.2 }, start, CORNER)).toBeNull();
    expect(resizedTextSize(80, { x: 0, y: 0, w: 0.4, h: 0 }, start, CORNER)).toBeNull();
  });
});

// ===============================================================================================
// D. The bounding box follows the size
// ===============================================================================================

describe('the bounding box is recalculated when the size changes', () => {
  const el = text({ x: 0.25, y: 0.4, w: 0.4, h: 0.2, size: 40 });

  it('grows with the type, so bigger text is not clipped by a stale box', () => {
    const box = boxForTextSize(el, 80);
    expect(box.w).toBeCloseTo(0.8, 10);
    expect(box.h).toBeCloseTo(0.4, 10);
  });

  it('keeps the element centred where it was, so text does not walk across the page', () => {
    const box = boxForTextSize(el, 80);
    expect(box.x + box.w / 2).toBeCloseTo(el.x + el.w / 2, 10);
    expect(box.y + box.h / 2).toBeCloseTo(el.y + el.h / 2, 10);
  });

  it('shrinks with the type too', () => {
    const box = boxForTextSize(el, 20);
    expect(box.w).toBeCloseTo(0.2, 10);
    expect(box.h).toBeCloseTo(0.1, 10);
  });

  it('never leaves the persisted contract, however large the size', () => {
    const box = boxForTextSize(el, MAX_TEXT_SIZE);
    expect(box.w).toBeLessThanOrEqual(1);
    expect(box.h).toBeLessThanOrEqual(1);
    expect(box.w).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(-0.5);
    expect(box.y).toBeGreaterThanOrEqual(-0.5);
  });

  it('a resize does NOT re-derive the box — the pointer already decided it', () => {
    const next = { ...start, w: 0.8, h: 0.4 };
    const size = resizedTextSize(80, start, next, CORNER)!;
    const patch = { ...next, size };
    expect(patch.w).toBe(0.8);
    expect(patch.h).toBe(0.4);
  });
});

// ===============================================================================================
// E. The size actually reaches the rendered font-size
// ===============================================================================================

describe('the model value is what renders', () => {
  it('font-size is derived from size, at every value including ones the old UI refused', () => {
    for (const size of [24, 32, 75, 80, 81, 180, 300]) {
      expect(textFontSize(text({ size }))).toBe(`${(size / REF_PAIR_W) * 100}cqw`);
      expect(textStyle(text({ size })).fontSize).toBe(`${(size / REF_PAIR_W) * 100}cqw`);
    }
  });

  it('a spine object measures against the container HEIGHT, still from the same number', () => {
    expect(textFontSize(text({ size: 300, role: 'spine' }))).toBe('30cqh');
  });

  it('the rendered element carries that font-size and no transform: scale', () => {
    const html = renderToStaticMarkup(React.createElement(TextContent, { el: text({ size: 300 }) }));
    expect(html).toContain('font-size:30cqw');
    expect(html).not.toContain('scale(');
  });

  it('320px of type is 4x the markup of 80px — the ratio is real, not visual', () => {
    const at = (size: number) => Number(/([\d.]+)cqw/.exec(textFontSize(text({ size })))?.[1]);
    expect(at(320) / at(80)).toBeCloseTo(4, 10);
  });
});

// ===============================================================================================
// F. The overlay carries no frame
// ===============================================================================================

describe('an overlay renders as a plain image', () => {
  const block: Block = {
    key: '0',
    template: 'single-pair',
    photoIds: [],
    caption: '',
    overlays: [{ id: 'o1', photoId: 'p1', x: 0.1, y: 0.1, w: 0.4, h: 0.5 }] as Block['overlays'],
    texts: [],
    qrs: [],
    stickers: [],
    background: null,
  };
  const photoFor = (id: string | null | undefined) =>
    id === 'p1' ? { id: 'p1', url: 'https://r2.test/p1.jpg', edit: null, status: 'ready' as const } : undefined;

  const html = renderToStaticMarkup(React.createElement(PairContent, { block, photoFor }));

  it('has no white border', () => {
    expect(html).not.toContain('border-white');
    expect(html).not.toContain('border-2');
  });

  it('has no outline, shadow or border radius', () => {
    expect(html).not.toMatch(/class="[^"]*shadow[ "-]/);
    expect(html).not.toMatch(/class="[^"]*rounded/);
    expect(html).not.toMatch(/class="[^"]*outline/);
  });

  it('is exactly a positioned, clipped box — nothing else', () => {
    expect(html).toContain('class="absolute overflow-hidden" style="left:10%;top:10%;width:40%;height:50%"');
  });

  it('lets the photo reach every edge of that box', () => {
    expect(html).toContain('class="absolute inset-0 h-full w-full select-none object-cover"');
  });
});

describe('the editing canvas draws the same plain overlay', () => {
  /**
   * `_block` is the interactive canvas: it needs a live builder api, drag store and refs, so it is
   * not renderable here. Its overlay container is one hardcoded class string, and the defect was
   * that string disagreeing with `_pair-frame` — which is precisely what a source assertion can
   * hold. Selection chrome is NOT affected: `Movable` portals it into a separate chrome layer.
   */
  const src = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_block.tsx'), 'utf8');

  it('carries no white border or shadow on the overlay container', () => {
    expect(src).not.toContain('border-2 border-white');
    expect(src).not.toContain('shadow-md');
  });

  it('still clips the overlay', () => {
    expect(src).toContain('className="overflow-hidden"');
  });

  it('still renders selection handles through Movable', () => {
    expect(src).toContain('chromeContainer={chromeEl}');
  });
});
