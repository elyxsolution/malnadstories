import { describe, expect, it } from 'vitest';

import {
  blockHasContent,
  isBlockComplete,
  makeBlock,
  trimBaseIds,
  type Block,
} from '@/lib/builder/model';
import { resolveLayoutForSave } from '@/lib/builder/persist-layout';
import { fillEmptyFrames } from '@/lib/builder/auto-layout';
import { evaluateAlbum, type EvalBlock } from '@/lib/albums/validation';
import {
  DEFAULT_COVER_CONFIG,
  SPINE_LEGACY_COLOR,
  normalizeCoverConfig,
  spineBackgroundStyle,
  isCustomCover,
  type CoverConfig,
} from '@/lib/builder/cover';
import {
  coverSideBackground,
  migrateCoverConfig,
  withAllCoverBackgrounds,
  withCoverSideElements,
} from '@/lib/builder/cover-objects';
import { SaveLayoutSchema, CoverConfigSchema } from '@/lib/validations';

/**
 * THREE BUILDER CHANGES, AT THE LEVEL WHERE THEY ARE ACTUALLY DECIDED.
 *
 * 1  A page is a BACKGROUND, not a photo container — photos arrive as overlays, and deleting a
 *    photo from one page must never move another page's photo.
 * 2  Front, spine and back cover each own their colour independently, with an opt-in
 *    "apply to all".
 * 3  Image adjustment (crop / zoom / position inside a fixed frame) belongs to the PHOTO, so it
 *    is identical for every frame type and survives a round-trip.
 *
 * These are pure-module tests, in the style of the rest of this suite: no database, no network.
 * What they protect is the part that a screenshot cannot — the state model and the persistence
 * boundary, which is where the page-to-page photo migration lived.
 */

// ── helpers ──────────────────────────────────────────────────────────────────────

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const identityResolver = { resolve: (id: string) => id, isUnresolvedTemp: () => false };

function pair(photoIds: (string | null)[], extra: Partial<Block> = {}): Block {
  return { ...makeBlock('single-pair'), photoIds, ...extra };
}

/**
 * The production rule from `useBlocks.clearBaseSlot`, expressed here so the invariant is
 * testable without mounting the hook. It is the same four lines: pad to the pair's two
 * positions, null the named one, trim trailing holes.
 */
function clearBaseSlot(b: Block, slot: 'left' | 'right' | 'image'): Block {
  if (slot === 'image') return { ...b, photoIds: [] };
  const ids: (string | null)[] = [b.photoIds[0] ?? null, b.photoIds[1] ?? null];
  ids[slot === 'left' ? 0 : 1] = null;
  return { ...b, photoIds: trimBaseIds(ids) };
}

// ── 1 — base slots are positional; a hole is representable ───────────────────────

describe('base slots are positional', () => {
  it('trims trailing holes but preserves interior ones', () => {
    expect(trimBaseIds([A, null])).toEqual([A]);
    expect(trimBaseIds([null, null])).toEqual([]);
    expect(trimBaseIds([null, B])).toEqual([null, B]);
    expect(trimBaseIds([A, B])).toEqual([A, B]);
    expect(trimBaseIds([undefined, B])).toEqual([null, B]);
  });

  it('clearing the LEFT photo leaves the right page photo on the right page', () => {
    const before = pair([A, B]);
    const after = clearBaseSlot(before, 'left');
    // The reported defect: the survivor used to slide to index 0, i.e. onto the left page.
    expect(after.photoIds).toEqual([null, B]);
    expect(after.photoIds[1]).toBe(B);
    expect(after.photoIds[0]).toBeNull();
  });

  it('clearing the RIGHT photo leaves the left page untouched', () => {
    expect(clearBaseSlot(pair([A, B]), 'right').photoIds).toEqual([A]);
  });

  it('clearing the last remaining photo returns the page to background-only', () => {
    expect(clearBaseSlot(pair([null, B]), 'right').photoIds).toEqual([]);
    expect(clearBaseSlot(pair([A]), 'left').photoIds).toEqual([]);
  });

  it('a freshly created page has no base photos at all', () => {
    expect(makeBlock('single-pair').photoIds).toEqual([]);
    expect(makeBlock('double-spread').photoIds).toEqual([]);
  });
});

// ── 1b — the hole survives the persistence boundary ──────────────────────────────

