/**
 * ONE IMAGE, MANY PLACEMENTS — the model that makes a photo a reusable SOURCE ASSET.
 *
 * The album builder used to enforce "a photo is placed at most once" in three places at once: the
 * save schema rejected a repeated id, every assignment stripped the photo from wherever it already
 * was, and the tray dimmed a used tile and refused to place it again. Underneath all three sat the
 * real reason it had to be that way — a photo's crop, zoom, rotation and tone lived on the `photos`
 * row, so two frames showing one image would have been showing one crop, and adjusting either
 * would have silently re-framed the other.
 *
 * These tests pin the model that replaced it:
 *
 *   A. the same photo can be placed any number of times, and the save schema accepts it;
 *   B. every placement is COUNTED, so the tray can say "3 Placed" rather than a binary ✓;
 *   C. every placement owns its own `EditConfig`, resolved per frame at render time;
 *   D. an untouched placement INHERITS the source photo's edit — which is what makes every album
 *      saved before this render byte-for-byte as it did, with no migration;
 *   E. the whole thing survives serialize → Zod → hydrate.
 *
 * Everything here is pure: the model, the schema and the resolution rule. No database, no network.
 */
import { describe, expect, it } from 'vitest';

import {
  forkFrameEdit,
  placedPhotoIds,
  placementCounts,
  resolveFrameEdit,
  trimBaseEdits,
  type Block,
  type EditConfig,
  type Overlay,
} from '@/lib/builder/model';
import { coverPlacementIds, DEFAULT_COVER_CONFIG, normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';
import { SaveLayoutSchema } from '@/lib/validations';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const ALBUM = '44444444-4444-4444-8444-444444444444';

const ov = (photoId: string | null, over: Partial<Overlay> = {}): Overlay => ({
  id: `o-${Math.random().toString(36).slice(2, 8)}`,
  photoId,
  x: 0.1,
  y: 0.1,
  w: 0.3,
  h: 0.3,
  ...over,
});

const block = (over: Partial<Block> = {}): Block => ({
  key: `b-${Math.random().toString(36).slice(2, 8)}`,
  template: 'single-pair',
  photoIds: [],
  caption: '',
  overlays: [],
  texts: [],
  qrs: [],
  stickers: [],
  background: null,
  ...over,
});

// ===============================================================================================
// A. THE SAME IMAGE CAN BE PLACED MANY TIMES
// ===============================================================================================

describe('A — one image, many placements', () => {
  it('accepts the same photo in a base slot, two overlays and another page', () => {
    const parsed = SaveLayoutSchema.safeParse({
      albumId: ALBUM,
      blocks: [
        { template: 'single-pair', photoIds: [A, B], overlays: [{ photoId: A, x: 0.5, y: 0.1, w: 0.2, h: 0.2 }] },
        { template: 'single-pair', photoIds: [A], overlays: [{ photoId: A, x: 0.2, y: 0.2, w: 0.2, h: 0.2 }] },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('still refuses the things that were never about repetition', () => {
    // The overlay cap is unchanged — lifting placed-once did not lift the abuse limits.
    const tooMany = SaveLayoutSchema.safeParse({
      albumId: ALBUM,
      blocks: [
        {
          template: 'single-pair',
          photoIds: [],
          overlays: Array.from({ length: 51 }, () => ({ photoId: A, x: 0.1, y: 0.1, w: 0.2, h: 0.2 })),
        },
      ],
    });
    expect(tooMany.success).toBe(false);

    // A base row still cannot describe more than the two page halves.
    const tooWide = SaveLayoutSchema.safeParse({
      albumId: ALBUM,
      blocks: [{ template: 'single-pair', photoIds: [A, B, C], overlays: [] }],
    });
    expect(tooWide.success).toBe(false);
  });

  it('`placedPhotoIds` answers "used at all", and collapses repeats by design', () => {
    const blocks = [block({ photoIds: [A, A] }), block({ overlays: [ov(A), ov(B)] })];
    expect(placedPhotoIds(blocks)).toEqual(new Set([A, B]));
  });
});

// ===============================================================================================
// B. THE COUNT — derived, never stored
// ===============================================================================================

describe('B — placement counts', () => {
  it('counts PLACEMENTS, not distinct photos', () => {
    // A on page 1 left, page 5 as an overlay, page 8 as an overlay.
    const blocks = [
      block({ photoIds: [A, B] }),
      block({ overlays: [ov(A)] }),
      block({ overlays: [ov(A), ov(C)] }),
    ];
    const counts = placementCounts(blocks);
    expect(counts.get(A)).toBe(3);
    expect(counts.get(B)).toBe(1);
    expect(counts.get(C)).toBe(1);
  });

  it('a photo that has never been placed is simply absent (no badge)', () => {
    expect(placementCounts([block()]).get(A)).toBeUndefined();
  });

  it('deleting ONE placement decrements the count and leaves the others alone', () => {
    const shared = [block({ overlays: [ov(A), ov(A)] }), block({ overlays: [ov(A)] })];
    expect(placementCounts(shared).get(A)).toBe(3);

    // Remove exactly one container — the other two are untouched.
    const after = [{ ...shared[0], overlays: shared[0].overlays.slice(1) }, shared[1]];
    expect(placementCounts(after).get(A)).toBe(2);
  });

  it('an EMPTY container and a base-slot hole contribute nothing', () => {
    const blocks = [block({ photoIds: [null, A], overlays: [ov(null), ov(null)] })];
    expect(placementCounts(blocks).get(A)).toBe(1);
    expect(placementCounts(blocks).size).toBe(1);
  });

  it('includes the cover: front backdrop, back backdrop and back overlays', () => {
    const cover: CoverConfig = {
      ...DEFAULT_COVER_CONFIG,
      photoId: A,
      back: { ...DEFAULT_COVER_CONFIG.back, photoId: A, overlays: [ov(A), ov(B)] },
    };
    expect(coverPlacementIds(cover)).toEqual([A, A, A, B]);

    // Page 1 + three cover placements = 4.
    const counts = placementCounts([block({ photoIds: [A] })], coverPlacementIds(cover));
    expect(counts.get(A)).toBe(4);
    expect(counts.get(B)).toBe(1);
  });

  it('is DERIVED — an orphaned placement cannot survive to be counted', () => {
    // Deleting the page deletes its placements, because the pages ARE the album. There is no
    // counter to go stale, which is the whole reason it is computed rather than stored.
    const blocks = [block({ overlays: [ov(A)] }), block({ overlays: [ov(A)] })];
    expect(placementCounts(blocks).get(A)).toBe(2);
    expect(placementCounts(blocks.slice(1)).get(A)).toBe(1);
    expect(placementCounts([]).get(A)).toBeUndefined();
  });
});

// ===============================================================================================
// C + D. INDEPENDENT EDIT STATE, WITH INHERITANCE
// ===============================================================================================

describe('C — every placement owns its own edit', () => {
  const source: EditConfig = { zoom: 1.4, rotate: 90 };

  it('a frame with no edit of its own INHERITS the source photo (legacy behaviour, exactly)', () => {
    expect(resolveFrameEdit(undefined, source)).toEqual(source);
    expect(resolveFrameEdit(null, source)).toEqual(source);
    // No edit anywhere = no edit. Not an empty object pretending to be one.
    expect(resolveFrameEdit(undefined, null)).toBeNull();
  });

  it('a frame that HAS forked ignores the source entirely', () => {
    const own: EditConfig = { zoom: 2.5, offsetX: -0.4 };
    expect(resolveFrameEdit(own, source)).toEqual(own);
    // Including the deliberate "reset this placement to nothing" case.
    expect(resolveFrameEdit({}, source)).toEqual({});
  });

  it('forking starts from what the frame was ALREADY showing', () => {
    // First adjustment on an unforked frame: the inherited edit is snapshotted and patched, so the
    // picture does not jump the moment it is first touched.
    expect(forkFrameEdit(undefined, source, { offsetY: 0.2 })).toEqual({ zoom: 1.4, rotate: 90, offsetY: 0.2 });
    // A frame that has already forked patches its own.
    expect(forkFrameEdit({ zoom: 3 }, source, { offsetY: 0.2 })).toEqual({ zoom: 3, offsetY: 0.2 });
  });

  /**
   * THE HEADLINE REQUIREMENT, as an assertion.
   *
   * The same photo in a page frame, another page's overlay and a back-cover overlay. Adjusting the
   * back cover must leave the other two exactly as they were, and vice versa.
   */
  it('editing one placement changes NOTHING about the others', () => {
    const pageFrame: Overlay = ov(A, { edit: { zoom: 1.2 } });
    const otherPage: Overlay = ov(A); // still inheriting
    const backCover: Overlay = ov(A, { edit: { zoom: 2, offsetX: 0.5 } });
    const before = JSON.parse(JSON.stringify([pageFrame, otherPage]));

    // Adjust ONLY the back cover.
    const edited: Overlay = { ...backCover, edit: forkFrameEdit(backCover.edit, source, { rotate: 180 }) };

    expect(edited.edit).toEqual({ zoom: 2, offsetX: 0.5, rotate: 180 });
    expect([pageFrame, otherPage]).toEqual(before);
    // And what each frame RENDERS is still its own answer.
    expect(resolveFrameEdit(pageFrame.edit, source)).toEqual({ zoom: 1.2 });
    expect(resolveFrameEdit(otherPage.edit, source)).toEqual(source);
    expect(resolveFrameEdit(edited.edit, source)).toEqual({ zoom: 2, offsetX: 0.5, rotate: 180 });
  });

  it('the reverse direction too — editing a page leaves the back cover alone', () => {
    const backCover: Overlay = ov(A, { edit: { zoom: 2 } });
    const snapshot = JSON.parse(JSON.stringify(backCover));
    const page: Overlay = ov(A, { edit: forkFrameEdit(undefined, source, { tilt: 3 }) });
    expect(page.edit).toEqual({ zoom: 1.4, rotate: 90, tilt: 3 });
    expect(backCover).toEqual(snapshot);
  });

  it('base slots are POSITIONAL, so the left page\'s crop never becomes the right page\'s', () => {
    const b = block({ photoIds: [A, A], baseEdits: [{ zoom: 1.1 }, { zoom: 2.9 }] });
    expect(resolveFrameEdit(b.baseEdits?.[0], source)).toEqual({ zoom: 1.1 });
    expect(resolveFrameEdit(b.baseEdits?.[1], source)).toEqual({ zoom: 2.9 });

    // Clearing the LEFT slot's edit leaves the right one exactly where it was.
    const cleared = { ...b, baseEdits: trimBaseEdits([null, b.baseEdits?.[1]]) };
    expect(cleared.baseEdits).toEqual([null, { zoom: 2.9 }]);
    expect(resolveFrameEdit(cleared.baseEdits?.[0], source)).toEqual(source);
  });
});

// ===============================================================================================
// E. IT SURVIVES SAVE → RELOAD
// ===============================================================================================

describe('E — the placement model round-trips', () => {
  it('a per-placement edit passes the save schema and comes back identical', () => {
    const payload = {
      albumId: ALBUM,
      blocks: [
        {
          template: 'single-pair' as const,
          photoIds: [A, A],
          baseEdits: [{ zoom: 1.1 }, { zoom: 2.9, rotate: 90 as const }],
          overlays: [
            { photoId: A, x: 0.1, y: 0.1, w: 0.3, h: 0.3, edit: { offsetX: -0.5 } },
            { photoId: A, x: 0.5, y: 0.5, w: 0.3, h: 0.3 },
          ],
        },
      ],
    };
    const parsed = SaveLayoutSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const b = parsed.data.blocks[0];
    expect(b.baseEdits).toEqual([{ zoom: 1.1 }, { zoom: 2.9, rotate: 90 }]);
    expect(b.overlays[0].edit).toEqual({ offsetX: -0.5 });
    // The unforked frame stays unforked — it must keep inheriting after a reload.
    expect(b.overlays[1].edit).toBeUndefined();
  });

  it('a placement edit is bounded exactly like a photo edit — no wider surface', () => {
    const bad = SaveLayoutSchema.safeParse({
      albumId: ALBUM,
      blocks: [
        {
          template: 'single-pair',
          photoIds: [],
          overlays: [{ photoId: A, x: 0.1, y: 0.1, w: 0.3, h: 0.3, edit: { zoom: 99 } }],
        },
      ],
    });
    expect(bad.success).toBe(false);
  });

  it('BACKWARD COMPATIBILITY — a payload with no edits at all is still valid and still means "inherit"', () => {
    const parsed = SaveLayoutSchema.safeParse({
      albumId: ALBUM,
      blocks: [{ template: 'single-pair', photoIds: [A, null], overlays: [{ photoId: B, x: 0, y: 0, w: 0.5, h: 1 }] }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.blocks[0].baseEdits).toBeUndefined();
    expect(parsed.data.blocks[0].overlays[0].edit).toBeUndefined();
    expect(resolveFrameEdit(parsed.data.blocks[0].overlays[0].edit, { zoom: 1.7 })).toEqual({ zoom: 1.7 });
  });

  it('`trimBaseEdits` stores NOTHING for a block that has never forked', () => {
    expect(trimBaseEdits(undefined)).toBeUndefined();
    expect(trimBaseEdits([null, null])).toBeUndefined();
    expect(trimBaseEdits([{ zoom: 2 }, null])).toEqual([{ zoom: 2 }]);
    // An interior hole is preserved — it IS the layout ("right forked, left inherits").
    expect(trimBaseEdits([null, { zoom: 2 }])).toEqual([null, { zoom: 2 }]);
  });

  it('a legacy cover with overlays but no edits normalizes to "inherit", not to broken', () => {
    const legacy = normalizeCoverConfig({
      back: { overlays: [{ photoId: A, x: 0.1, y: 0.1, w: 0.3, h: 0.3 }] },
    } as Parameters<typeof normalizeCoverConfig>[0]);
    expect(legacy.back.overlays[0].edit).toBeUndefined();
    expect(resolveFrameEdit(legacy.back.overlays[0].edit, { rotate: 270 })).toEqual({ rotate: 270 });
  });
});
