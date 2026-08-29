/**
 * TEXT AUTO-FIT — the box follows the ink, and cannot chase itself.
 *
 * The measurement itself is a DOM operation (`_text-autofit.tsx` renders an off-screen mirror in
 * the live container and reads its size), and this suite runs in `node` with no layout engine. So
 * what is tested here is everything the measurement is NOT: what a measured size MEANS as a
 * normalized box, which edge is held still so the words do not walk, when a fit is worth writing —
 * and, most importantly, the structural property that makes the whole thing safe: the set of
 * things that TRIGGER a fit and the set of things a fit WRITES do not intersect.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AUTOFIT_EPSILON,
  MIN_TEXT_BOX,
  canAutoFitText,
  fitTextBox,
  isMeaningfulFit,
  textFitSignature,
} from '@/lib/builder/text-fit';
import { makeText, textFontPx, textFontSize } from '@/lib/builder/elements';
import { REF_PAIR_W, type TextElement } from '@/lib/builder/model';
import { textSizePatch } from '@/lib/builder/text-size';

const text = (over: Partial<TextElement> = {}): TextElement => makeText('heading', { id: 't1', ...over });

/** A page-sized surface: the open pair at its reference width, 3:2. */
const PAIR = { w: 1000, h: 667 };

// ===============================================================================================
// A. The measured pixels become the box
// ===============================================================================================

describe('the fitted box is the measured text', () => {
  it('shrinks a box that is far larger than its words', () => {
    // The defect: a heading starts 50% × 14% of the pair whatever it says.
    const el = text({ x: 0.25, y: 0.1, w: 0.5, h: 0.14, align: 'center' });
    expect(el.w).toBe(0.5);

    // "Hello World" at this size measures ~220 × 60 px on a 1000 × 667 pair.
    const box = fitTextBox(el, { w: 220, h: 60 }, PAIR);
    expect(box.w).toBeCloseTo(0.22, 10);
    expect(box.h).toBeCloseTo(60 / 667, 10);
    expect(box.w).toBeLessThan(el.w);
    expect(box.h).toBeLessThan(el.h);
  });

  it('grows a box that is smaller than its words', () => {
    const el = text({ x: 0.2, y: 0.2, w: 0.1, h: 0.05 });
    const box = fitTextBox(el, { w: 400, h: 90 }, PAIR);
    expect(box.w).toBeCloseTo(0.4, 10);
    expect(box.h).toBeGreaterThan(el.h);
  });

  it('is exact — the box is the ink, not the ink plus padding', () => {
    const el = text({ w: 0.5, h: 0.2 });
    const box = fitTextBox(el, { w: 333, h: 111 }, PAIR);
    expect(box.w * PAIR.w).toBeCloseTo(333, 6);
    expect(box.h * PAIR.h).toBeCloseTo(111, 6);
  });

  it('accounts for MULTIPLE LINES through the measured height alone', () => {
    // Two lines of the same type measure twice the height and no more width — the fitted box has
    // to follow both, which it does because it carries no assumption about line count at all.
    const el = text({ w: 0.5, h: 0.14 });
    const one = fitTextBox(el, { w: 200, h: 60 }, PAIR);
    const two = fitTextBox(el, { w: 200, h: 120 }, PAIR);
    expect(two.h).toBeCloseTo(one.h * 2, 10);
    expect(two.w).toBeCloseTo(one.w, 10);
  });

  it('never produces a box outside the persisted contract', () => {
    const el = text({ x: 0.9, y: 0.9, w: 0.1, h: 0.05 });
    const huge = fitTextBox(el, { w: 99999, h: 99999 }, PAIR);
    expect(huge.w).toBeLessThanOrEqual(1);
    expect(huge.h).toBeLessThanOrEqual(1);
    const tiny = fitTextBox(el, { w: 0.0001, h: 0.0001 }, PAIR);
    expect(tiny.w).toBeGreaterThan(0);
    expect(tiny.h).toBeGreaterThan(0);
  });

  it('refuses to divide by a container that has not been laid out yet', () => {
    const el = text();
    expect(fitTextBox(el, { w: 100, h: 20 }, { w: 0, h: 0 })).toEqual({ x: el.x, y: el.y, w: el.w, h: el.h });
  });
});

