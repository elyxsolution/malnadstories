import { describe, expect, it } from 'vitest';

import { fitBlockWidth } from '@/app/(app)/albums/[id]/build/_use-fit-scale';
import { FULL_PAGE_OVERLAY_GEOM, DEFAULT_OVERLAY_GEOM, type Overlay } from '@/lib/builder/model';
import { EDIT_BOUNDS } from '@/lib/builder/edit-bounds';
import { resolveLayoutForSave } from '@/lib/builder/persist-layout';
import { SaveLayoutSchema } from '@/lib/validations';
import { evaluateAlbum, type EvalBlock } from '@/lib/albums/validation';
import { DEFAULT_COVER_CONFIG } from '@/lib/builder/cover';

/**
 * THE WORKSPACE FIT, AND THE EMPTY FRAME A PAGE NOW STARTS WITH.
 *
 * Both are decided by pure functions, which is deliberate: the fit is a display calculation that
 * must provably touch nothing about the album, and an empty photo frame is an ordinary overlay
 * that must provably survive the save/reload boundary like any other.
 */

// ── the fit ──────────────────────────────────────────────────────────────────────

describe('fitting the album into the workspace', () => {
  const PAIR = 1.5; // an open pair of 3:4 pages
  const PAD = 0.06; // PASTEBOARD_PCT
  const CHROME = 44;

  /** The height the block actually occupies once drawn at `width`. */
  const drawnHeight = (width: number, aspect = PAIR, pad = PAD, chrome = CHROME) =>
    width * (2 * pad + (1 - 2 * pad) / aspect) + chrome;

  it('returns null until the workspace has been measured', () => {
    expect(fitBlockWidth({ w: 0, h: 0 }, { aspect: PAIR })).toBeNull();
    expect(fitBlockWidth({ w: 900, h: 0 }, { aspect: PAIR })).toBeNull();
  });

  it('fits BOTH axes — a short workspace is limited by height, not width', () => {
    const box = { w: 1200, h: 500 };
    const width = fitBlockWidth(box, { aspect: PAIR, padFrac: PAD, chromePx: CHROME })!;
    expect(width).toBeLessThan(box.w);
    expect(drawnHeight(width)).toBeLessThanOrEqual(box.h + 0.001);
  });

  it('a tall narrow workspace is limited by width', () => {
    const box = { w: 600, h: 2000 };
    expect(fitBlockWidth(box, { aspect: PAIR, padFrac: PAD, chromePx: CHROME })).toBe(600);
  });

  it('never exceeds the workspace on either axis, across a range of real viewports', () => {
    const viewports = [
      { w: 700, h: 380 },
      { w: 980, h: 520 },
      { w: 1240, h: 640 },
      { w: 1600, h: 900 },
      { w: 400, h: 300 },
    ];
    for (const box of viewports) {
      const width = fitBlockWidth(box, { aspect: PAIR, padFrac: PAD, chromePx: CHROME, maxPx: 1400 })!;
      expect(width).toBeLessThanOrEqual(Math.max(box.w, 200));
      expect(drawnHeight(width)).toBeLessThanOrEqual(Math.max(box.h, drawnHeight(200)) + 0.001);
    }
  });

  it('honours the taste cap on a very large display', () => {
    expect(fitBlockWidth({ w: 4000, h: 4000 }, { aspect: PAIR, padFrac: PAD, chromePx: CHROME, maxPx: 1400 })).toBe(1400);
  });

  it('keeps a floor so a collapsing panel cannot shrink the album to nothing', () => {
    expect(fitBlockWidth({ w: 10, h: 10 }, { aspect: PAIR, padFrac: PAD, chromePx: CHROME })).toBe(200);
  });

  it('works for the cover spread, which is much wider than it is tall', () => {
    // Back + spine + front at 3:4 pages ≈ 1.56 wide per unit height.
    const aspect = 1.56;
    const box = { w: 900, h: 700 };
    const width = fitBlockWidth(box, { aspect, chromePx: 36, maxPx: 740 })!;
    expect(width).toBeLessThanOrEqual(740);
    expect(width / aspect + 36).toBeLessThanOrEqual(box.h + 0.001);
  });

  it('is a pure display calculation — the same box and aspect always give the same width', () => {
    const a = fitBlockWidth({ w: 1280, h: 620 }, { aspect: PAIR, padFrac: PAD, chromePx: CHROME });
    const b = fitBlockWidth({ w: 1280, h: 620 }, { aspect: PAIR, padFrac: PAD, chromePx: CHROME });
    expect(a).toBe(b);
  });

  it('editor zoom composes on top of the fit', () => {
    const fit = fitBlockWidth({ w: 1280, h: 620 }, { aspect: PAIR, padFrac: PAD, chromePx: CHROME })!;
    // 100% is exactly the fit; zooming in overflows deliberately, zooming out shrinks.
    expect((fit * 100) / 100).toBe(fit);
    expect((fit * 150) / 100).toBeGreaterThan(fit);
    expect((fit * 50) / 100).toBeLessThan(fit);
  });
});

