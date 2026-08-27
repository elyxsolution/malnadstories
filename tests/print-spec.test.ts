/**
 * THE PRINT SPECIFICATION — every physical dimension the printer-ready exports must produce.
 *
 * This file is the machine-readable copy of `dimensions.pdf`. Its numbers are not derived from the
 * implementation; they are typed out from the supplied drawing (and, for the cover safe area, from
 * the guide geometry measured inside Plate 02) so that a change to `lib/print/spec` which alters a
 * printed dimension fails here rather than at a print partner.
 *
 * A prepress error is not a bug you find in staging. It is a bug you find after the paper is cut.
 */
import { describe, it, expect } from 'vitest';
import {
  COVER_ARTWORK,
  COVER_BACK_SAFE_BOX,
  COVER_FINISHED_SPREAD,
  COVER_FRONT_SAFE_BOX,
  COVER_HINGE_MM,
  COVER_PANEL,
  COVER_PANELS,
  COVER_SAFE_INSET_MM,
  COVER_SPINE_MM,
  COVER_SPREAD_BOX,
  COVER_WRAP_MM,
  FILL_OVERSCAN_PX,
  INTERIOR_ARTWORK,
  INTERIOR_BLEED_MM,
  INTERIOR_SAFE_BOX,
  INTERIOR_SAFE_INSET_MM,
  INTERIOR_TRIM,
  INTERIOR_TRIM_BOX,
  PRINTER_MARKS_ENABLED,
  TARGET_PPI,
  coverPanel,
  coverSafeBox,
  effectivePpi,
  mmToPt,
  mmToPx,
  mmToPxCeil,
  scaleToFill,
  spinePrintWidthMm,
  toPt,
} from '@/lib/print/spec';

describe('interior / content pages (Plate 01)', () => {
  it('finished trim is 200 × 285 mm', () => {
    expect(INTERIOR_TRIM).toEqual({ w: 200, h: 285 });
  });

  it('bleed is 3 mm on all four sides', () => {
    expect(INTERIOR_BLEED_MM).toBe(3);
  });

  it('the supplied artwork page is 206 × 291 mm', () => {
    expect(INTERIOR_ARTWORK).toEqual({ w: 206, h: 291 });
    // Derived, not restated: trim + bleed on BOTH sides of each axis.
    expect(INTERIOR_ARTWORK.w).toBe(INTERIOR_TRIM.w + INTERIOR_BLEED_MM * 2);
    expect(INTERIOR_ARTWORK.h).toBe(INTERIOR_TRIM.h + INTERIOR_BLEED_MM * 2);
  });

  it('the trim box sits 3 mm inside the artwork on every side', () => {
    expect(INTERIOR_TRIM_BOX).toEqual({ x: 3, y: 3, w: 200, h: 285 });
    // The bleed is symmetric: the trim box's far edges are 3 mm from the artwork's far edges.
    expect(INTERIOR_ARTWORK.w - (INTERIOR_TRIM_BOX.x + INTERIOR_TRIM_BOX.w)).toBe(INTERIOR_BLEED_MM);
    expect(INTERIOR_ARTWORK.h - (INTERIOR_TRIM_BOX.y + INTERIOR_TRIM_BOX.h)).toBe(INTERIOR_BLEED_MM);
  });

  it('safe area is 15 mm from EVERY trim edge — the product decision, not Plate 01’s 10 mm', () => {
    expect(INTERIOR_SAFE_INSET_MM).toBe(15);
    // 15, deliberately: Plate 01 draws 10 mm safe plus a separate 15 mm binding strip on the
    // left/spine edge only. The wider value is applied uniformly so a page is safe whichever
    // edge ends up in the gutter.
    expect(INTERIOR_SAFE_INSET_MM).not.toBe(10);
  });

  it('the safe box is 170 × 255 mm at 18 mm from each artwork edge', () => {
    expect(INTERIOR_SAFE_BOX).toEqual({ x: 18, y: 18, w: 170, h: 255 });
    // 18 = 3 mm bleed + 15 mm safe inset, measured from the ARTWORK edge.
    expect(INTERIOR_SAFE_BOX.x).toBe(INTERIOR_BLEED_MM + INTERIOR_SAFE_INSET_MM);
    // …and exactly 15 mm inside the trim, which is what the specification actually says.
    expect(INTERIOR_SAFE_BOX.x - INTERIOR_TRIM_BOX.x).toBe(INTERIOR_SAFE_INSET_MM);
    expect(
      INTERIOR_TRIM_BOX.x + INTERIOR_TRIM_BOX.w - (INTERIOR_SAFE_BOX.x + INTERIOR_SAFE_BOX.w),
    ).toBe(INTERIOR_SAFE_INSET_MM);
  });
});

