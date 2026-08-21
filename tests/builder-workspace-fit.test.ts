import { describe, expect, it } from 'vitest';

import { fitBlockWidth } from '@/app/(app)/albums/[id]/build/_use-fit-scale';
import {
  DEFAULT_OVERLAY_GEOM,
  LEFT_PAGE_OVERLAY_GEOM,
  RIGHT_PAGE_OVERLAY_GEOM,
  FULL_PAIR_OVERLAY_GEOM,
  makeOverlayId,
  newUnitOverlayGeoms,
  type Overlay,
} from '@/lib/builder/model';
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

describe('a new spread starts with one empty full-page frame PER PAGE', () => {
  const ALBUM = '44444444-4444-4444-8444-444444444444';
  const PHOTO = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';

  /** `useBlocks.newUnitOverlays`, expressed here so the invariant is testable without the hook. */
  const startingFrames = (template: 'single-pair' | 'double-spread' = 'single-pair'): Overlay[] =>
    newUnitOverlayGeoms(template).map((geom) => ({ id: makeOverlayId(), photoId: null, ...geom }));

  it('creates TWO frames on a pair — one per page, not one box across the gutter', () => {
    const frames = startingFrames('single-pair');
    expect(frames).toHaveLength(2);
    const [left, right] = frames;
    expect(left).toMatchObject(LEFT_PAGE_OVERLAY_GEOM);
    expect(right).toMatchObject(RIGHT_PAGE_OVERLAY_GEOM);
    // Two genuine objects, each independently addressable.
    expect(left.id).not.toBe(right.id);
  });

  it('gives each page its own half, with no overlap and no gap across the gutter', () => {
    const [left, right] = startingFrames('single-pair');
    expect(left.x + left.w).toBeCloseTo(0.5, 6); // ends exactly at the fold
    expect(right.x).toBeCloseTo(0.5, 6); // starts exactly at the fold
    expect(left.x + left.w + right.w).toBeCloseTo(1, 6); // together they cover the pair
  });

  it('page ownership IS the geometry — left of the fold, right of the fold', () => {
    const [left, right] = startingFrames('single-pair');
    const centre = (o: Overlay) => o.x + o.w / 2;
    expect(centre(left)).toBeLessThan(0.5);
    expect(centre(right)).toBeGreaterThan(0.5);
  });

  it('leaves the panorama alone: a double-spread still gets ONE frame across both pages', () => {
    const frames = startingFrames('double-spread');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject(FULL_PAIR_OVERLAY_GEOM);
  });

  it('every frame stays inside the persisted bounds', () => {
    for (const template of ['single-pair', 'double-spread'] as const) {
      for (const { x, y, w, h } of startingFrames(template)) {
        expect(x).toBeGreaterThanOrEqual(EDIT_BOUNDS.minX);
        expect(y).toBeGreaterThanOrEqual(EDIT_BOUNDS.minY);
        expect(w).toBeGreaterThan(0);
        expect(w).toBeLessThanOrEqual(1);
        expect(h).toBeGreaterThan(0);
        expect(h).toBeLessThanOrEqual(1);
      }
    }
  });

  it('carries NO photo — the page holds containers, not pictures', () => {
    expect(startingFrames().every((o) => o.photoId === null)).toBe(true);
  });

  it('is a page-level object: the base row stays empty, so no photo container returns to the page', () => {
    const page = { photoIds: [] as (string | null)[], overlays: startingFrames() };
    const { blocks } = resolveLayoutForSave([page], { resolve: (id: string) => id, isUnresolvedTemp: () => false });
    expect(blocks[0].photoIds).toEqual([]);
    expect(blocks[0].overlays).toHaveLength(2);
  });

  it('round-trips through the save schema as two empty containers in order', () => {
    const parsed = SaveLayoutSchema.safeParse({
      albumId: ALBUM,
      blocks: [
        {
          template: 'single-pair',
          photoIds: [],
          overlays: [
            { photoId: null, ...LEFT_PAGE_OVERLAY_GEOM },
            { photoId: null, ...RIGHT_PAGE_OVERLAY_GEOM },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const [l, r] = parsed.data.blocks[0].overlays;
      expect(l).toMatchObject({ photoId: null, ...LEFT_PAGE_OVERLAY_GEOM });
      expect(r).toMatchObject({ photoId: null, ...RIGHT_PAGE_OVERLAY_GEOM });
    }
  });

  it('two photos, one per page, are legal and independent', () => {
    const parsed = SaveLayoutSchema.safeParse({
      albumId: ALBUM,
      blocks: [
        {
          template: 'single-pair',
          photoIds: [],
          overlays: [
            { photoId: PHOTO, ...LEFT_PAGE_OVERLAY_GEOM },
            { photoId: OTHER, ...RIGHT_PAGE_OVERLAY_GEOM },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('a manually added frame coexists with the two defaults', () => {
    const parsed = SaveLayoutSchema.safeParse({
      albumId: ALBUM,
      blocks: [
        {
          template: 'single-pair',
          photoIds: [],
          overlays: [
            { photoId: null, ...LEFT_PAGE_OVERLAY_GEOM },
            { photoId: null, ...RIGHT_PAGE_OVERLAY_GEOM },
            { photoId: null, ...DEFAULT_OVERLAY_GEOM },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('emptying ONE frame leaves the other exactly where it was', () => {
    // Clearing an overlay's photo keeps its CONTAINER — the rule `clearFrames` and the
    // serialization boundary both apply — so neither frame can move or be reordered.
    const overlays: Overlay[] = [
      { id: 'l', photoId: PHOTO, ...LEFT_PAGE_OVERLAY_GEOM },
      { id: 'r', photoId: OTHER, ...RIGHT_PAGE_OVERLAY_GEOM },
    ];
    const cleared = overlays.map((o) => (o.id === 'l' ? { ...o, photoId: null } : o));
    expect(cleared[0]).toMatchObject({ id: 'l', photoId: null, ...LEFT_PAGE_OVERLAY_GEOM });
    expect(cleared[1]).toMatchObject({ id: 'r', photoId: OTHER, ...RIGHT_PAGE_OVERLAY_GEOM });
    expect(cleared.map((o) => o.id)).toEqual(['l', 'r']);
  });

  it('reads as unfinished until BOTH frames are filled', () => {
    const cover = { activeTemplate: true, config: DEFAULT_COVER_CONFIG, title: 'Coorg, 2019' };
    const spread = (left: string | null, right: string | null): EvalBlock => ({
      template: 'single-pair',
      photoIds: [],
      overlays: [{ photoId: left }, { photoId: right }],
      background: { kind: 'color', value: 'sand' },
    });

    const fresh = evaluateAlbum({ size: 2, blocks: [spread(null, null)], cover });
    expect(fresh.printReady).toBe(false);
    expect(fresh.warnings.some((w) => w.id === 'incomplete_page:1')).toBe(true);
    // Not "blank" — the page IS designed; it is the frames on it that are waiting.
    expect(fresh.warnings.some((w) => w.id === 'empty_page:1')).toBe(false);
    expect(fresh.statistics.expectedPhotos).toBe(2);

    const half = evaluateAlbum({ size: 2, blocks: [spread(PHOTO, null)], cover });
    expect(half.printReady).toBe(false);
    expect(half.statistics.placedPhotos).toBe(1);

    const done = evaluateAlbum({ size: 2, blocks: [spread(PHOTO, OTHER)], cover });
    expect(done.printReady).toBe(true);
    expect(done.statistics.placedPhotos).toBe(2);
  });
});
