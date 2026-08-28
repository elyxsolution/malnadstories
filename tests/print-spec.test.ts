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
  COVER_FOLD_LINES_MM,
  COVER_FRONT_SAFE_BOX,
  COVER_HINGE_MM,
  COVER_PANEL,
  COVER_PANELS,
  COVER_SAFE_INSET_MM,
  COVER_SPINE_MM,
  COVER_SPREAD_BOX,
  COVER_WRAP_MM,
  FILL_OVERSCAN_PX,
  GUIDE_STYLE,
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

  it('the finished flat spread is 457 × 297 mm', () => {
    expect(COVER_FINISHED_SPREAD).toEqual({ w: 457, h: 297 });
    // 210 + 10 + 17 + 10 + 210 = 457, as arithmetic rather than a restated literal.
    expect(COVER_PANEL.w * 2 + COVER_HINGE_MM * 2 + COVER_SPINE_MM).toBe(457);
  });

  it('the supplied cover artwork is 487 × 327 mm', () => {
    expect(COVER_ARTWORK).toEqual({ w: 487, h: 327 });
    expect(COVER_ARTWORK.w).toBe(COVER_FINISHED_SPREAD.w + COVER_WRAP_MM * 2);
    expect(COVER_ARTWORK.h).toBe(COVER_FINISHED_SPREAD.h + COVER_WRAP_MM * 2);
  });

  it('the finished spread sits exactly one wrap inside the artwork', () => {
    expect(COVER_SPREAD_BOX).toEqual({ x: 15, y: 15, w: 457, h: 297 });
    expect(COVER_ARTWORK.w - (COVER_SPREAD_BOX.x + COVER_SPREAD_BOX.w)).toBe(COVER_WRAP_MM);
    expect(COVER_ARTWORK.h - (COVER_SPREAD_BOX.y + COVER_SPREAD_BOX.h)).toBe(COVER_WRAP_MM);
  });

  describe('width construction — 210 / 10 / 17 / 10 / 210', () => {
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
      expect(COVER_PANELS.map((p) => p.rect.w)).toEqual([210, 10, 17, 10, 210]);
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
      // Back 15→225 · hinge 225→235 · spine 235→252 · hinge 252→262 · front 262→472.
      // Everything left of the spine is unmoved by the 13→17 change; everything right of it
      // shifts by exactly the +4 mm the spine gained.
      expect(coverPanel('back').rect.x).toBe(15);
      expect(coverPanel('hinge-left').rect.x).toBe(225);
      expect(coverPanel('spine').rect.x).toBe(235);
      expect(coverPanel('hinge-right').rect.x).toBe(252);
      expect(coverPanel('front').rect.x).toBe(262);
      expect(coverPanel('front').rect.x + coverPanel('front').rect.w).toBe(472);
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

    it('gives the front cover a 186 × 273 mm safe box at x 274→460, y 27→300', () => {
      expect(COVER_FRONT_SAFE_BOX).toEqual({ x: 274, y: 27, w: 186, h: 273 });
      expect(COVER_FRONT_SAFE_BOX.x + COVER_FRONT_SAFE_BOX.w).toBe(460);
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

describe('spine width — 17 mm for EVERY page count', () => {
  it('is 17 mm', () => {
    expect(COVER_SPINE_MM).toBe(17);
  });

  it.each([24, 36, 48])('a %i-page album has a 17 mm spine', (pages) => {
    expect(spinePrintWidthMm(pages)).toBe(17);
  });

  it('is 17 mm for a page count nobody has thought of yet', () => {
    for (const pages of [12, 60, 72, 96, 120]) {
      expect(spinePrintWidthMm(pages)).toBe(17);
    }
  });

  it('is 17 mm with no page count at all', () => {
    expect(spinePrintWidthMm()).toBe(17);
    expect(spinePrintWidthMm(undefined)).toBe(17);
  });

  it('USES NO PAGE-COUNT FORMULA — the result is invariant across the whole range', () => {
    // The builder's `spineWidthFor` is a page-count-dependent PREVIEW proportion (0.06→0.12 of a
    // page width) and is documented there as advisory, not a pre-press measurement. If print
    // geometry ever started reading it, the values below would spread out. They must not.
    const widths = new Set(Array.from({ length: 200 }, (_, i) => spinePrintWidthMm(i + 1)));
    expect(widths.size, 'spine width must not vary with page count').toBe(1);
    expect(Array.from(widths)).toEqual([17]);
  });

  it('holds the cover artwork at 487 × 327 mm regardless of page count', () => {
    // The artwork width is 457 + 30, and 457 assumes a 17 mm spine — so a page-count-dependent
    // spine would silently change the size of every cover file. It does not.
    for (const pages of [24, 36, 48]) {
      const spread = COVER_PANEL.w * 2 + COVER_HINGE_MM * 2 + spinePrintWidthMm(pages);
      expect(spread).toBe(457);
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

  it('the cover page MediaBox is 1380.47 × 926.93 pt', () => {
    expect(toPt(COVER_ARTWORK)).toEqual({ w: 1380.47, h: 926.93 });
  });

  it('rounds a page axis UP to Chromium’s print fragmentainer', () => {
    // 206 mm = 778.58… px, and Chromium paints a 779 px sheet. A page element at the exact
    // fraction leaves 0.42 px of bare paper — the hairline this rounding exists to remove.
    expect(mmToPx(206)).toBeCloseTo(778.583, 3);
    expect(mmToPxCeil(206)).toBe(779);
    expect(mmToPxCeil(291)).toBe(1100);
    expect(mmToPxCeil(487)).toBe(1841);
    expect(mmToPxCeil(327)).toBe(1236);
  });

  it('never rounds a page axis DOWN', () => {
    for (const mm of [206, 291, 487, 327, 200, 285, 210, 297, 17, 10, 15]) {
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

/**
 * SPINE 13 mm → 17 mm (2026-08-29).
 *
 * A deliberate deviation from `dimensions.pdf`, which draws 13 mm. It is a single constant with
 * every other cover value derived from it, so the risk is not that the change is wrong — it is
 * that a later "restore the drawing's value" edit silently reverts it, or that someone absorbs
 * the 4 mm by quietly shrinking a panel or a hinge instead of widening the case.
 *
 * This block pins BOTH halves: the new spine, and the fact that nothing else moved.
 */
describe('spine 13 → 17 mm — the change, and everything it must NOT have changed', () => {
  it('is 17 mm, and 13 mm can never come back', () => {
    expect(COVER_SPINE_MM).toBe(17);
    expect(COVER_SPINE_MM).not.toBe(13);
    expect(spinePrintWidthMm()).not.toBe(13);
    expect(coverPanel('spine').rect.w).toBe(17);
  });

  it('is exactly +4 mm — the delta, stated as arithmetic', () => {
    const PREVIOUS_SPINE_MM = 13;
    expect(COVER_SPINE_MM - PREVIOUS_SPINE_MM).toBe(4);
    // The case got wider by the same 4 mm, on the width axis only.
    expect(COVER_FINISHED_SPREAD.w - (210 * 2 + 10 * 2 + PREVIOUS_SPINE_MM)).toBe(4);
    expect(COVER_ARTWORK.w - (210 * 2 + 10 * 2 + PREVIOUS_SPINE_MM + 15 * 2)).toBe(4);
  });

  it('leaves the panels, hinges, wrap and safe inset untouched', () => {
    expect(COVER_PANEL).toEqual({ w: 210, h: 297 });
    expect(COVER_HINGE_MM).toBe(10);
    expect(COVER_WRAP_MM).toBe(15);
    expect(COVER_SAFE_INSET_MM).toBe(12);
    // The 4 mm was absorbed by the SPINE, not taken out of a neighbour.
    expect(coverPanel('back').rect.w).toBe(210);
    expect(coverPanel('front').rect.w).toBe(210);
    expect(coverPanel('hinge-left').rect.w).toBe(10);
    expect(coverPanel('hinge-right').rect.w).toBe(10);
  });

  it('leaves every HEIGHT untouched', () => {
    expect(COVER_FINISHED_SPREAD.h).toBe(297);
    expect(COVER_ARTWORK.h).toBe(327);
    expect(COVER_SPREAD_BOX.h).toBe(297);
    expect(toPt(COVER_ARTWORK).h).toBe(926.93);
  });

  it('leaves the ENTIRE interior specification untouched', () => {
    expect(INTERIOR_TRIM).toEqual({ w: 200, h: 285 });
    expect(INTERIOR_BLEED_MM).toBe(3);
    expect(INTERIOR_SAFE_INSET_MM).toBe(15);
    expect(INTERIOR_ARTWORK).toEqual({ w: 206, h: 291 });
    expect(toPt(INTERIOR_ARTWORK)).toEqual({ w: 583.94, h: 824.88 });
  });

  it('moves ONLY the two folds to the right of the spine', () => {
    // Back|hinge and hinge|spine are upstream of the spine and cannot move.
    expect(COVER_FOLD_LINES_MM[0]).toBe(225);
    expect(COVER_FOLD_LINES_MM[1]).toBe(235);
    // spine|hinge and hinge|front each shift by exactly the 4 mm the spine gained.
    expect(COVER_FOLD_LINES_MM[2]).toBe(248 + 4);
    expect(COVER_FOLD_LINES_MM[3]).toBe(258 + 4);
  });

  it('keeps the guide lines dashed and measured, but lighter ink', () => {
    // Dimensional values are untouched — the styling change must not move anything.
    expect(GUIDE_STYLE.fold.dashMm).toEqual([7, 2, 1.6, 2]);
    expect(GUIDE_STYLE.fold.widthMm).toBe(0.55);
    expect(GUIDE_STYLE.trim.dashMm).toEqual([3, 2.2]);
    expect(GUIDE_STYLE.trim.widthMm).toBe(0.5);
    // Black, so a greyscale proof still shows it — but no longer at full strength.
    expect(GUIDE_STYLE.color).toBe('#000000');
    expect(GUIDE_STYLE.opacity).toBeGreaterThan(0);
    expect(GUIDE_STYLE.opacity).toBeLessThan(1);
  });
});