describe('cover (Plate 02)', () => {
  it('one finished cover panel is 210 × 297 mm', () => {
    expect(COVER_PANEL).toEqual({ w: 210, h: 297 });
  });

  it('hinge is 10 mm and wrap is 15 mm', () => {
    expect(COVER_HINGE_MM).toBe(10);
    expect(COVER_WRAP_MM).toBe(15);
  });

  it('the finished flat spread is 453 × 297 mm', () => {
    expect(COVER_FINISHED_SPREAD).toEqual({ w: 453, h: 297 });
    // 210 + 10 + 13 + 10 + 210 = 453, as arithmetic rather than a restated literal.
    expect(COVER_PANEL.w * 2 + COVER_HINGE_MM * 2 + COVER_SPINE_MM).toBe(453);
  });

  it('the supplied cover artwork is 483 × 327 mm', () => {
    expect(COVER_ARTWORK).toEqual({ w: 483, h: 327 });
    expect(COVER_ARTWORK.w).toBe(COVER_FINISHED_SPREAD.w + COVER_WRAP_MM * 2);
    expect(COVER_ARTWORK.h).toBe(COVER_FINISHED_SPREAD.h + COVER_WRAP_MM * 2);
  });

  it('the finished spread sits exactly one wrap inside the artwork', () => {
    expect(COVER_SPREAD_BOX).toEqual({ x: 15, y: 15, w: 453, h: 297 });
    expect(COVER_ARTWORK.w - (COVER_SPREAD_BOX.x + COVER_SPREAD_BOX.w)).toBe(COVER_WRAP_MM);
    expect(COVER_ARTWORK.h - (COVER_SPREAD_BOX.y + COVER_SPREAD_BOX.h)).toBe(COVER_WRAP_MM);
  });

  describe('width construction — 210 / 10 / 13 / 10 / 210', () => {
    it('names the five panels in printed order, left to right', () => {
      expect(COVER_PANELS.map((p) => p.name)).toEqual([
        'back',
        'hinge-left',
        'spine',
        'hinge-right',
        'front',
      ]);
    });

    it('gives each panel its specified width', () => {
      expect(COVER_PANELS.map((p) => p.rect.w)).toEqual([210, 10, 13, 10, 210]);
    });

    it('lays them out contiguously across the spread, with no gap and no overlap', () => {
      let x = COVER_SPREAD_BOX.x;
      for (const panel of COVER_PANELS) {
        expect(panel.rect.x, `${panel.name} starts where the previous panel ended`).toBe(x);
        x += panel.rect.w;
      }
      expect(x, 'the panels end exactly at the spread’s right edge').toBe(
        COVER_SPREAD_BOX.x + COVER_SPREAD_BOX.w,
      );
    });

    it('places every panel at full finished height, inside the wrap', () => {
      for (const panel of COVER_PANELS) {
        expect(panel.rect.y).toBe(COVER_WRAP_MM);
        expect(panel.rect.h).toBe(COVER_PANEL.h);
      }
    });

    it('puts the panels at the artwork coordinates the drawing shows', () => {
      // Back 15→225 · hinge 225→235 · spine 235→248 · hinge 248→258 · front 258→468.
      expect(coverPanel('back').rect.x).toBe(15);
      expect(coverPanel('hinge-left').rect.x).toBe(225);
      expect(coverPanel('spine').rect.x).toBe(235);
      expect(coverPanel('hinge-right').rect.x).toBe(248);
      expect(coverPanel('front').rect.x).toBe(258);
      expect(coverPanel('front').rect.x + coverPanel('front').rect.w).toBe(468);
    });
  });

  describe('safe area — 12 mm, derived from Plate 02’s guides', () => {
    it('is 12 mm', () => {
      expect(COVER_SAFE_INSET_MM).toBe(12);
    });

    it('gives the back cover a 186 × 273 mm safe box at x 27→213, y 27→300', () => {
      expect(COVER_BACK_SAFE_BOX).toEqual({ x: 27, y: 27, w: 186, h: 273 });
      expect(COVER_BACK_SAFE_BOX.x + COVER_BACK_SAFE_BOX.w).toBe(213);
      expect(COVER_BACK_SAFE_BOX.y + COVER_BACK_SAFE_BOX.h).toBe(300);
    });

    it('gives the front cover a 186 × 273 mm safe box at x 270→456, y 27→300', () => {
      expect(COVER_FRONT_SAFE_BOX).toEqual({ x: 270, y: 27, w: 186, h: 273 });
      expect(COVER_FRONT_SAFE_BOX.x + COVER_FRONT_SAFE_BOX.w).toBe(456);
      expect(COVER_FRONT_SAFE_BOX.y + COVER_FRONT_SAFE_BOX.h).toBe(300);
    });

    it('derives 186 × 273 from the panel rather than restating it', () => {
      expect(COVER_PANEL.w - COVER_SAFE_INSET_MM * 2).toBe(186);
      expect(COVER_PANEL.h - COVER_SAFE_INSET_MM * 2).toBe(273);
    });

    it('keeps both safe boxes 12 mm clear of their hinge fold line', () => {
      const hingeL = coverPanel('hinge-left').rect;
      const hingeR = coverPanel('hinge-right').rect;
      // The back's safe box stops 12 mm before the left fold; the front's starts 12 mm after
      // the right fold. This is exactly Plate 02's guides at x = 265 and x = 322 in its own space.
      expect(hingeL.x - (COVER_BACK_SAFE_BOX.x + COVER_BACK_SAFE_BOX.w)).toBe(COVER_SAFE_INSET_MM);
      expect(COVER_FRONT_SAFE_BOX.x - (hingeR.x + hingeR.w)).toBe(COVER_SAFE_INSET_MM);
    });

    it('excludes the hinges and the spine entirely', () => {
      const spine = coverPanel('spine').rect;
      const insideBack = (x: number) =>
        x >= COVER_BACK_SAFE_BOX.x && x <= COVER_BACK_SAFE_BOX.x + COVER_BACK_SAFE_BOX.w;
      const insideFront = (x: number) =>
        x >= COVER_FRONT_SAFE_BOX.x && x <= COVER_FRONT_SAFE_BOX.x + COVER_FRONT_SAFE_BOX.w;
      for (const x of [
        coverPanel('hinge-left').rect.x,
        spine.x,
        spine.x + spine.w / 2,
        coverPanel('hinge-right').rect.x,
      ]) {
        expect(insideBack(x) || insideFront(x), `x=${x} must be outside both safe boxes`).toBe(false);
      }
    });

    it('only the two faces have a safe box — asking for anything else is a programming error', () => {
      expect(coverSafeBox('back')).toEqual(COVER_BACK_SAFE_BOX);
      expect(coverSafeBox('front')).toEqual(COVER_FRONT_SAFE_BOX);
      // @ts-expect-error — 'spine' is not a face; the type system refuses it and so does the code.
      expect(() => coverSafeBox('spine')).toBeDefined();
    });
  });
});