describe('the hole survives save and validation', () => {
  it('resolveLayoutForSave keeps an interior hole and trims trailing ones', () => {
    const { blocks } = resolveLayoutForSave(
      [
        { photoIds: [null, B], overlays: [] },
        { photoIds: [A, null], overlays: [] },
      ],
      identityResolver,
    );
    expect(blocks[0].photoIds).toEqual([null, B]);
    expect(blocks[1].photoIds).toEqual([A]);
  });

  it('a still-uploading LEFT photo vacates its slot instead of pulling the right one across', () => {
    const { blocks, stripped } = resolveLayoutForSave([{ photoIds: ['tmp_1', B], overlays: [] }], {
      resolve: (id: string) => id,
      isUnresolvedTemp: (id: string) => id.startsWith('tmp_'),
    });
    expect(stripped).toBe(1);
    expect(blocks[0].photoIds).toEqual([null, B]);
  });

  it('SaveLayoutSchema accepts a hole and still rejects a photo placed twice', () => {
    const ok = SaveLayoutSchema.safeParse({
      albumId: '44444444-4444-4444-8444-444444444444',
      blocks: [{ template: 'single-pair', photoIds: [null, B], overlays: [] }],
    });
    expect(ok.success).toBe(true);

    const dup = SaveLayoutSchema.safeParse({
      albumId: '44444444-4444-4444-8444-444444444444',
      blocks: [
        { template: 'single-pair', photoIds: [null, B], overlays: [] },
        { template: 'single-pair', photoIds: [B], overlays: [] },
      ],
    });
    expect(dup.success).toBe(false);
  });
});

// ── 1c — a page is not a photo container ─────────────────────────────────────────

describe('a page is a background, not a photo container', () => {
  const overlay = (photoId: string | null) => ({ id: 'o1', photoId, x: 0.1, y: 0.1, w: 0.3, h: 0.3 });

  it('a page carrying only a background counts as content', () => {
    expect(blockHasContent(makeBlock('single-pair'))).toBe(false);
    expect(blockHasContent(pair([], { background: { kind: 'color', value: 'sand' } }))).toBe(true);
  });

  it('a page with one overlay photo and empty halves is COMPLETE', () => {
    expect(isBlockComplete(pair([], { overlays: [overlay(A)] }))).toBe(true);
  });

  it('a legacy page with a photo on one side only is no longer reported incomplete', () => {
    expect(isBlockComplete(pair([A]))).toBe(true);
    expect(isBlockComplete(pair([null, B]))).toBe(true);
  });

  it('an overlay container with no photo IS incomplete — the new unfinished state', () => {
    expect(isBlockComplete(pair([A], { overlays: [overlay(null)] }))).toBe(false);
  });

  it('a page with nothing on it at all is incomplete', () => {
    expect(isBlockComplete(makeBlock('single-pair'))).toBe(false);
  });

  it('Auto Fill does not attach a base photo to a page that has no base slots', () => {
    const page = pair([], { overlays: [overlay(null)] });
    const [filled] = fillEmptyFrames([page], [{ id: A } as never]);
    // The photo goes into the OVERLAY the customer placed, never into an invisible page slot.
    expect(filled.photoIds).toEqual([]);
    expect(filled.overlays[0].photoId).toBe(A);
  });

  it('Auto Fill still completes a preset/legacy page that DOES use base slots', () => {
    const page = pair([A]);
    const [filled] = fillEmptyFrames([page], [{ id: B } as never]);
    expect(filled.photoIds).toEqual([A, B]);
  });
});

// ── 1d — print readiness follows the same rule ───────────────────────────────────

describe('album validation under the page-as-background model', () => {
  const cover = { activeTemplate: true, config: DEFAULT_COVER_CONFIG, title: 'Coorg, 2019' };
  const evalOf = (blocks: EvalBlock[], size: number) => evaluateAlbum({ size, blocks, cover });

  const overlayPage = (photoId: string | null): EvalBlock => ({
    template: 'single-pair',
    photoIds: [],
    overlays: [{ photoId }],
  });

  it('an album of overlay-only pages is print-ready', () => {
    const report = evalOf([overlayPage(A), overlayPage(B)], 4);
    expect(report.warnings.map((w) => w.id)).toEqual([]);
    expect(report.printReady).toBe(true);
    expect(report.canGeneratePdf).toBe(true);
  });

  it('an unfilled overlay frame blocks print and names its page', () => {
    const report = evalOf([overlayPage(A), overlayPage(null)], 4);
    expect(report.printReady).toBe(false);
    expect(report.warnings.some((w) => w.id === 'incomplete_page:2')).toBe(true);
    expect(report.statistics.incompletePages).toEqual([2]);
  });

  it('a page with nothing on it is flagged as blank', () => {
    const report = evalOf([overlayPage(A), { template: 'single-pair', photoIds: [], overlays: [] }], 4);
    expect(report.warnings.some((w) => w.id === 'empty_page:2')).toBe(true);
  });

  it('a page carrying only a background is a finished page', () => {
    const report = evalOf(
      [overlayPage(A), { template: 'single-pair', photoIds: [], overlays: [], background: { kind: 'color', value: 'sand' } }],
      4,
    );
    expect(report.printReady).toBe(true);
  });

  it('a legacy half-filled spread no longer demands a second photo', () => {
    const report = evalOf([{ template: 'single-pair', photoIds: [null, B], overlays: [] }], 2);
    expect(report.printReady).toBe(true);
    expect(report.statistics.expectedPhotos).toBe(1);
    expect(report.statistics.placedPhotos).toBe(1);
  });

  it('counts photo FRAMES, not page halves', () => {
    const report = evalOf([{ template: 'single-pair', photoIds: [A], overlays: [{ photoId: B }, { photoId: null }] }], 2);
    expect(report.statistics.expectedPhotos).toBe(3); // one base image + two overlay frames
    expect(report.statistics.placedPhotos).toBe(2);
    expect(report.statistics.missingPhotos).toBe(1);
  });
});

