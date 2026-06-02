/**
 * Album builder — shared model.
 *
 * Pure types + helpers used by BOTH the server actions (validation, accounting,
 * submit gating) and the client builder UI (state, rendering). No I/O, no
 * 'server-only' / 'use client' — safe to import anywhere, and the future PDF
 * worker can reuse the render helpers verbatim.
 *
 * Placement model: each uploaded photo is placed AT MOST ONCE — as a base OR as an
 * overlay — so per-photo edits live on `photos.edit_config`, not per-slot.
 */

export const LAYOUT_TEMPLATES = ['single-full', 'spread-full'] as const;
export type LayoutTemplate = (typeof LAYOUT_TEMPLATES)[number];

/** Physical leaves each template consumes. spread spans two, single one. */
export const PAGE_COST: Record<LayoutTemplate, number> = {
  'single-full': 1,
  'spread-full': 2,
};

export const TEMPLATE_LABEL: Record<LayoutTemplate, string> = {
  'single-full': 'Single page',
  'spread-full': 'Full spread',
};

/**
 * Max photos uploadable per album, keyed by album size (pages). With generic
 * overlays a page can use more than one photo, so the cap is higher than the page
 * count. Falls back to ~2× for any size not in the table.
 */
export const PHOTO_CAP: Record<number, number> = { 24: 50, 36: 75, 48: 100 };

export function photoCap(size: number): number {
  return PHOTO_CAP[size] ?? size * 2;
}

/** Non-destructive edit applied at render time. R2 originals are never modified. */
export type Rect = { x: number; y: number; w: number; h: number };

export type EditConfig = {
  crop?: Rect; // free crop, normalized to the oriented (rotate+flip) image; default = full
  rotate?: 0 | 90 | 180 | 270; // coarse rotation, 90° steps
  tilt?: number; // fine straighten, degrees (-15..15), applied to the framed crop
  flipH?: boolean;
  flipV?: boolean;
  brightness?: number; // 1 = no change (CSS filter)
  sharpness?: number; // 0 = no change (SVG feConvolveMatrix amount)
};

export const FULL_CROP: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** An overlay photo on a block: its photo + normalized rect (0..1 of the page box). */
export type Overlay = { photoId: string; x: number; y: number; w: number; h: number };

/** Geometry for a freshly added overlay (no photo yet — caller sets photoId). */
export const DEFAULT_OVERLAY_GEOM = { x: 0.55, y: 0.08, w: 0.34, h: 0.34 };

/** Hard cap on overlays per block — UI is unlimited, this rejects abusive payloads. */
export const MAX_OVERLAYS_PER_BLOCK = 50;

/** One layout block in the working builder state. */
export type Block = {
  key: string; // client-side id; not persisted (page_number is the persisted order)
  template: LayoutTemplate;
  photoIds: string[]; // base slot only: [] or [baseId]
  caption: string;
  overlays: Overlay[];
};

// ── Accounting ───────────────────────────────────────────────────────────────

export function pagesConsumed(blocks: Block[]): number {
  return blocks.reduce((sum, b) => sum + PAGE_COST[b.template], 0);
}

/** Can a block of `template` be appended without exceeding the album size? */
export function canAdd(blocks: Block[], size: number, template: LayoutTemplate): boolean {
  return pagesConsumed(blocks) + PAGE_COST[template] <= size;
}

/** Complete = the base slot is filled. Overlays are optional and never gate submit. */
export function isBlockComplete(b: Block): boolean {
  return !!b.photoIds[0];
}

/** Album is submittable: leaves exactly match size AND every base slot is filled. */
export function isAlbumComplete(blocks: Block[], size: number): boolean {
  return blocks.length > 0 && pagesConsumed(blocks) === size && blocks.every(isBlockComplete);
}

/** Every placed photo id — base slots ∪ overlays (a photo appears at most once). */
export function placedPhotoIds(blocks: Block[]): Set<string> {
  const set = new Set<string>();
  for (const b of blocks) {
    for (const id of b.photoIds) if (id) set.add(id);
    for (const o of b.overlays) if (o.photoId) set.add(o.photoId);
  }
  return set;
}