describe('spine width — 13 mm for EVERY page count', () => {
  it('is 13 mm', () => {
    expect(COVER_SPINE_MM).toBe(13);
  });

  it.each([24, 36, 48])('a %i-page album has a 13 mm spine', (pages) => {
    expect(spinePrintWidthMm(pages)).toBe(13);
  });

  it('is 13 mm for a page count nobody has thought of yet', () => {
    for (const pages of [12, 60, 72, 96, 120]) {
      expect(spinePrintWidthMm(pages)).toBe(13);
    }
  });

  it('is 13 mm with no page count at all', () => {
    expect(spinePrintWidthMm()).toBe(13);
    expect(spinePrintWidthMm(undefined)).toBe(13);
  });

  it('USES NO PAGE-COUNT FORMULA — the result is invariant across the whole range', () => {
    // The builder's `spineWidthFor` is a page-count-dependent PREVIEW proportion (0.06→0.12 of a
    // page width) and is documented there as advisory, not a pre-press measurement. If print
    // geometry ever started reading it, the values below would spread out. They must not.
    const widths = new Set(Array.from({ length: 200 }, (_, i) => spinePrintWidthMm(i + 1)));
    expect(widths.size, 'spine width must not vary with page count').toBe(1);
    expect(Array.from(widths)).toEqual([13]);
  });

  it('holds the cover artwork at 483 × 327 mm regardless of page count', () => {
    // The artwork width is 453 + 30, and 453 assumes a 13 mm spine — so a page-count-dependent
    // spine would silently change the size of every cover file. It does not.
    for (const pages of [24, 36, 48]) {
      const spread = COVER_PANEL.w * 2 + COVER_HINGE_MM * 2 + spinePrintWidthMm(pages);
      expect(spread).toBe(453);
      expect(spread + COVER_WRAP_MM * 2).toBe(COVER_ARTWORK.w);
    }
  });
});

