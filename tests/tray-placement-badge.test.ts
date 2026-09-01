/**
 * THE PHOTO LIBRARY AFTER REUSE — the tray tile is a SOURCE, not a token that gets spent.
 *
 * The tray used to say "✓ Placed", dim the tile to 40 % and refuse tap-to-place once a photo was
 * on a page. All three were correct in a world where a photo could be used exactly once and
 * "placing" it again would only have moved it. With one image reusable they are all wrong in the
 * same direction: they tell the customer the picture is unavailable when it is the one thing they
 * are most likely to want again.
 *
 * The behavioural core — that the count is DERIVED from the album and therefore cannot go stale —
 * is executed in `tests/photo-placements.test.ts`. This file pins the tray's own contract: the
 * count reaches the tile, the tile stays live, and the wiring that feeds it counts the whole album
 * (cover included). The count's RENDERING is a React component with a virtual grid and no DOM test
 * environment in this repository, so it is asserted at the source level — the established pattern
 * here (see `tests/cover-overlays.test.tsx`) — and is listed as browser-unverified in the report.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { placementCounts } from '@/lib/builder/model';
import { coverPlacementIds, DEFAULT_COVER_CONFIG } from '@/lib/builder/cover';
import type { Block, Overlay } from '@/lib/builder/model';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const tray = read('src/app/(app)/albums/[id]/build/_tray.tsx');
const builder = read('src/app/(app)/albums/[id]/build/_builder.tsx');
const state = read('src/app/(app)/albums/[id]/build/_use-builder.ts');
const dnd = read('src/lib/builder/photo-dnd.ts');

const A = '11111111-1111-4111-8111-111111111111';
const ov = (photoId: string | null): Overlay => ({ id: `o${Math.random()}`, photoId, x: 0, y: 0, w: 0.3, h: 0.3 });
const block = (over: Partial<Block>): Block => ({
  key: `b${Math.random()}`,
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
// The number the badge shows
// ===============================================================================================

describe('the badge shows a COUNT, and the count is the album', () => {
  it('0 placements → nothing to show', () => {
    expect(placementCounts([block({})]).get(A) ?? 0).toBe(0);
  });

  it('1 · 2 · 3 placements → 1 · 2 · 3', () => {
    expect(placementCounts([block({ photoIds: [A] })]).get(A)).toBe(1);
    expect(placementCounts([block({ photoIds: [A] }), block({ overlays: [ov(A)] })]).get(A)).toBe(2);
    expect(
      placementCounts([block({ photoIds: [A] }), block({ overlays: [ov(A)] }), block({ overlays: [ov(A)] })]).get(A),
    ).toBe(3);
  });

  it('the worked example from the requirement: page 1 · page 5 · back cover → 3', () => {
    const blocks = [block({ photoIds: [A] }), block({ overlays: [ov(A)] })];
    const cover = { ...DEFAULT_COVER_CONFIG, back: { ...DEFAULT_COVER_CONFIG.back, overlays: [ov(A)] } };
    expect(placementCounts(blocks, coverPlacementIds(cover)).get(A)).toBe(3);

    // Delete the back-cover one: 2, and the two page placements are untouched.
    const coverAfter = { ...cover, back: { ...cover.back, overlays: [] } };
    expect(placementCounts(blocks, coverPlacementIds(coverAfter)).get(A)).toBe(2);
    expect(blocks[0].photoIds).toEqual([A]);
    expect(blocks[1].overlays[0].photoId).toBe(A);
  });
});

// ===============================================================================================
// The tile stays a source
// ===============================================================================================

describe('the tray tile after the first placement', () => {
  it('renders the count, not a binary ✓', () => {
    expect(tray).toContain('{placements} Placed');
    expect(tray).not.toContain('<Check className="h-2.5 w-2.5" /> Placed\n');
    expect(tray).toContain('placementCountOf');
  });

  it('is NOT dimmed once used', () => {
    expect(tray).not.toContain("placed ? 'opacity-40 saturate-[0.85]'");
  });

  it('stays tap-to-placeable', () => {
    expect(tray).toContain('if (placeable) onPick?.(photo.id);');
    expect(tray).not.toContain('if (placeable && !placed) onPick?.(photo.id);');
  });

  it('stays draggable — placement never touched `draggable`, and still does not', () => {
    // `placeable` is about having something to DRAW, never about having been used already — it
    // was true before this change and stays true, which is why a repeat drag needed no new code.
    expect(tray).toContain('draggable={placeable}');
    expect(read('src/app/(app)/albums/[id]/build/_photo-state.ts')).toMatch(
      /export function isPlaceable\([^)]*\)[^{]*\{\s*[\r\n]+\s*if \(state === 'failed'\) return false;\s*[\r\n]+\s*return resolvePhotoUrl/,
    );
  });

  it('the drag contract still negotiates a single verb, so a repeat drop is never cancelled', () => {
    // The `effectAllowed`/`dropEffect` pair must agree or the browser silently cancels the drop.
    expect(dnd).toContain("e.dataTransfer.effectAllowed = 'move'");
    expect(dnd).toContain("e.dataTransfer.dropEffect = 'move'");
  });
});

// ===============================================================================================
// The wiring that feeds it
// ===============================================================================================

describe('the builder feeds the tray the whole album', () => {
  it('counts pages AND the cover', () => {
    expect(builder).toContain('placementCounts(blocks, coverPlacementIds(coverConfig))');
    expect(builder).toContain('placementCountOf={placementCountOf}');
  });

  it('"remove unused photos" no longer treats a cover-only photo as unused', () => {
    expect(builder).toContain("p.status === 'ready' && placementCountOf(p.id) === 0");
  });

  it('placing a photo no longer strips it from where it already was', () => {
    // `stripPhoto` survives as the DELETION path only — assignment writes one frame.
    expect(state).not.toContain('stripPhoto(prev, photoId)');
    expect(state).toContain('const removePhotoEverywhere = (id: string) => mutate((prev) => stripPhoto(prev, id));');
  });

  it('dropping a DIFFERENT photo into a frame resets that frame\'s edit, and only that frame\'s', () => {
    expect(state).toContain('changed ? withBaseEdit(withPhoto, i, null) : withPhoto');
    expect(state).toContain('...(o.photoId === photoId ? {} : { edit: null })');
  });
});
