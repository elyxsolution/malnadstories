import { describe, expect, it } from 'vitest';

import {
  MAX_ZOOM,
  computeFrameLayout,
  frameOverflow,
  type EditConfig,
} from '@/lib/builder/model';
import { PhotoEditSchema } from '@/lib/validations';

/**
 * IMAGE ADJUSTMENT INSIDE A FIXED FRAME — the same behaviour for every photo frame.
 *
 * The distinction the builder has to hold is between two things that both look like "moving a
 * picture": changing the FRAME's geometry (an overlay's x/y/w/h, which lives on the block) and
 * changing where the IMAGE sits INSIDE that frame (zoom / offsetX / offsetY, which lives on the
 * photo's `edit_config`). These tests pin the second one, and specifically that it is decided
 * ONLY by (frame size, natural size, edit) — which is what makes it identical for a page half, a
 * full-spread image and an overlay of any shape, in the canvas, the preview and the PDF, because
 * all of them call this one function.
 */

// A 3:2 landscape photo, in the pixel dimensions the worker records.
const NAT = { w: 3000, h: 2000 };

const layoutIn = (fw: number, fh: number, edit?: EditConfig | null) =>
  computeFrameLayout(fw, fh, NAT.w, NAT.h, edit);

/** The visible window as a fraction of the whole image, on each axis. */
function visibleFraction(fw: number, fh: number, edit?: EditConfig | null) {
  const l = layoutIn(fw, fh, edit)!;
  return { x: fw / l.layer.width, y: fh / l.layer.height };
}

describe('the image is cover-fit into whatever frame it is given', () => {
  const frames: [string, number, number][] = [
    ['square overlay', 300, 300],
    ['portrait overlay', 200, 340],
    ['landscape overlay', 420, 180],
    ['a single page half', 480, 640],
    ['a full double-page spread', 1280, 640],
  ];

  it.each(frames)('%s: fills the frame with no empty edge and no distortion', (_label, fw, fh) => {
    const l = layoutIn(fw, fh)!;
    // Covers: the footprint is at least the frame on both axes.
    expect(l.layer.width).toBeGreaterThanOrEqual(fw - 1e-6);
    expect(l.layer.height).toBeGreaterThanOrEqual(fh - 1e-6);
    // Exactly one axis is tight (true cover-fit, never a stretch to fill both).
    const slackX = l.layer.width - fw;
    const slackY = l.layer.height - fh;
    expect(Math.min(slackX, slackY)).toBeCloseTo(0, 6);
    // ASPECT IS NEVER DISTORTED — the <img> keeps the photo's own ratio in every frame.
    expect(l.img.width / l.img.height).toBeCloseTo(NAT.w / NAT.h, 6);
    // Centred at rest.
    expect(l.layer.left).toBeCloseTo((fw - l.layer.width) / 2, 6);
    expect(l.layer.top).toBeCloseTo((fh - l.layer.height) / 2, 6);
  });

  it('is decided only by frame size, natural size and the edit', () => {
    // Two DIFFERENT frames that happen to share a shape produce proportionally identical results,
    // which is the property that makes one adjustment implementation correct for all of them.
    const small = layoutIn(300, 300, { zoom: 2, offsetX: 0.5 })!;
    const large = layoutIn(600, 600, { zoom: 2, offsetX: 0.5 })!;
    expect(large.layer.width / small.layer.width).toBeCloseTo(2, 6);
    expect(large.layer.left / small.layer.left).toBeCloseTo(2, 6);
  });
});