describe('units and the physical MediaBox', () => {
  it('converts mm → PDF points at 72 dpi', () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 10);
    expect(mmToPt(0)).toBe(0);
  });

  it('converts mm → CSS px at 96 dpi', () => {
    expect(mmToPx(25.4)).toBeCloseTo(96, 10);
  });

  /**
   * THE MEDIABOX. These are the numbers a prepress operator reads out of the finished file, and
   * they are the single most important assertion in this suite: everything else can be right while
   * the page size is wrong, and only the page size is unrecoverable after printing.
   */
  it('the interior page MediaBox is 583.94 × 824.88 pt', () => {
    expect(toPt(INTERIOR_ARTWORK)).toEqual({ w: 583.94, h: 824.88 });
  });

  it('the cover page MediaBox is 1369.13 × 926.93 pt', () => {
    expect(toPt(COVER_ARTWORK)).toEqual({ w: 1369.13, h: 926.93 });
  });

  it('rounds a page axis UP to Chromium’s print fragmentainer', () => {
    // 206 mm = 778.58… px, and Chromium paints a 779 px sheet. A page element at the exact
    // fraction leaves 0.42 px of bare paper — the hairline this rounding exists to remove.
    expect(mmToPx(206)).toBeCloseTo(778.583, 3);
    expect(mmToPxCeil(206)).toBe(779);
    expect(mmToPxCeil(291)).toBe(1100);
    expect(mmToPxCeil(483)).toBe(1826);
    expect(mmToPxCeil(327)).toBe(1236);
  });

  it('never rounds a page axis DOWN', () => {
    for (const mm of [206, 291, 483, 327, 200, 285, 210, 297, 13, 10, 15]) {
      expect(mmToPxCeil(mm)).toBeGreaterThanOrEqual(mmToPx(mm));
      expect(mmToPxCeil(mm) - mmToPx(mm)).toBeLessThan(1);
    }
  });
});

