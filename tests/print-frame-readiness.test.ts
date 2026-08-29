/**
 * A DECODED IMAGE IS NOT A FINISHED FRAME.
 *
 * `PhotoFrame` needs two independent facts before it can draw the picture the customer actually
 * composed: the image's NATURAL size (from the `load` event) and the frame's own BOX (from a
 * ResizeObserver). Until both exist, `computeFrameLayout` returns null and the renderer falls back
 * to a plain `object-fit: cover` image — which fills the frame, so it looks fine, and is the wrong
 * picture whenever the customer cropped, zoomed, panned, rotated or straightened it.
 *
 * Readiness used to be signalled from `load` alone. If the print route's frame counter reached its
 * total at that instant, Chromium captured the page while frames were still showing the fallback.
 * These tests pin the corrected rule and — via `computeFrameLayout` — show how much the two renders
 * actually differ, which is the reason the race matters rather than a theoretical concern.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isFrameReadyForCapture, type FrameReadyState } from '@/lib/builder/print-readiness';
import { computeFrameLayout, type EditConfig } from '@/lib/builder/model';

const state = (over: Partial<FrameReadyState> = {}): FrameReadyState => ({
  hasLayout: false,
  loaded: false,
  measured: false,
  errored: false,
  ...over,
});

// ===============================================================================================
// A. The race, step by step
// ===============================================================================================

describe('the exact sequence that used to capture too early', () => {
  it('NOT ready while nothing has happened', () => {
    expect(isFrameReadyForCapture(state())).toBe(false);
  });

  it('NOT ready after the image loads and decodes, if the frame is not yet measured', () => {
    // THE BUG, in one assertion. `load` fired, `img.decode()` resolved, the natural size is
    // known — and the frame is still rendering the fallback because nothing knows how big it is.
    expect(isFrameReadyForCapture(state({ loaded: true }))).toBe(false);
  });

  it('NOT ready after the frame is measured, if the image has not loaded', () => {
    expect(isFrameReadyForCapture(state({ measured: true }))).toBe(false);
  });

  it('READY once the measurement lands and the layout resolves', () => {
    expect(isFrameReadyForCapture(state({ loaded: true, measured: true, hasLayout: true }))).toBe(true);
  });

  it('a resolved layout is sufficient on its own — it can only exist if both inputs arrived', () => {
    expect(isFrameReadyForCapture(state({ hasLayout: true }))).toBe(true);
  });
});

describe('it can never deadlock, and never waits on a clock', () => {
  it('a FAILED image is ready immediately — a broken URL cannot hang PDF generation', () => {
    expect(isFrameReadyForCapture(state({ errored: true }))).toBe(true);
    // Even with nothing else true, and even before any measurement.
    expect(isFrameReadyForCapture(state({ errored: true, loaded: false, measured: false }))).toBe(true);
  });

  it('a frame measured as DEGENERATE is ready — the fallback is its final answer', () => {
    // Both inputs arrived and still produce no layout (a zero-sized box). Waiting longer changes
    // nothing, so readiness must not wait; otherwise one such frame stalls the whole export.
    expect(isFrameReadyForCapture(state({ loaded: true, measured: true, hasLayout: false }))).toBe(true);
  });

  it('distinguishes "measured as zero" from "not measured yet" — the reason the flag is explicit', () => {
    const notYet = state({ loaded: true, measured: false });
    const measuredZero = state({ loaded: true, measured: true });
    expect(isFrameReadyForCapture(notYet)).toBe(false);
    expect(isFrameReadyForCapture(measuredZero)).toBe(true);
  });

  it('every input is an event, not a duration — the predicate is total over its state space', () => {
    // All 16 combinations resolve deterministically; nothing is left to timing.
    for (const errored of [false, true])
      for (const hasLayout of [false, true])
        for (const loaded of [false, true])
          for (const measured of [false, true]) {
            const r = isFrameReadyForCapture({ errored, hasLayout, loaded, measured });
            expect(r).toBe(errored || hasLayout || (loaded && measured));
          }
  });
});

// ===============================================================================================
// B. Why it matters — the fallback is a DIFFERENT picture
// ===============================================================================================

describe('capturing before measurement would print a different photograph', () => {
  /**
   * The fallback is `object-fit: cover`: the image is scaled to cover the frame and centred. The
   * designed render is `computeFrameLayout`, which additionally applies the crop region, the zoom,
   * the pan and the rotation. Where the two differ, an early capture is a wrong print.
   *
   * Each case below computes the DESIGNED layout for a real frame/image pairing and asserts it is
   * not the plain cover-fit — i.e. that there is something to lose by capturing early.
   */
  const coverFit = (frameW: number, frameH: number, natW: number, natH: number) => {
    const s = Math.max(frameW / natW, frameH / natH);
    return { w: natW * s, h: natH * s };
  };

  const cases = [
    { name: 'landscape image in a portrait frame', frame: [780, 1103], nat: [4000, 2250] },
    { name: 'portrait image in a landscape frame', frame: [1103, 520], nat: [2250, 4000] },
    { name: 'matching aspect ratio', frame: [780, 1103], nat: [2000, 2828] },
  ] as const;

  for (const c of cases) {
    it(`${c.name}: the designed render is applied, not the raw cover-fit`, () => {
      const edit: EditConfig = { crop: { x: 0.15, y: 0.1, w: 0.6, h: 0.6 }, zoom: 1.5, offsetX: 0.3 };
      const layout = computeFrameLayout(c.frame[0], c.frame[1], c.nat[0], c.nat[1], edit);
      expect(layout).not.toBeNull();

      const plain = coverFit(c.frame[0], c.frame[1], c.nat[0], c.nat[1]);
      const designed = { w: parseFloat(String(layout!.img.width)), h: parseFloat(String(layout!.img.height)) };
      // A crop of 60% at 1.5× zoom cannot coincide with a plain cover-fit.
      expect(Math.abs(designed.w - plain.w) / plain.w).toBeGreaterThan(0.1);
      expect(Math.abs(designed.h - plain.h) / plain.h).toBeGreaterThan(0.1);
    });

    it(`${c.name}: no layout at all until the frame is measured`, () => {
      // The precise state the old gate could capture in: natural size known, box unknown.
      expect(computeFrameLayout(0, 0, c.nat[0], c.nat[1], null)).toBeNull();
      expect(isFrameReadyForCapture(state({ loaded: true, measured: false }))).toBe(false);
    });
  }

  it('an unedited photo still needs the measurement before it is called ready', () => {
    // Even with no edit, readiness must not be claimed on decode alone: the rule is one rule.
    expect(isFrameReadyForCapture(state({ loaded: true, measured: false }))).toBe(false);
    expect(computeFrameLayout(780, 1103, 4000, 2250, null)).not.toBeNull();
  });
});