/** Physical leaf number a block starts at (1-based), walking templates in order. */
export function physicalStart(blocks: Block[], index: number): number {
  let leaf = 1;
  for (let i = 0; i < index; i++) leaf += PAGE_COST[blocks[i].template];
  return leaf;
}

// ── Rendering (single source of truth) ───────────────────────────────────────

export type FrameLayout = {
  // The "image footprint": the whole oriented image, scaled so the crop fills the
  // frame, positioned so the crop is centered. overflow on the frame clips the rest.
  layer: { left: number; top: number; width: number; height: number };
  // The <img> inside the footprint: centered (translate -50%/-50%) then rotated/flipped.
  img: { width: number; height: number; transform: string };
};

/**
 * Maps an EditConfig onto a cover-filled frame. Pure + deterministic from
 * (frame px, natural px, edit) so the editor preview, every render surface, and the
 * future PDF worker compute the SAME geometry. Returns null until both the frame is
 * measured and the image's natural size is known (caller shows a plain cover fit).
 *
 * Order: crop is taken on the oriented (rotate 90° + flip) image; tilt then
 * straightens the framed crop (extra rotation + a small cover boost so corners stay
 * filled). Flip is composed into the <img> transform so it interacts with crop
 * identically here and in the editor.
 */
export function computeFrameLayout(
  frameW: number,
  frameH: number,
  natW: number,
  natH: number,
  e: EditConfig | null | undefined,
): FrameLayout | null {
  if (frameW <= 0 || frameH <= 0 || natW <= 0 || natH <= 0) return null;

  const rotate = e?.rotate ?? 0;
  const tilt = e?.tilt ?? 0;
  const crop = e?.crop ?? FULL_CROP;
  const flipH = e?.flipH ?? false;
  const flipV = e?.flipV ?? false;

  // Oriented natural size (90/270 swaps width/height).
  const quarter = rotate === 90 || rotate === 270;
  const ow = quarter ? natH : natW;
  const oh = quarter ? natW : natH;

  const cropPxW = Math.max(1e-6, crop.w * ow);
  const cropPxH = Math.max(1e-6, crop.h * oh);

  const tiltCover = 1 + Math.min(Math.abs(tilt) / 15, 1) * 0.18;
  const s = Math.max(frameW / cropPxW, frameH / cropPxH) * tiltCover;

  const Lw = ow * s;
  const Lh = oh * s;

  const left = (frameW - crop.w * Lw) / 2 - crop.x * Lw;
  const top = (frameH - crop.h * Lh) / 2 - crop.y * Lh;

  // The <img> drawn unrotated, then rotated to fill the footprint. For 90/270 the
  // unrotated element is Lh×Lw so that a 90° rotation yields the Lw×Lh footprint.
  const imgW = quarter ? Lh : Lw;
  const imgH = quarter ? Lw : Lh;
  const sx = flipH ? -1 : 1;
  const sy = flipV ? -1 : 1;
  const transform = `translate(-50%, -50%) rotate(${rotate + tilt}deg) scale(${sx}, ${sy})`;

  return { layer: { left, top, width: Lw, height: Lh }, img: { width: imgW, height: imgH, transform } };
}

/**
 * CSS `filter` for a frame. Brightness is always cheap; the SVG sharpen convolution
 * is attached ONLY when sharpness > 0 so default frames pay nothing (important in
 * the preview, where many frames render at once).
 */
export function cssFilter(e: EditConfig | null | undefined, sharpenId: string): string {
  const brightness = e?.brightness ?? 1;
  const parts: string[] = [];
  if (brightness !== 1) parts.push(`brightness(${brightness})`);
  if ((e?.sharpness ?? 0) > 0) parts.push(`url(#${sharpenId})`);
  return parts.length ? parts.join(' ') : 'none';
}

/**
 * 3×3 sharpen kernel for SVG feConvolveMatrix. a = sharpness amount; a=0 is identity.
 * Kernel sums to 1 so the divisor is 1 (brightness preserved). Returned as the
 * space-separated string feConvolveMatrix expects. Shared so the worker can rebuild
 * the same filter server-side.
 */
export function sharpenKernel(sharpness: number): string {
  const a = Math.max(0, sharpness);
  return [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0].join(' ');
}