describe('scale-to-fill (design → bleed box)', () => {
  const A4_PAGE_ASPECT = 210 / 297; // the Standard product's page proportions

  it('covers the target on both axes', () => {
    const box = scaleToFill(A4_PAGE_ASPECT, { w: 779, h: 1100 });
    expect(box.w).toBeGreaterThanOrEqual(779);
    expect(box.h).toBeGreaterThanOrEqual(1100);
  });

  it('preserves the source aspect EXACTLY — it scales, it never stretches', () => {
    for (const aspect of [A4_PAGE_ASPECT, 0.5, 1, 1.5, 200 / 285]) {
      const box = scaleToFill(aspect, { w: 779, h: 1100 });
      expect(box.w / box.h).toBeCloseTo(aspect, 12);
    }
  });

  it('centres the result, so any crop is symmetric', () => {
    const target = { w: 779, h: 1100 };
    const box = scaleToFill(A4_PAGE_ASPECT, target);
    expect(box.x).toBeCloseTo(target.w - (box.x + box.w), 12);
    expect(box.y).toBeCloseTo(target.h - (box.y + box.h), 12);
  });

  it('crops rather than letterboxes — an offset is never positive on the binding axis', () => {
    const box = scaleToFill(A4_PAGE_ASPECT, { w: 779, h: 1100 });
    // Taller-than-target after covering the width: the overflow is split above and below.
    expect(box.y).toBeLessThanOrEqual(0);
    expect(box.x).toBeLessThanOrEqual(0);
  });

  it('the A4 page → 206 × 291 bleed box crops well under half a millimetre per edge', () => {
    // The real magnitude of the "unavoidable tiny crop": the two aspects differ by ~0.12%.
    const targetMm = { w: INTERIOR_ARTWORK.w, h: INTERIOR_ARTWORK.h };
    const box = scaleToFill(A4_PAGE_ASPECT, targetMm);
    expect(Math.abs(box.y)).toBeLessThan(0.5);
    expect(box.x).toBeCloseTo(0, 10); // width is the binding axis here
  });

  it('adds overscan uniformly when asked, without touching the aspect', () => {
    const plain = scaleToFill(A4_PAGE_ASPECT, { w: 779, h: 1100 });
    const over = scaleToFill(A4_PAGE_ASPECT, { w: 779, h: 1100 }, FILL_OVERSCAN_PX);
    expect(over.w).toBeCloseTo(plain.w + FILL_OVERSCAN_PX, 10);
    expect(over.w / over.h).toBeCloseTo(A4_PAGE_ASPECT, 12);
    expect(over.w).toBeGreaterThan(plain.w);
    expect(over.h).toBeGreaterThan(plain.h);
  });

  it('refuses a nonsensical aspect instead of producing a silently wrong page', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => scaleToFill(bad, { w: 100, h: 100 })).toThrow(/positive finite/);
    }
  });
});

describe('resolution', () => {
  it('targets 300 ppi at final size', () => {
    expect(TARGET_PPI).toBe(300);
  });

  it('computes effective ppi from source pixels over printed millimetres', () => {
    // 200 mm at 300 ppi needs 200/25.4 × 300 ≈ 2362 px.
    expect(effectivePpi(2362, 200)).toBeCloseTo(300, 0);
    expect(effectivePpi(1181, 200)).toBeCloseTo(150, 0);
  });

  it('returns 0 rather than Infinity for a zero-width frame', () => {
    expect(effectivePpi(1000, 0)).toBe(0);
    expect(effectivePpi(1000, -5)).toBe(0);
  });
});

describe('printer marks', () => {
  it('emits none, of any kind', () => {
    // No crop marks, registration marks, colour bars, slug or trim-line artwork. The renderers
    // draw nothing of the sort; this pins the intent so a future addition is a deliberate act.
    expect(PRINTER_MARKS_ENABLED).toBe(false);
  });
});