// ===============================================================================================
// C. Wiring — the renderer and the print gate
// ===============================================================================================

describe('the renderer signals readiness the new way', () => {
  const src = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_photo-frame.tsx'), 'utf8');

  it('decode alone no longer fires the signal', () => {
    expect(src).toContain('setLoaded(true);');
    // `handleLoad` must not CALL it any more — that was the race. (A mention in a comment is
    // fine; the assertion is on the statement, so it cannot be satisfied by prose.)
    const handleLoad = src.slice(src.indexOf('const handleLoad'), src.indexOf('const handleError'));
    expect(handleLoad).not.toMatch(/^\s*fireReady\(\);/m);
  });

  it('a load FAILURE still fires it immediately', () => {
    const handleError = src.slice(src.indexOf('const handleError'), src.indexOf('useEffect(() => {\n    const el = ref.current'));
    expect(handleError).toContain('fireReady();');
  });

  it('the ResizeObserver records that a measurement happened, zero or not', () => {
    expect(src).toContain('setMeasured(true);');
  });

  it('readiness is decided by the shared predicate, not re-derived here', () => {
    expect(src).toContain('isFrameReadyForCapture({ hasLayout: layout !== null, loaded, measured, errored: false })');
  });

  it('uses NO timer of any kind', () => {
    expect(src).not.toContain('setTimeout');
    expect(src).not.toContain('setInterval');
    expect(src).not.toContain('requestIdleCallback');
  });

  it('is inert for the editor — only a surface that asks for readiness pays for it', () => {
    // The builder canvas and the tray pass no `onReady`; the effect returns immediately for them.
    expect(src).toContain('if (!onReady) return;');
  });
});

describe('the print gate still counts every frame', () => {
  const content = readFileSync(resolve(__dirname, '../src/app/albums/[id]/print/content/_print-content.tsx'), 'utf8');
  const album = readFileSync(resolve(__dirname, '../src/app/albums/[id]/print/_print-album.tsx'), 'utf8');

  it('the flag is only set once the counter reaches the total — one unmeasured frame holds it', () => {
    for (const src of [content, album]) {
      expect(src).toContain('loadedRef.current >= totalFrames');
      expect(src).toContain('__ALBUM_PRINT_READY');
    }
  });

  it('the print routes never lazy-load, so no frame can be left unrendered off-screen', () => {
    // `lazy` defaults to false and the print routes must never opt in.
    for (const src of [content, album]) expect(src).not.toContain('lazy');
  });
});