// ===============================================================================================
// B. The anchor — text must not walk across the page
// ===============================================================================================

describe('the fit holds still whatever the renderer holds still', () => {
  it('keeps the vertical CENTRE, because the words are centred in the box', () => {
    const el = text({ x: 0.2, y: 0.3, w: 0.5, h: 0.3 });
    const box = fitTextBox(el, { w: 250, h: 60 }, PAIR);
    expect(box.y + box.h / 2).toBeCloseTo(el.y + el.h / 2, 10);
  });

  it('keeps the LEFT edge for left-aligned text', () => {
    const el = text({ x: 0.2, y: 0.3, w: 0.6, h: 0.2, align: 'left' });
    const box = fitTextBox(el, { w: 200, h: 50 }, PAIR);
    expect(box.x).toBeCloseTo(el.x, 10);
  });

  it('keeps the RIGHT edge for right-aligned text', () => {
    const el = text({ x: 0.2, y: 0.3, w: 0.6, h: 0.2, align: 'right' });
    const box = fitTextBox(el, { w: 200, h: 50 }, PAIR);
    expect(box.x + box.w).toBeCloseTo(el.x + el.w, 10);
  });

  it('keeps the horizontal CENTRE for centred text', () => {
    const el = text({ x: 0.2, y: 0.3, w: 0.6, h: 0.2, align: 'center' });
    const box = fitTextBox(el, { w: 200, h: 50 }, PAIR);
    expect(box.x + box.w / 2).toBeCloseTo(el.x + el.w / 2, 10);
  });

  it('does not move a box that was already exactly right', () => {
    const el = text({ x: 0.2, y: 0.3, w: 0.25, h: 0.09, align: 'center' });
    const box = fitTextBox(el, { w: 0.25 * PAIR.w, h: 0.09 * PAIR.h }, PAIR);
    expect(box.x).toBeCloseTo(el.x, 10);
    expect(box.y).toBeCloseTo(el.y, 10);
    expect(isMeaningfulFit(el, box)).toBe(false);
  });
});

// ===============================================================================================
// C. No feedback loop
// ===============================================================================================

