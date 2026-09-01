/**
 * THE STICKER BOX IS THE STICKER.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────────────────────
 *
 * A placed sticker's selection outline and its eight handles were far larger than the visible
 * artwork. The cause is geometric and universal, not an artefact of one asset: `makeSticker`
 * creates a PIXEL-SQUARE box (`h = w × containerAspect`) whatever shape the artwork is, and the
 * renderer draws it `object-fit: contain` inside that box. `contain` letterboxes, so every sticker
 * that is not square sat in a box with empty margins — and `Movable`, correctly, outlined the box.
 *
 * ── WHAT IS ASSERTED ───────────────────────────────────────────────────────────────────────
 *
 * The fix derives the box from the artwork's REAL geometry (its `naturalWidth`/`naturalHeight`) and
 * the container's aspect. These tests pin the two properties that make it a fix rather than a
 * fudge — the box ends up EXACTLY the rendered artwork rect, and the visible sticker does not move
 * or change size — across a spread of shapes, on both surface aspects.
 *
 * The measurement itself (loading the image to read its intrinsic size) is a browser concern and
 * is verified separately; everything below is the pure geometry it feeds.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { STICKER_FIT_EPSILON, stickerAspectRatio, stickerFitBox } from '@/lib/builder/sticker-fit';
import { makeSticker, PAIR_ASPECT } from '@/lib/builder/elements';
import type { Rect } from '@/lib/builder/model';

/** An open pair is 3:2; one cover face is 3:4. Both real surfaces, both exercised. */
const PAIR = PAIR_ASPECT; // 1.5
const FACE = 0.75;

/**
 * Where the artwork is ACTUALLY drawn inside a box, in normalized units — the independent
 * reference implementation of `object-fit: contain` these tests measure the fix against.
 */
function renderedRect(box: Rect, naturalAspect: number, containerAspect: number): Rect {
  const bw = box.w * containerAspect; // box width in "container-height" units
  const bh = box.h;
  const scale = Math.min(bw / naturalAspect, bh / 1);
  const rw = (naturalAspect * scale) / containerAspect;
  const rh = 1 * scale;
  return { x: box.x + (box.w - rw) / 2, y: box.y + (box.h - rh) / 2, w: rw, h: rh };
}

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 8);
const sameRect = (a: Rect, b: Rect) => {
  close(a.x, b.x);
  close(a.y, b.y);
  close(a.w, b.w);
  close(a.h, b.h);
};

/** A representative spread of real sticker shapes. */
const SHAPES: [string, number][] = [
  ['a wide banner (3:1)', 3],
  ['a landscape badge (16:9)', 16 / 9],
  ['a square seal (1:1)', 1],
  ['a portrait ribbon (2:3)', 2 / 3],
  ['a tall sliver (1:4)', 0.25],
];

describe('the fitted box is exactly the rendered artwork', () => {
  it.each(SHAPES)('%s on a page', (_label, aspect) => {
    const el = makeSticker('s', PAIR);
    const fitted = stickerFitBox(el, aspect, PAIR);
    // A square box only already fits a square sticker.
    if (aspect === 1) {
      expect(fitted).toBeNull();
      return;
    }
    expect(fitted).not.toBeNull();
    sameRect(fitted!, renderedRect(el, aspect, PAIR));
  });

  it.each(SHAPES)('%s on a cover face', (_label, aspect) => {
    const el = makeSticker('s', FACE);
    const fitted = stickerFitBox(el, aspect, FACE);
    if (aspect === 1) {
      expect(fitted).toBeNull();
      return;
    }
    sameRect(fitted!, renderedRect(el, aspect, FACE));
  });
});

describe('the VISIBLE sticker is untouched — only the empty margin goes', () => {
  it.each(SHAPES)('%s keeps its exact pixels and its exact centre', (_label, aspect) => {
    const el = makeSticker('s', PAIR);
    const before = renderedRect(el, aspect, PAIR);
    const fitted = stickerFitBox(el, aspect, PAIR) ?? el;
    const after = renderedRect(fitted, aspect, PAIR);
    // The artwork occupies the same rectangle it did — that is what "do not change the visual size"
    // means, stated as an assertion rather than as an intention.
    sameRect(after, before);
    // And the box's centre is the artwork's centre, so nothing walks when the box tightens.
    close(fitted.x + fitted.w / 2, el.x + el.w / 2);
    close(fitted.y + fitted.h / 2, el.y + el.h / 2);
  });

  it('the fitted box is never LARGER than the box it replaces', () => {
    for (const [, aspect] of SHAPES) {
      const el = makeSticker('s', PAIR);
      const fitted = stickerFitBox(el, aspect, PAIR) ?? el;
      expect(fitted.w).toBeLessThanOrEqual(el.w + 1e-9);
      expect(fitted.h).toBeLessThanOrEqual(el.h + 1e-9);
    }
  });

  it('one axis is always kept whole — the fit removes letterboxing, it does not shrink', () => {
    for (const [, aspect] of SHAPES) {
      const el = makeSticker('s', PAIR);
      const fitted = stickerFitBox(el, aspect, PAIR) ?? el;
      const keptW = Math.abs(fitted.w - el.w) < 1e-9;
      const keptH = Math.abs(fitted.h - el.h) < 1e-9;
      expect(keptW || keptH).toBe(true);
    }
  });
});

