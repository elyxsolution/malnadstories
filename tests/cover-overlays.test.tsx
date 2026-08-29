/**
 * BACK-COVER PHOTO OVERLAYS — the same overlay, on a face instead of a spread.
 *
 * The requirement was "add a picture to the back cover and move it around", and the honest test of
 * whether that was built as a FEATURE or as a back-cover SPECIAL CASE is whether the same types,
 * the same geometry rule, the same schema and the same renderer carry it. That is what this suite
 * checks, alongside the round trip that decides whether a customer's design survives a reload:
 *
 *     add → fill with a photo → move/resize → SAVE (Zod) → reload (normalize) → render
 *
 * It renders the real `BackCoverDesign` with `react-dom/server`, so the assertions about what an
 * overlay looks like are made against the markup a browser and Chromium both receive.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  DEFAULT_BACK_COVER,
  isCustomCover,
  normalizeBackCover,
  normalizeCoverConfig,
  DEFAULT_COVER_CONFIG,
  type BackCoverConfig,
} from '@/lib/builder/cover';
import {
  coverSideElements,
  withCoverOverlayIds,
  withCoverSideElements,
  COVER_SIDES,
} from '@/lib/builder/cover-objects';
import { DEFAULT_OVERLAY_GEOM, MAX_OVERLAYS_PER_BLOCK, nextOverlayGeom, type Overlay } from '@/lib/builder/model';
import { makeText } from '@/lib/builder/elements';
import { CoverConfigSchema } from '@/lib/validations';
import { hasBackCover } from '@/lib/albums/cover';
import { BackCoverDesign } from '@/app/(app)/albums/[id]/build/_cover-render';

const overlay = (over: Partial<Overlay> = {}): Overlay => ({
  id: 'o1',
  photoId: '00000000-0000-4000-8000-0000000000a1',
  ...DEFAULT_OVERLAY_GEOM,
  ...over,
});

const back = (over: Partial<BackCoverConfig> = {}): BackCoverConfig => ({ ...DEFAULT_BACK_COVER, ...over });

// ===============================================================================================
// A. It is the SAME overlay, not a back-cover invention
// ===============================================================================================

describe('the back cover stores ordinary overlays', () => {
  it('a fresh back cover has an empty overlay array, like a fresh page', () => {
    expect(DEFAULT_BACK_COVER.overlays).toEqual([]);
  });

  it('reads and writes through the SAME per-face accessors as text, stickers and QR', () => {
    const cfg = { ...DEFAULT_COVER_CONFIG, back: back({ overlays: [overlay()] }) };
    expect(coverSideElements(cfg, 'back').overlays).toHaveLength(1);

    const cleared = withCoverSideElements(cfg, 'back', { overlays: [] });
    expect(coverSideElements(cleared, 'back').overlays).toEqual([]);
    // The other families are untouched by an overlay write.
    expect(cleared.back.texts).toBe(cfg.back.texts);
    expect(cleared.back.stickers).toBe(cfg.back.stickers);
  });

  it('every face answers the overlay question, so nothing above it needs a face branch', () => {
    const cfg = { ...DEFAULT_COVER_CONFIG, back: back({ overlays: [overlay()] }) };
    for (const side of COVER_SIDES) expect(Array.isArray(coverSideElements(cfg, side).overlays)).toBe(true);
    // Only the back STORES them today (see BackCoverConfig.overlays for why).
    expect(coverSideElements(cfg, 'front').overlays).toEqual([]);
    expect(coverSideElements(cfg, 'spine').overlays).toEqual([]);
  });

  it('a face that stores no overlays silently ignores a write rather than growing a stray field', () => {
    const cfg = withCoverSideElements(DEFAULT_COVER_CONFIG, 'front', { overlays: [overlay()] });
    expect('overlays' in cfg).toBe(false);
    expect(coverSideElements(cfg, 'front').overlays).toEqual([]);
  });
});

// ===============================================================================================
// B. Geometry comes from the shared rule
// ===============================================================================================

describe('a new overlay lands somewhere sensible, from the one shared rule', () => {
  it('is on the surface, non-zero, and not the whole cover', () => {
    const g = nextOverlayGeom(0);
    expect(g.w).toBeGreaterThan(0);
    expect(g.h).toBeGreaterThan(0);
    expect(g.w).toBeLessThan(1);
    expect(g.h).toBeLessThan(1);
    expect(g.x).toBeGreaterThanOrEqual(0);
    expect(g.y).toBeGreaterThanOrEqual(0);
    expect(g.x + g.w).toBeLessThanOrEqual(1);
    expect(g.y + g.h).toBeLessThanOrEqual(1);
  });

  it('the first frame IS the documented default — the cover did not fork the constant', () => {
    expect(nextOverlayGeom(0)).toEqual({ ...DEFAULT_OVERLAY_GEOM });
  });

  it('cascades so a second frame is visibly a second frame', () => {
    const a = nextOverlayGeom(0);
    const b = nextOverlayGeom(1);
    expect(b.x === a.x && b.y === a.y).toBe(false);
    expect(b.w).toBe(a.w);
    expect(b.h).toBe(a.h);
  });

  it("centres on the caller's anchor when one is given, and stays on the surface", () => {
    const g = nextOverlayGeom(2, 'center');
    expect(g.x + g.w / 2).toBeCloseTo(0.5 + ((2 % 5) - 2) * 0.035, 10);
    const corner = nextOverlayGeom(0, { x: 0.02, y: 0.02 });
    expect(corner.x).toBeGreaterThanOrEqual(0);
    expect(corner.y).toBeGreaterThanOrEqual(0);
  });

  it('the page canvas draws from the same function, so the two cannot drift', () => {
    const src = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_use-builder.ts'), 'utf8');
    expect(src).toContain('nextOverlayGeom(b.overlays.length, at)');
    const cover = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_use-cover.ts'), 'utf8');
    expect(cover).toContain('nextOverlayGeom(existing.length, at)');
  });
});

// ===============================================================================================
// C. Persistence: save → reload → render
// ===============================================================================================

describe('an overlay survives the round trip', () => {
  const placed = overlay({ x: 0.2, y: 0.3, w: 0.45, h: 0.25 });

  it('passes the SAVE schema, with the page overlay rules applied unchanged', () => {
    const parsed = CoverConfigSchema.safeParse({ ...DEFAULT_COVER_CONFIG, back: back({ overlays: [placed] }) });
    expect(parsed.success).toBe(true);
    const saved = parsed.success ? parsed.data.back.overlays[0] : null;
    expect(saved).toMatchObject({ photoId: placed.photoId, x: 0.2, y: 0.3, w: 0.45, h: 0.25 });
  });

  it('does NOT persist the client-only id, exactly as a page overlay does not', () => {
    const parsed = CoverConfigSchema.parse({ ...DEFAULT_COVER_CONFIG, back: back({ overlays: [placed] }) });
    expect('id' in parsed.back.overlays[0]).toBe(false);
  });

  it('regains an id on load, so selection and layering have something to name', () => {
    const cfg = { ...DEFAULT_COVER_CONFIG, back: back({ overlays: [{ ...placed, id: undefined }] }) };
    const withIds = withCoverOverlayIds(cfg);
    expect(withIds.back.overlays[0].id).toBeTruthy();
    // Stable: nothing to do returns the same reference, so it is safe on every state entry.
    expect(withCoverOverlayIds(withIds)).toBe(withIds);
  });

  it('refuses a forged payload the same way a page does', () => {
    const bad = (o: unknown) => CoverConfigSchema.safeParse({ ...DEFAULT_COVER_CONFIG, back: back({ overlays: [o as Overlay] }) }).success;
    expect(bad({ ...placed, w: 0 })).toBe(false); // zero-size
    expect(bad({ ...placed, w: 2 })).toBe(false); // larger than the surface
    expect(bad({ ...placed, photoId: 'not-a-uuid' })).toBe(false);
    // The cap is the page's cap, imported rather than restated.
    const many = Array.from({ length: MAX_OVERLAYS_PER_BLOCK + 1 }, () => placed);
    expect(CoverConfigSchema.safeParse({ ...DEFAULT_COVER_CONFIG, back: back({ overlays: many }) }).success).toBe(false);
  });

  it('a cover saved before overlays existed loads as "no overlays", never broken', () => {
    expect(normalizeBackCover({ photoId: null } as Partial<BackCoverConfig>).overlays).toEqual([]);
    expect(normalizeBackCover(null).overlays).toEqual([]);
    expect(normalizeCoverConfig({ back: {} as BackCoverConfig }).back.overlays).toEqual([]);
  });

  it('counts as a real design, so it is persisted and printed rather than treated as pristine', () => {
    const cfg = { ...DEFAULT_COVER_CONFIG, back: back({ overlays: [placed] }) };
    expect(isCustomCover(cfg)).toBe(true);
    expect(hasBackCover({ config: cfg } as Parameters<typeof hasBackCover>[0])).toBe(true);
    expect(isCustomCover(DEFAULT_COVER_CONFIG)).toBe(false);
  });
});

// ===============================================================================================
// D. What it looks like — a plain image, and nothing else
// ===============================================================================================

describe('a back-cover overlay renders as a plain image', () => {
  const photoFor = (id: string | null | undefined) =>
    id === '00000000-0000-4000-8000-0000000000a1'
      ? { url: 'https://r2.test/back.jpg', edit: null }
      : undefined;

  const html = renderToStaticMarkup(
    React.createElement(BackCoverDesign, {
      back: back({ overlays: [overlay({ x: 0.2, y: 0.3, w: 0.45, h: 0.25 })] }),
      imageUrl: null,
      photoFor,
    }),
  );

  it('renders the image the customer chose', () => {
    expect(html).toContain('https://r2.test/back.jpg');
  });

  it('has NO white border, outline, shadow or radius — the Part 9 rule holds here too', () => {
    expect(html).not.toContain('border-white');
    expect(html).not.toContain('border-2');
    expect(html).not.toMatch(/class="[^"]*shadow[ "-]/);
    expect(html).not.toMatch(/class="[^"]*rounded/);
    expect(html).not.toMatch(/class="[^"]*outline/);
  });

  it('is the SAME container a page overlay uses — positioned and clipped, nothing more', () => {
    expect(html).toContain('class="absolute overflow-hidden" style="left:20%;top:30%;width:45%;height:25%"');
  });

  it('lets the photo reach every edge of its frame', () => {
    expect(html).toContain('class="absolute inset-0 h-full w-full select-none object-cover"');
  });

  it('draws NOTHING for an unfilled frame — a placeholder must never print', () => {
    const empty = renderToStaticMarkup(
      React.createElement(BackCoverDesign, {
        back: back({ overlays: [overlay({ photoId: null })] }),
        imageUrl: null,
        photoFor,
      }),
    );
    expect(empty).not.toContain('overflow-hidden" style="left:');
  });

  it('draws nothing for a photo that has since been deleted', () => {
    const gone = renderToStaticMarkup(
      React.createElement(BackCoverDesign, {
        back: back({ overlays: [overlay({ photoId: '00000000-0000-4000-8000-0000000000ff' })] }),
        imageUrl: null,
        photoFor,
      }),
    );
    expect(gone).not.toContain('r2.test');
  });

  it('renders nothing when the host supplies no resolver, instead of throwing', () => {
    const noResolver = renderToStaticMarkup(
      React.createElement(BackCoverDesign, { back: back({ overlays: [overlay()] }), imageUrl: null }),
    );
    expect(noResolver).not.toContain('img');
  });

  it('sits ABOVE the face backdrop and BELOW the text, matching the page stacking order', () => {
    const caption = makeText('subtitle', { id: 'tx1', text: 'A CAPTION ON THE BACK' });
    const stacked = renderToStaticMarkup(
      React.createElement(BackCoverDesign, {
        back: back({ overlays: [overlay()], texts: [caption] }),
        imageUrl: 'https://r2.test/backdrop.jpg',
        photoFor,
      }),
    );
    // Render order IS stacking order: backdrop, then overlays, then text/QR/stickers.
    expect(stacked.indexOf('backdrop.jpg')).toBeLessThan(stacked.indexOf('back.jpg'));
    expect(stacked.indexOf('back.jpg')).toBeLessThan(stacked.indexOf('A CAPTION ON THE BACK'));
  });
});

// ===============================================================================================
// E. Editing: the shared machinery, not a cover-only copy
// ===============================================================================================

describe('editing a back-cover overlay reuses what already exists', () => {
  const canvas = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_cover-canvas.tsx'), 'utf8');
  const hook = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_use-cover.ts'), 'utf8');
  const bar = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_cover-bar.tsx'), 'utf8');
  const builder = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_builder.tsx'), 'utf8');

  it('the Back Cover offers an Add overlay action', () => {
    expect(bar).toContain('Add overlay');
    expect(bar).toContain('onAddOverlay');
  });

  it('the action creates a container and opens the EXISTING album photo picker', () => {
    expect(builder).toContain("cover.addOverlay(null, 'center')");
    expect(builder).toContain("target: 'overlay'");
    expect(builder).toContain('cover.replaceOverlay(');
    // One picker component for cover photos, page photos and overlays.
    expect(builder).toContain('<PhotoPicker');
  });

  it('moves and resizes through the SAME Movable engine every other object uses', () => {
    expect(canvas).toContain('ariaLabel="Photo overlay"');
    expect(canvas).toContain('cover.patchOverlays(key,');
    expect(canvas).toContain('escape={PASTEBOARD_ESCAPE}');
  });

  it('is selectable, layerable and deletable through the existing command paths', () => {
    expect(canvas).toContain("pick({ kind: 'overlay', id: oid })");
    expect(hook).toContain("if (target.kind === 'overlay')");
    expect(hook).toContain("selection.kind === 'overlay') removeOverlay(key, selection.id)");
    expect(hook).toContain("selection.kind === 'overlay' ||");
  });

  it('carries no frame on the editing canvas either', () => {
    expect(canvas).toContain('className="overflow-hidden"');
    expect(canvas).not.toContain('border-2 border-white');
    expect(canvas).not.toContain('shadow-md');
  });

  it('routes an overlay photo edit to the PHOTOS row, not the face backdrop', () => {
    // The backdrop's crop lives in cover_config.imageEdit; a placed photo's lives on the photo,
    // exactly as it does for a page overlay. Without this the toolbar would edit the wrong thing.
    expect(hook).toContain('overlayPhotoId');
    expect(hook).toContain('onPhotoEdit');
    expect(builder).toContain('applyPhotoEditRef.current = cmd.applyPhotoEdit');
  });

  it('the shared PhotoBar reaches it through the cover block adapter, unmodified', () => {
    expect(hook).toContain('overlays: elements.overlays');
    expect(hook).toContain('duplicateOverlay,');
    expect(hook).toContain('patchOverlays,');
  });
});

// ===============================================================================================
// F. It reaches the printed cover
// ===============================================================================================

describe('the printed cover carries the overlay too', () => {
  const printData = readFileSync(resolve(__dirname, '../src/lib/pdf/print-data.ts'), 'utf8');
  const printCover = readFileSync(resolve(__dirname, '../src/app/albums/[id]/print/cover/_print-cover.tsx'), 'utf8');

  it('the cover-only export resolves the photos its overlays place', () => {
    // The cover export deliberately skips the album's photo set, so these are read on their own.
    expect(printData).toContain('coverPhotos');
    expect(printData).toContain('coverConfig.back.overlays.map((o) => o.photoId)');
    // Same rule as every other printed photo: only the sanitized master of a `ready` row.
    expect(printData).toContain("eq('status', 'ready')");
  });

  it('the render-readiness gate counts them, so Chromium waits for the images', () => {
    expect(printCover).toContain('faceOverlays');
    expect(printCover).toContain('2 + faceStickers + faceOverlays');
  });

  it('counts only the overlays that RESOLVE, so a deleted photo cannot hang the render', () => {
    expect(printCover).toContain('o.photoId && coverPhotos[o.photoId]');
  });
});