describe('a fit cannot cause a fit', () => {
  /**
   * THE STRUCTURAL GUARANTEE. The effect re-runs when the signature changes; a fit writes x/y/w/h.
   * If geometry were in the signature the two would close a loop, and the classic
   * "measure → resize → observe → measure" oscillation would be back.
   */
  it('the signature ignores geometry entirely', () => {
    const el = text({ x: 0.1, y: 0.1, w: 0.5, h: 0.2 });
    const moved = { ...el, x: 0.7, y: 0.6, w: 0.2, h: 0.05 };
    expect(textFitSignature(moved)).toBe(textFitSignature(el));
  });

  it('the signature changes for every input that changes the ink', () => {
    const el = text({ text: 'Hello', size: 40 });
    const base = textFitSignature(el);
    expect(textFitSignature({ ...el, text: 'Hello World' })).not.toBe(base);
    expect(textFitSignature({ ...el, size: 41 })).not.toBe(base);
    expect(textFitSignature({ ...el, font: 'playfair' })).not.toBe(base);
    expect(textFitSignature({ ...el, weight: 700 })).not.toBe(base);
    expect(textFitSignature({ ...el, italic: true })).not.toBe(base);
    expect(textFitSignature({ ...el, letterSpacing: 0.1 })).not.toBe(base);
    expect(textFitSignature({ ...el, lineHeight: 2 })).not.toBe(base);
    // Alignment does not change the ink's SIZE, but it decides which edge the fit holds.
    expect(textFitSignature({ ...el, align: 'left' })).not.toBe(base);
  });

  it('re-fitting unchanged text is a no-op, so a steady state exists', () => {
    const el = text({ x: 0.3, y: 0.3, w: 0.5, h: 0.2 });
    const once = fitTextBox(el, { w: 240, h: 70 }, PAIR);
    const twice = fitTextBox({ ...el, ...once }, { w: 240, h: 70 }, PAIR);
    expect(twice).toEqual(once);
    expect(isMeaningfulFit({ ...el, ...once }, twice)).toBe(false);
  });

  it('ignores sub-pixel jitter rather than writing on every render', () => {
    const el = text({ x: 0.3, y: 0.3, w: 0.5, h: 0.2 });
    const nudge = { ...el, w: el.w + AUTOFIT_EPSILON / 2, h: el.h + AUTOFIT_EPSILON / 2 };
    expect(isMeaningfulFit(el, nudge)).toBe(false);
    const real = { ...el, w: el.w + AUTOFIT_EPSILON * 4 };
    expect(isMeaningfulFit(el, real)).toBe(true);
  });

  it('leaves a SPINE object alone — its box is structural and its text runs vertically', () => {
    expect(canAutoFitText({ role: 'spine', text: 'COORG' })).toBe(false);
    expect(canAutoFitText({ role: 'title', text: 'COORG' })).toBe(true);
    expect(canAutoFitText({ role: undefined, text: 'COORG' })).toBe(true);
  });

  it('leaves EMPTY text alone, so a cleared object stays grabbable', () => {
    expect(canAutoFitText({ role: undefined, text: '' })).toBe(false);
    expect(canAutoFitText({ role: undefined, text: '   ' })).toBe(false);
  });

  it('cannot fit a box below the resize minimum the canvas hands Movable', () => {
    // A larger resize minimum would make the first pixel of a corner drag jump a tight box out
    // to it. The two numbers are the same constant.
    const el = text({ w: 0.5, h: 0.2 });
    const sliver = fitTextBox(el, { w: 0.1, h: 0.1 }, PAIR);
    expect(sliver.w).toBeGreaterThanOrEqual(MIN_TEXT_BOX);
    expect(sliver.h).toBeGreaterThanOrEqual(MIN_TEXT_BOX);
  });
});

describe('the measuring component states the rule it relies on', () => {
  const src = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_text-autofit.tsx'), 'utf8');

  it('constructs no ResizeObserver — the loop is prevented structurally, not throttled', () => {
    expect(src).not.toContain('new ResizeObserver');
  });

  it('keys its effect on the typography signature, never on the element', () => {
    expect(src).toContain('[sig, enabled]');
  });

  it('measures against the LAYOUT size, which is what container queries resolve against', () => {
    expect(src).toContain('container.offsetWidth');
    expect(src).toContain('container.offsetHeight');
  });

  it('mounts the mirror INSIDE the container, where the builder font variables resolve', () => {
    expect(src).toContain('container.appendChild(mirror)');
    expect(src).toContain('container.removeChild(mirror)');
    expect(src).not.toContain('document.body.appendChild');
  });
});

// ===============================================================================================
// D. Size changes and the box move together
// ===============================================================================================