describe('the fit terminates and refuses nonsense', () => {
  it('is IDEMPOTENT — a fitted box reports nothing further to do', () => {
    for (const [, aspect] of SHAPES) {
      const el = makeSticker('s', PAIR);
      const once = stickerFitBox(el, aspect, PAIR) ?? el;
      expect(stickerFitBox(once, aspect, PAIR)).toBeNull();
    }
  });

  it('tolerates floating-point noise rather than re-fitting for ever', () => {
    const el = makeSticker('s', PAIR);
    const fitted = stickerFitBox(el, 3, PAIR)!;
    const jittered = { ...fitted, h: fitted.h * (1 + STICKER_FIT_EPSILON / 4) };
    expect(stickerFitBox(jittered, 3, PAIR)).toBeNull();
  });

  it('refuses to act on a degenerate box or an unmeasurable image', () => {
    const el = makeSticker('s', PAIR);
    expect(stickerFitBox(el, 0, PAIR)).toBeNull();
    expect(stickerFitBox(el, NaN, PAIR)).toBeNull();
    expect(stickerFitBox(el, 3, 0)).toBeNull();
    expect(stickerFitBox({ ...el, w: 0 }, 3, PAIR)).toBeNull();
    expect(stickerFitBox({ ...el, h: 0 }, 3, PAIR)).toBeNull();
  });
});

describe('a resize keeps the box tight, so it cannot come loose again', () => {
  it.each(SHAPES)('%s: the locked ratio reproduces the artwork aspect at any width', (_label, aspect) => {
    for (const container of [PAIR, FACE]) {
      const ratio = stickerAspectRatio(aspect, container);
      for (const w of [0.05, 0.16, 0.4, 0.9]) {
        // `Movable` derives `h = w * squareRatio` during a resize (the same primitive the QR code
        // uses to stay pixel-square). The resulting box must render the artwork with no margin.
        const box = { x: 0.1, y: 0.1, w, h: w * ratio };
        expect(stickerFitBox(box, aspect, container)).toBeNull();
      }
    }
  });

  it('is the same primitive the QR code already used — square pixels are ratio 1:1 artwork', () => {
    // A QR is `squareRatio = containerAspect`, which is this function with a 1:1 "artwork".
    expect(stickerAspectRatio(1, PAIR)).toBeCloseTo(PAIR, 12);
    expect(stickerAspectRatio(1, FACE)).toBeCloseTo(FACE, 12);
  });
});

describe('the wiring', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('both editing canvases fit AND aspect-lock their stickers, from the one shared hook', () => {
    for (const file of [
      'src/app/(app)/albums/[id]/build/_block.tsx',
      'src/app/(app)/albums/[id]/build/_cover-canvas.tsx',
    ]) {
      const src = read(file);
      expect(src).toContain('useStickerBoxFit');
      expect(src).toContain('stickerAspectRatio');
      expect(src).toContain('keepSquare={stickerRatio(s.stickerId) !== undefined}');
      expect(src).toContain('squareRatio={stickerRatio(s.stickerId)}');
    }
  });

  it('the correction is an AMEND — tightening a box is not a second thing to undo', () => {
    expect(read('src/app/(app)/albums/[id]/build/_block.tsx')).toContain('api.amendSticker(block.key, id, box)');
    expect(read('src/app/(app)/albums/[id]/build/_cover-canvas.tsx')).toContain('cover.amendSticker(key, id, box)');
    for (const file of [
      'src/app/(app)/albums/[id]/build/_use-builder.ts',
      'src/app/(app)/albums/[id]/build/_use-cover.ts',
    ]) {
      expect(read(file)).toMatch(/amendSticker[\s\S]{0,600}hist\.amend/);
    }
  });

  it('the read-only renderers are NOT fitted — a fit is an editing correction', () => {
    // `StickerBox` (preview / PDF / thumbnails) draws the stored box and measures nothing.
    const src = read('src/app/(app)/albums/[id]/build/_elements-render.tsx');
    expect(src).not.toContain('useStickerBoxFit');
    expect(src).not.toContain('stickerFitBox');
  });

  it('the artwork is still `contain`, so a box that has not been measured cannot distort it', () => {
    const src = read('src/app/(app)/albums/[id]/build/_elements-render.tsx');
    expect(src).toContain('object-contain');
  });
});