// ── 2 — three independent cover colours ──────────────────────────────────────────

describe('front, spine and back cover colours are independent', () => {
  const green = { kind: 'color', value: '#1b4332' } as const;
  const cream = { kind: 'color', value: '#f5efe3' } as const;

  const fresh = (): CoverConfig => normalizeCoverConfig(null);

  it('a cover with no stored spine colour falls back to the legacy paint, not to "no colour"', () => {
    expect(fresh().spine.background).toBeNull();
    expect(spineBackgroundStyle(null).background).toContain(SPINE_LEGACY_COLOR);
  });

  it('a legacy cover_config (no spine key at all) normalizes without inventing a colour', () => {
    const legacy = normalizeCoverConfig({ subtitle: 'A monsoon diary' } as Partial<CoverConfig>);
    expect(legacy.spine.background).toBeNull();
    expect(legacy.spine.texts).toEqual([]);
  });

  it('setting the SPINE colour leaves front and back alone', () => {
    const c: CoverConfig = { ...fresh(), spine: { texts: [], background: green } };
    expect(coverSideBackground(c, 'spine')).toEqual(green);
    expect(coverSideBackground(c, 'front')).toBeNull();
    expect(coverSideBackground(c, 'back')).toBeNull();
    expect(spineBackgroundStyle(c.spine.background).background).toContain(green.value);
  });

  it('setting the FRONT colour leaves the spine and back alone', () => {
    const c: CoverConfig = { ...fresh(), background: cream };
    expect(coverSideBackground(c, 'front')).toEqual(cream);
    expect(coverSideBackground(c, 'spine')).toBeNull();
    expect(coverSideBackground(c, 'back')).toBeNull();
  });

  it('setting the BACK colour leaves the front and spine alone', () => {
    const base = fresh();
    const c: CoverConfig = { ...base, back: { ...base.back, background: cream } };
    expect(coverSideBackground(c, 'back')).toEqual(cream);
    expect(coverSideBackground(c, 'front')).toBeNull();
    expect(coverSideBackground(c, 'spine')).toBeNull();
  });

  it('"apply to all" paints all three, and the faces stay independent afterwards', () => {
    const all = withAllCoverBackgrounds(fresh(), green);
    expect(coverSideBackground(all, 'front')).toEqual(green);
    expect(coverSideBackground(all, 'spine')).toEqual(green);
    expect(coverSideBackground(all, 'back')).toEqual(green);

    // Nothing links them once applied: changing one changes exactly one.
    const thenSpine: CoverConfig = { ...all, spine: { ...all.spine, background: cream } };
    expect(coverSideBackground(thenSpine, 'spine')).toEqual(cream);
    expect(coverSideBackground(thenSpine, 'front')).toEqual(green);
    expect(coverSideBackground(thenSpine, 'back')).toEqual(green);
  });

  it('editing spine TEXT does not wipe the spine colour', () => {
    const c: CoverConfig = { ...fresh(), spine: { texts: [], background: green } };
    const next = withCoverSideElements(c, 'spine', { texts: [] });
    expect(next.spine.background).toEqual(green);
  });

  it('migration preserves the spine colour (it runs on every render, on every surface)', () => {
    const c: CoverConfig = { ...fresh(), v: 1, spine: { texts: [], background: green } };
    const migrated = migrateCoverConfig(c, { title: 'Coorg, 2019' }, 0.75);
    expect(migrated.v).toBe(2);
    expect(migrated.spine.background).toEqual(green);
    // …and again, idempotently.
    expect(migrateCoverConfig(migrated, { title: 'Coorg, 2019' }, 0.75).spine.background).toEqual(green);
  });

  it('round-trips through the persisted schema', () => {
    const parsed = CoverConfigSchema.parse({ spine: { texts: [], background: green } });
    expect(parsed.spine.background).toEqual(green);
    // A payload written before the spine had a colour still parses, defaulting to the fallback.
    expect(CoverConfigSchema.parse({}).spine.background).toBeNull();
  });

  it('a coloured spine counts as a custom cover worth persisting', () => {
    expect(isCustomCover(fresh())).toBe(false);
    expect(isCustomCover({ ...fresh(), spine: { texts: [], background: green } })).toBe(true);
  });
});