describe('the box tracks the font size, whichever affordance changed it', () => {
  /**
   * `textSizePatch` is the PROPORTIONAL estimate every non-drag affordance writes (the field and
   * the steppers both go through it). Auto-fit then corrects it to the measured ink. The estimate
   * matters for more than the frame before the correction: it is measured AT the estimated width,
   * which is what preserves the line breaks through a size change.
   */
  it('a bigger size means a bigger estimated box, before anything is measured', () => {
    const el = text({ x: 0.2, y: 0.2, w: 0.4, h: 0.1, size: 40 });
    const bigger = textSizePatch(el, 80);
    expect(bigger.size).toBe(80);
    expect(bigger.w).toBeCloseTo(0.8, 10);
    expect(bigger.h).toBeCloseTo(0.2, 10);
  });

  it('a smaller size means a smaller estimated box', () => {
    const el = text({ x: 0.2, y: 0.2, w: 0.4, h: 0.1, size: 80 });
    const smaller = textSizePatch(el, 30);
    expect(smaller.w).toBeLessThan(el.w);
    expect(smaller.h).toBeLessThan(el.h);
  });

  it('doubling the size doubles the measured box, which the fit then adopts', () => {
    // Measurement is linear in font size, so the check is that nothing else interferes.
    const el = text({ x: 0.2, y: 0.2, w: 0.5, h: 0.2, size: 40, align: 'center' });
    const small = fitTextBox(el, { w: 200, h: 50 }, PAIR);
    const large = fitTextBox({ ...el, size: 80 }, { w: 400, h: 100 }, PAIR);
    expect(large.w).toBeCloseTo(small.w * 2, 10);
    expect(large.h).toBeCloseTo(small.h * 2, 10);
    // …and both stay pinned to the same centre, so growing the type does not move the words.
    expect(large.x + large.w / 2).toBeCloseTo(small.x + small.w / 2, 10);
    expect(large.y + large.h / 2).toBeCloseTo(small.y + small.h / 2, 10);
  });

  it('a resized box alone never changes the size — a side handle still reflows', () => {
    const el = text({ w: 0.4, h: 0.1, size: 40 });
    const wider = { ...el, w: 0.8 };
    expect(wider.size).toBe(40);
    expect(textFitSignature(wider)).toBe(textFitSignature(el));
  });
});

// ===============================================================================================
// E. The measured font size is the painted font size
// ===============================================================================================

describe('measurement uses the size the browser will paint', () => {
  it('the px helper is the cqw formula, resolved against a known container', () => {
    for (const size of [24, 80, 300]) {
      const el = text({ size });
      expect(textFontPx(el, PAIR.w, PAIR.h)).toBeCloseTo((size / REF_PAIR_W) * PAIR.w, 10);
      // The two functions agree by construction: same ratio, same basis.
      const cqw = Number(/([\d.]+)cqw/.exec(textFontSize(el))![1]);
      expect(textFontPx(el, PAIR.w, PAIR.h)).toBeCloseTo((cqw / 100) * PAIR.w, 8);
    }
  });

  it('a spine object measures against the container HEIGHT, matching its cqh rendering', () => {
    const el = text({ size: 50, role: 'spine' });
    expect(textFontPx(el, PAIR.w, PAIR.h)).toBeCloseTo((50 / REF_PAIR_W) * PAIR.h, 10);
    expect(textFontSize(el)).toContain('cqh');
  });
});

// ===============================================================================================
// F. Auto-fit is a CORRECTION, not a second undo step
// ===============================================================================================

describe('the fit is written as an amend, not a new history entry', () => {
  const history = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_history.ts'), 'utf8');
  const block = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_block.tsx'), 'utf8');
  const coverCanvas = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_cover-canvas.tsx'), 'utf8');

  it('the history container exposes an amend that leaves the past alone', () => {
    expect(history).toContain('const amend = useCallback');
    expect(history).toContain('past: s.past, present: next, future: s.future');
  });

  it('both canvases write the fit through amendText, so one undo reverses the size change', () => {
    expect(block).toContain('api.amendText(block.key, t.id, box)');
    expect(coverCanvas).toContain('cover.amendText(key, t.id, box)');
  });

  it('both canvases give Movable the same lower bound a fit can reach', () => {
    expect(block).toContain('minW={MIN_TEXT_BOX}');
    expect(coverCanvas).toContain('minW={MIN_TEXT_BOX}');
  });

  it('both canvases suppress the fit while the pointer owns the geometry', () => {
    expect(block).toContain('textResize.resizingId !== t.id');
    expect(coverCanvas).toContain('textResize.resizingId !== t.id');
  });

  it('both canvases suppress the fit while the words are being typed', () => {
    expect(block).toContain('editingText !== t.id');
    expect(coverCanvas).toContain('editingText !== t.id');
  });
});