describe('zooming changes how much of the photo shows', () => {
  it('zoom 1 shows the largest window the frame allows', () => {
    const at1 = visibleFraction(300, 300, { zoom: 1 });
    const at2 = visibleFraction(300, 300, { zoom: 2 });
    expect(at2.x).toBeLessThan(at1.x);
    expect(at2.y).toBeLessThan(at1.y);
    expect(at2.x).toBeCloseTo(at1.x / 2, 6);
  });

  it('is clamped to the model bounds rather than trusting the stored value', () => {
    const beyond = layoutIn(300, 300, { zoom: 99 })!;
    const capped = layoutIn(300, 300, { zoom: MAX_ZOOM })!;
    expect(beyond.layer.width).toBeCloseTo(capped.layer.width, 6);

    const below = layoutIn(300, 300, { zoom: 0.2 })!;
    const one = layoutIn(300, 300, { zoom: 1 })!;
    expect(below.layer.width).toBeCloseTo(one.layer.width, 6);
  });
});

describe('panning chooses which part of the photo the frame shows', () => {
  it('offset ±1 reaches the edge exactly — the frame is never left with a blank strip', () => {
    const fw = 300;
    const fh = 300;
    const left = layoutIn(fw, fh, { offsetX: -1 })!;
    const right = layoutIn(fw, fh, { offsetX: 1 })!;
    // At the extremes the image edge lands on the frame edge, not past it.
    expect(left.layer.left + left.layer.width).toBeCloseTo(fw, 6);
    expect(right.layer.left).toBeCloseTo(0, 6);
  });

  it('an offset beyond the range is clamped, not extrapolated', () => {
    const clamped = layoutIn(300, 300, { offsetX: 5 })!;
    const atEdge = layoutIn(300, 300, { offsetX: 1 })!;
    expect(clamped.layer.left).toBeCloseTo(atEdge.layer.left, 6);
  });

  it('frameOverflow reports the pan range the drag maths converts against', () => {
    // A 3:2 photo in a square frame: horizontal slack, none vertically.
    const ov = frameOverflow(300, 300, NAT.w, NAT.h, {})!;
    expect(ov.x).toBeGreaterThan(0);
    expect(ov.y).toBeCloseTo(0, 6);

    // Zooming in creates slack on BOTH axes, so the image can be moved in any direction.
    const zoomed = frameOverflow(300, 300, NAT.w, NAT.h, { zoom: 2 })!;
    expect(zoomed.x).toBeGreaterThan(ov.x);
    expect(zoomed.y).toBeGreaterThan(0);
  });

  it('has no effect on an axis with no slack', () => {
    const a = layoutIn(300, 300, { offsetY: -1 })!;
    const b = layoutIn(300, 300, { offsetY: 1 })!;
    expect(a.layer.top).toBeCloseTo(b.layer.top, 6);
  });
});

describe('the adjustment is part of the photo, so it survives a round-trip', () => {
  const edit: EditConfig = {
    zoom: 2.4,
    offsetX: -0.35,
    offsetY: 0.8,
    crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
    rotate: 90,
    flipH: true,
  };

  it('persists through the save schema unchanged', () => {
    const parsed = PhotoEditSchema.parse({ photoId: '11111111-1111-4111-8111-111111111111', edit });
    expect(parsed.edit).toEqual(edit);
    // …and rendering the parsed value gives the identical geometry, so a reload restores the
    // exact crop rather than reverting to the untouched photo.
    expect(layoutIn(320, 240, parsed.edit)).toEqual(layoutIn(320, 240, edit));
  });

  it('rejects an out-of-range adjustment instead of storing it', () => {
    const bad = PhotoEditSchema.safeParse({
      photoId: '11111111-1111-4111-8111-111111111111',
      edit: { zoom: 12 },
    });
    expect(bad.success).toBe(false);
  });

  it('composes with the free crop: the crop chooses the region, zoom/pan frame it', () => {
    const whole = layoutIn(300, 300, {})!;
    const half = layoutIn(300, 300, { crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } })!;
    // A half-size crop region has to be scaled up ~2× to cover the same frame.
    expect(half.layer.width / whole.layer.width).toBeCloseTo(2, 6);
  });

  it('an untouched photo and an identity edit render identically', () => {
    expect(layoutIn(300, 300, null)).toEqual(layoutIn(300, 300, { zoom: 1, offsetX: 0, offsetY: 0 }));
  });
});