// ── the frame a new page starts with ─────────────────────────────────────────────

describe('a new page starts with one empty full-page photo frame', () => {
  const ALBUM = '44444444-4444-4444-8444-444444444444';
  const PHOTO = '11111111-1111-4111-8111-111111111111';

  const startingFrame = (): Overlay => ({ id: 'o1', photoId: null, ...FULL_PAGE_OVERLAY_GEOM });

  it('covers the whole page and stays inside the persisted bounds', () => {
    expect(FULL_PAGE_OVERLAY_GEOM).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const { x, y, w, h } = FULL_PAGE_OVERLAY_GEOM;
    expect(x).toBeGreaterThanOrEqual(EDIT_BOUNDS.minX);
    expect(y).toBeGreaterThanOrEqual(EDIT_BOUNDS.minY);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThanOrEqual(1);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThanOrEqual(1);
  });

  it('carries NO photo — the page holds a container, not a picture', () => {
    expect(startingFrame().photoId).toBeNull();
  });

  it('is a page-level object: the base row stays empty, so no photo container returns to the page', () => {
    const page = { photoIds: [] as (string | null)[], overlays: [startingFrame()] };
    const { blocks } = resolveLayoutForSave([page], { resolve: (id: string) => id, isUnresolvedTemp: () => false });
    expect(blocks[0].photoIds).toEqual([]);
    expect(blocks[0].overlays).toHaveLength(1);
  });

  it('round-trips through the save schema as an empty container', () => {
    const parsed = SaveLayoutSchema.safeParse({
      albumId: ALBUM,
      blocks: [{ template: 'single-pair', photoIds: [], overlays: [{ photoId: null, ...FULL_PAGE_OVERLAY_GEOM }] }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.blocks[0].overlays[0].photoId).toBeNull();
  });

  it('two empty frames on one page are legal — "placed at most once" counts photos, not containers', () => {
    const parsed = SaveLayoutSchema.safeParse({
      albumId: ALBUM,
      blocks: [
        {
          template: 'single-pair',
          photoIds: [],
          overlays: [
            { photoId: null, ...FULL_PAGE_OVERLAY_GEOM },
            { photoId: null, ...DEFAULT_OVERLAY_GEOM },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('reads as unfinished until a photo is put in it, and finished once one is', () => {
    const cover = { activeTemplate: true, config: DEFAULT_COVER_CONFIG, title: 'Coorg, 2019' };
    const page = (photoId: string | null): EvalBlock => ({
      template: 'single-pair',
      photoIds: [],
      overlays: [{ photoId }],
      background: { kind: 'color', value: 'sand' },
    });

    const fresh = evaluateAlbum({ size: 2, blocks: [page(null)], cover });
    expect(fresh.printReady).toBe(false);
    expect(fresh.warnings.some((w) => w.id === 'incomplete_page:1')).toBe(true);
    // Not "blank" — the page IS designed; it is the frame on it that is waiting.
    expect(fresh.warnings.some((w) => w.id === 'empty_page:1')).toBe(false);

    const filled = evaluateAlbum({ size: 2, blocks: [page(PHOTO)], cover });
    expect(filled.printReady).toBe(true);
    expect(filled.statistics.placedPhotos).toBe(1);
  });
});
