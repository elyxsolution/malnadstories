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
  type CoverConfig,
} from '@/lib/builder/cover';
import type { Background } from '@/lib/builder/model';
import {
  addCoverOverlay,
  coverSideElements,
  removeCoverOverlay,
  replaceCoverOverlayPhoto,
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
    expect(cover).toContain('nextOverlayGeom(coverSideElements(prev, side).overlays.length, at)');
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
// C2. THE BACKGROUND SURVIVES EVERY OVERLAY OPERATION
// ===============================================================================================

describe('a back-cover background is not a back-cover overlay', () => {
  /**
   * THE REGRESSION THIS EXISTS FOR. Replace on a selected overlay used to open the FACE picker,
   * and storing a face photo clears `background` — so replacing an overlay erased the customer's
   * colour, and deleting the overlay afterwards revealed a null background, which the renderer
   * draws as the default. One cause, two reports. These are the brief's Cases A–D, run against the
   * real state transitions the hook calls.
   */
  const RED: Background = { kind: 'color', value: '#cc2200' };
  const A = '00000000-0000-4000-8000-0000000000a1';
  const B = '00000000-0000-4000-8000-0000000000b2';
  const C = '00000000-0000-4000-8000-0000000000c3';

  const withRed = (over: Partial<BackCoverConfig> = {}): CoverConfig => ({
    ...DEFAULT_COVER_CONFIG,
    back: back({ background: RED, ...over }),
  });

  /** Everything about the face EXCEPT its overlays — the part every operation must preserve. */
  const faceExceptOverlays = (c: CoverConfig) => {
    const rest = { ...c.back } as Partial<BackCoverConfig>;
    delete rest.overlays;
    return rest;
  };

  it('Case A — ADD keeps the background', () => {
    const before = withRed();
    const after = addCoverOverlay(before, 'back', overlay({ id: 'o1', photoId: A }));
    expect(after.back.background).toEqual(RED);
    expect(after.back.overlays).toHaveLength(1);
    expect(after.back.overlays[0].photoId).toBe(A);
    expect(faceExceptOverlays(after)).toEqual(faceExceptOverlays(before));
  });

  it('Case B — REPLACE keeps the background and changes only that overlay', () => {
    const before = addCoverOverlay(withRed(), 'back', overlay({ id: 'o1', photoId: A, x: 0.2, y: 0.3, w: 0.4, h: 0.3 }));
    const after = replaceCoverOverlayPhoto(before, 'back', 'o1', B);
    expect(after.back.background).toEqual(RED);
    expect(after.back.overlays[0].photoId).toBe(B);
    // Geometry, order and identity are untouched — a replacement is not a re-placement.
    expect(after.back.overlays[0]).toMatchObject({ id: 'o1', x: 0.2, y: 0.3, w: 0.4, h: 0.3 });
    expect(faceExceptOverlays(after)).toEqual(faceExceptOverlays(before));
    // And the BACKDROP is untouched: this is the bug, in two assertions.
    expect(after.back.photoId).toBeNull();
    expect(after.back.imageEdit).toBeNull();
  });

  it('Case C — DROP-TO-REPLACE is the same transition, so it keeps the background too', () => {
    // The drop target calls `replaceOverlay`, which is `replaceCoverOverlayPhoto`. Same path.
    const before = addCoverOverlay(withRed(), 'back', overlay({ id: 'o1', photoId: B }));
    const after = replaceCoverOverlayPhoto(before, 'back', 'o1', C);
    expect(after.back.background).toEqual(RED);
    expect(after.back.overlays[0].photoId).toBe(C);
    expect(after.back.photoId).toBeNull();
  });

  it('Case D — DELETE keeps the background', () => {
    const before = addCoverOverlay(withRed(), 'back', overlay({ id: 'o1', photoId: C }));
    const after = removeCoverOverlay(before, 'back', 'o1');
    expect(after.back.background).toEqual(RED);
    expect(after.back.overlays).toEqual([]);
    expect(faceExceptOverlays(after)).toEqual(faceExceptOverlays(before));
  });

  it('the full A to D sequence never loses the exact colour', () => {
    let c = withRed();
    c = addCoverOverlay(c, 'back', overlay({ id: 'o1', photoId: A }));
    c = replaceCoverOverlayPhoto(c, 'back', 'o1', B);
    c = replaceCoverOverlayPhoto(c, 'back', 'o1', C);
    c = removeCoverOverlay(c, 'back', 'o1');
    expect(c.back.background).toEqual(RED);
    expect(c.back.overlays).toEqual([]);
  });

  it('works for a background IMAGE too, not just a colour', () => {
    const shot: CoverConfig = {
      ...DEFAULT_COVER_CONFIG,
      back: back({ photoId: 'aaaaaaaa-0000-4000-8000-00000000aaaa', imageEdit: { zoom: 1.4 } }),
    };
    let c = addCoverOverlay(shot, 'back', overlay({ id: 'o1', photoId: A }));
    c = replaceCoverOverlayPhoto(c, 'back', 'o1', B);
    c = removeCoverOverlay(c, 'back', 'o1');
    expect(c.back.photoId).toBe('aaaaaaaa-0000-4000-8000-00000000aaaa');
    expect(c.back.imageEdit).toEqual({ zoom: 1.4 });
  });

  it('preserves every OTHER face property and every SIBLING overlay', () => {
    const caption = makeText('subtitle', { id: 'tx1', text: 'KEEP ME' });
    const before: CoverConfig = {
      ...DEFAULT_COVER_CONFIG,
      back: back({ background: RED, texts: [caption], showLogo: true }),
    };
    let c = addCoverOverlay(before, 'back', overlay({ id: 'o1', photoId: A }));
    c = addCoverOverlay(c, 'back', overlay({ id: 'o2', photoId: B, x: 0.5 }));
    const after = removeCoverOverlay(replaceCoverOverlayPhoto(c, 'back', 'o1', C), 'back', 'o2');
    expect(after.back.background).toEqual(RED);
    expect(after.back.texts).toEqual([caption]);
    expect(after.back.showLogo).toBe(true);
    expect(after.back.overlays.map((o) => o.id)).toEqual(['o1']);
    expect(after.back.overlays[0].photoId).toBe(C);
  });

  it('overlay operations never touch the FRONT or the SPINE', () => {
    const before = withRed();
    const after = removeCoverOverlay(addCoverOverlay(before, 'back', overlay()), 'back', 'o1');
    expect(after.background).toBe(before.background);
    expect(after.photoId).toBe(before.photoId);
    expect(after.spine).toEqual(before.spine);
    expect(after.texts).toBe(before.texts);
  });

  it('CONTRAST: setting the face BACKDROP does clear the background — which is why the two must not be confused', () => {
    // Documented, deliberate, and precisely why an overlay action must never reach that path.
    const c = withRed();
    const backdrop = { ...c, back: { ...c.back, photoId: A, background: null } };
    expect(backdrop.back.background).toBeNull();
    // …whereas the overlay path leaves it exactly as it was.
    expect(addCoverOverlay(c, 'back', overlay()).back.background).toEqual(RED);
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

  it('resolves ONE photo target before any command runs, instead of branching per action', () => {
    // `Back cover background ≠ back cover overlay`, as a value. Every photo command reads it.
    expect(hook).toContain('CoverPhotoTarget');
    expect(hook).toContain("kind: 'overlay', overlayId: selection.id, photoId: o.photoId");
    expect(hook).toContain("kind: 'backdrop', photoId: image.photoId");
  });

  /**
   * UPDATED WITH THE PLACEMENT MODEL.
   *
   * This used to assert that a cover overlay's crop went to the `photos` ROW ("exactly as it does
   * for a page overlay"). Both halves of that changed at once, and in the same direction: a page
   * overlay's crop no longer goes to the photos row either. A photo is a reusable source asset, so
   * an adjustment belongs to the CONTAINER — `overlay.edit` — or adjusting the back cover would
   * re-crop every page showing the same image.
   *
   * The distinction the original test was really protecting is untouched and still asserted: a
   * back-cover BACKGROUND is not a back-cover OVERLAY. The backdrop keeps `cover_config.imageEdit`.
   */
  it('routes an overlay photo edit to THAT OVERLAY, not the face backdrop and not the photos row', () => {
    expect(hook).toContain("photoTarget?.kind === 'overlay'");
    // Written to the overlay through the pure, single-patch cover write.
    expect(hook).toContain('patchCoverOverlayEdit');
    expect(hook).toContain('patchOverlayEdit(');
    // Forked from whatever the frame currently shows — its own edit, or the inherited source.
    expect(hook).toContain('forkFrameEdit');
    expect(hook).toContain('sourceEditFor');
    // The backdrop still writes cover_config.imageEdit, and only when the backdrop is the target.
    expect(hook).toContain('patchImageEdit(patch)');
    // The old shared-photo-row route is gone.
    expect(hook).not.toContain('onPhotoRotate');
    expect(builder).not.toContain('applyPhotoEditRef');
  });

  it('describes the SELECTED overlay in the toolbar, not the backdrop', () => {
    // `selectedPhoto` drives the crop/zoom/rotate state the bar displays AND the id it writes to.
    expect(builder).toContain('cover.photoTarget?.photoId');
    expect(builder).not.toContain('const id = cover.image.photoId;');
  });

  it('REPLACE opens the picker for the selected overlay, never for the backdrop', () => {
    // THE BUG: `onReplace: p.onPickPhoto` threw away the overlay id PhotoBar had already supplied,
    // so Replace opened the FACE picker — and storing a face photo clears the face's background.
    expect(bar).toContain('onReplace: (t) => p.onPickPhoto(t.overlayId ? { overlayId: t.overlayId } : undefined)');
    expect(bar).not.toContain('onReplace: p.onPickPhoto,');
  });

  it('CROP opens the overlay AS A PLACEMENT, not the face image editor and not the shared photo', () => {
    expect(builder).toContain("if (t?.kind === 'overlay')");
    // The frame reference is what makes the modal edit THIS placement rather than the photo.
    expect(builder).toContain('openEditor(t.photoId, coverFrameRef)');
    expect(builder).toContain('coverFrameRef');
  });

  /**
   * THE BACK COVER IS NOT A SIMPLIFIED OVERLAY.
   *
   * A page overlay could be press-and-held to adjust the picture inside its frame, showed a centre
   * adjust handle, captured pan/zoom in place and drew the "what am I choosing from" ghost. A cover
   * overlay had none of it — not by decision, but because that chrome lived inside `_block.tsx`.
   * It now lives in `_crop-chrome` and BOTH canvases import the same implementation, so the two
   * cannot drift.
   */
  it('gives a cover overlay the SAME adjustment interactions as a page overlay', () => {
    const chrome = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_crop-chrome.tsx'), 'utf8');
    const block = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_block.tsx'), 'utf8');

    // ONE implementation, imported by both canvases — not copied into either.
    for (const fn of ['AdjustHandle', 'CropLayer', 'CropBleed', 'useCropWheel']) {
      expect(chrome).toContain(`export function ${fn}`);
      expect(block).not.toContain(`function ${fn}(`);
      expect(canvas).not.toContain(`function ${fn}(`);
    }
    expect(block).toContain("from './_crop-chrome'");
    expect(canvas).toContain("from './_crop-chrome'");

    // The cover overlay wires every one of them.
    expect(canvas).toContain('onLongPress=');
    expect(canvas).toContain('<AdjustHandle');
    expect(canvas).toContain('<CropLayer handlers={cropHandlers} />');
    expect(canvas).toContain('<CropBleed');
    expect(canvas).toContain('useCropWheel(ref, !!cropOverlay, cropHandlers)');

    // And it renders THIS placement's edit, like every other surface.
    expect(canvas).toContain('resolveFrameEdit(o.edit, photo.edit)');
  });

  it('drives the cover overlay through the builder\'s ONE crop state, not a second one', () => {
    // Same useCanvasCrop instance; the face addresses itself with the key useCover already
    // mints, so there is one adjustment state, one renderer and one commit path.
    expect(builder).toContain('crop.begin({ blockKey: `cover:${cover.side}`, overlayId, photoId })');
    expect(builder).toContain('cropHandlers={crop.handlers}');
    expect(builder).toContain('cropOverlayId=');
  });

  it('supports DROP-TO-REPLACE through the shared drag contract', () => {
    expect(canvas).toContain('CoverOverlayDrop');
    expect(canvas).toContain('acceptPhotoDrag');
    expect(canvas).toContain('readPhotoDrag');
    expect(canvas).toContain('cover.replaceOverlay(key, oid, id)');
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
