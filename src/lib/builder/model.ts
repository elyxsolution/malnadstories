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

/**
 * Real printed-photobook model. Every content unit is a PAIR — two physical pages —
 * so the bound book always has an even content-page count:
 *   single-pair    two independent photos (left page + right page)
 *   double-spread  ONE image split exactly down the centre across both pages
 */
export const LAYOUT_TEMPLATES = ['single-pair', 'double-spread'] as const;
export type LayoutTemplate = (typeof LAYOUT_TEMPLATES)[number];

/** Physical leaves each unit consumes. Both units are a two-page pair. */
export const PAGE_COST: Record<LayoutTemplate, number> = {
  'single-pair': 2,
  'double-spread': 2,
};

export const TEMPLATE_LABEL: Record<LayoutTemplate, string> = {
  'single-pair': 'Single page', // two photos, one per page
  'double-spread': 'Double page', // one image across both pages
};

/**
 * Fixed front matter the PDF generator + preview inject and the user can NEVER edit
 * or reorder: physical page 1 = cover, 2 = blank (inside front cover left),
 * 3 = blank (right). Content starts at physical page 4. These are not stored as
 * album_pages rows — they exist only at render time, so alignment can't be broken.
 */
export const COVER_PAGES = 1;
export const BLANK_PAGES = 2;
export const FRONT_MATTER_PAGES = COVER_PAGES + BLANK_PAGES; // 3

/**
 * Max photos uploadable per album, keyed by album size (pages). With generic
 * overlays a page can use more than one photo, so the cap is higher than the page
 * count. Falls back to ~2× for any size not in the table.
 *
 * Caps are aligned to page count (Phase: Product Polish): 24→72, 36→102, 48→128.
 */
export const PHOTO_CAP: Record<number, number> = { 24: 72, 36: 102, 48: 128 };

export function photoCap(size: number): number {
  return PHOTO_CAP[size] ?? size * 2;
}

/** Non-destructive edit applied at render time. R2 originals are never modified. */
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Two COMPOSABLE crop systems, owned by two editors but combined here:
 *
 *   crop     free-form sub-rectangle of the oriented image (the FULL advanced editor),
 *            normalized 0..1. Default = whole image. "What region of the photo to use."
 *   zoom     fixed-frame pan/zoom (the lightweight QUICK-CROP), 1 = cover-fit the chosen
 *   offsetX  region into the printable page frame; > 1 zooms in; offsets pan −1..1 as a
 *   offsetY  fraction of the overflow. "How that region sits inside the fixed page area."
 *
 * Pipeline at render time: take `crop` region of the oriented image → cover-fit it into
 * the frame → apply zoom + pan. Both default to identity, so an untouched photo is a
 * plain cover-fit. Deterministic from (frame px, natural px, edit) → identical in the
 * editor, the builder slot, and the PDF (WYSIWYG; no extra cropping at PDF time).
 */
export const MAX_ZOOM = 5;
export type EditConfig = {
  crop?: Rect; // free-form region of the oriented image (full editor); default = full
  zoom?: number; // fixed-frame zoom: 1 = cover-fit (default), up to MAX_ZOOM
  offsetX?: number; // fixed-frame pan, −1..1 (0 = centered)
  offsetY?: number; // fixed-frame pan, −1..1 (0 = centered)
  rotate?: 0 | 90 | 180 | 270; // coarse rotation, 90° steps
  tilt?: number; // fine straighten, degrees (-15..15)
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

/** One content PAIR (two physical pages) in the working builder state. */
export type Block = {
  key: string; // client-side id; not persisted (page_number is the persisted order)
  template: LayoutTemplate;
  // single-pair: [leftId?, rightId?] (index 0 = left page, 1 = right page)
  // double-spread: [imageId?] (one image split across both pages)
  photoIds: string[];
  caption: string;
  overlays: Overlay[]; // normalized 0..1 across the OPEN PAIR (both pages)
};

/** The base photo ids a unit requires filled to be complete. */
export function requiredBaseCount(template: LayoutTemplate): number {
  return template === 'single-pair' ? 2 : 1;
}

// ── Accounting ───────────────────────────────────────────────────────────────

export function pagesConsumed(blocks: Block[]): number {
  return blocks.reduce((sum, b) => sum + PAGE_COST[b.template], 0);
}

/** Can a block of `template` be appended without exceeding the album size? */
export function canAdd(blocks: Block[], size: number, template: LayoutTemplate): boolean {
  return pagesConsumed(blocks) + PAGE_COST[template] <= size;
}

/**
 * Complete = every required base slot is filled. single-pair needs BOTH the left and
 * right photo; double-spread needs its one image. Overlays are optional and never gate.
 */
export function isBlockComplete(b: Block): boolean {
  const need = requiredBaseCount(b.template);
  let filled = 0;
  for (let i = 0; i < need; i++) if (b.photoIds[i]) filled += 1;
  return filled === need;
}

/**
 * Album is submittable: content leaves exactly match size (cover/blanks are extra and
 * excluded) AND every unit is complete. size is always even, so paired units fit.
 */
export function isAlbumComplete(blocks: Block[], size: number): boolean {
  return blocks.length > 0 && pagesConsumed(blocks) === size && blocks.every(isBlockComplete);
}

/**
 * Pure pre-flight validation for PDF generation. Used by BOTH the builder (to gate the
 * Generate button + show errors) and the server action (re-checked against the DB so a
 * forged client can't bypass it). Mirrors the physical-book rules in REQUIREMENT 7.
 */
export function validateAlbumForPdf(
  blocks: Block[],
  size: number,
  hasActiveCover: boolean,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. Cover exists.
  if (!hasActiveCover) errors.push('Choose a cover design before generating the PDF.');

  // 2. Page structure valid + 3/4. no orphan / incomplete pair.
  let consumed = 0;
  blocks.forEach((b, i) => {
    const label = `${TEMPLATE_LABEL[b.template] ?? 'Page'} #${i + 1}`;
    if (!(LAYOUT_TEMPLATES as readonly string[]).includes(b.template)) {
      errors.push(`${label}: unknown layout.`);
      return;
    }
    consumed += PAGE_COST[b.template];
    if (!isBlockComplete(b)) {
      errors.push(
        b.template === 'single-pair'
          ? `${label}: add a photo to BOTH the left and right pages.`
          : `${label}: add the image for the double-page spread.`,
      );
    }
  });

  if (blocks.length === 0) errors.push('Add at least one content page.');

  // 6. Spread pages exist in pairs → every unit costs 2, so content is always even.
  if (consumed % 2 !== 0) errors.push('Content must be an even number of pages (each unit is a pair).');

  // 5. Page-count alignment.
  if (consumed !== size) {
    errors.push(`Album must fill exactly ${size} content pages (currently ${consumed}).`);
  }

  return { ok: errors.length === 0, errors };
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

/**
 * Physical (printed) page number a content unit's LEFT page starts at, 1-based,
 * accounting for the injected front matter (cover + 2 blanks). The first content unit
 * therefore starts at physical page 4. Its right page is start + 1.
 */
export function physicalStart(blocks: Block[], index: number): number {
  let leaf = FRONT_MATTER_PAGES + 1; // first content page = 4
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

/** Clamp helper local to the renderer. */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Horizontal/vertical pan range (px) available for a given frame + zoom — the overflow
 *  of the cover-filled image beyond the frame. Exposed so the editor maps a drag delta
 *  to an exact offset (drag px / (overflow/2)). */
export function frameOverflow(
  frameW: number,
  frameH: number,
  natW: number,
  natH: number,
  e: EditConfig | null | undefined,
): { x: number; y: number } | null {
  const layout = computeFrameLayout(frameW, frameH, natW, natH, e);
  if (!layout) return null;
  const crop = e?.crop ?? FULL_CROP;
  const cw = clamp(crop.w, 1e-6, 1);
  const ch = clamp(crop.h, 1e-6, 1);
  // Pan range is the overflow of the cover-filled CROP REGION beyond the frame.
  return { x: Math.max(0, cw * layout.layer.width - frameW), y: Math.max(0, ch * layout.layer.height - frameH) };
}

/**
 * Maps a fixed-frame crop (zoom + pan) onto a cover-filled frame. Pure + deterministic
 * from (frame px, natural px, edit) so the editor preview, every builder surface, and
 * the PDF print route compute the SAME geometry — WYSIWYG by construction.
 *
 * The image always COVERS the frame at zoom 1; zoom scales it up; offsetX/offsetY pan
 * it (as a fraction of the overflow), clamped so the frame can never show empty edges.
 * Flip is composed into the <img> transform; tilt adds a small cover boost so corners
 * stay filled when straightening. Returns null until frame + natural size are known.
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
  const flipH = e?.flipH ?? false;
  const flipV = e?.flipV ?? false;
  const zoom = clamp(e?.zoom ?? 1, 1, MAX_ZOOM);
  const offX = clamp(e?.offsetX ?? 0, -1, 1);
  const offY = clamp(e?.offsetY ?? 0, -1, 1);
  const crop = e?.crop ?? FULL_CROP;
  const cw = clamp(crop.w, 1e-6, 1);
  const ch = clamp(crop.h, 1e-6, 1);
  const cx = crop.x;
  const cy = crop.y;

  // Oriented natural size (90/270 swaps width/height).
  const quarter = rotate === 90 || rotate === 270;
  const ow = quarter ? natH : natW;
  const oh = quarter ? natW : natH;

  // Scale so the CROP REGION cover-fills the frame, then zoom + a small tilt cover boost.
  const regionW = cw * ow;
  const regionH = ch * oh;
  const tiltCover = 1 + Math.min(Math.abs(tilt) / 15, 1) * 0.18;
  const s = Math.max(frameW / regionW, frameH / regionH) * zoom * tiltCover;

  const Lw = ow * s;
  const Lh = oh * s;

  // Center the crop region in the frame, then pan by the offset fraction of the region's
  // overflow (so the frame is always fully covered, no empty edges).
  const regionOverflowX = cw * Lw - frameW;
  const regionOverflowY = ch * Lh - frameH;
  const left = frameW / 2 - (cx + cw / 2) * Lw + offX * (regionOverflowX / 2);
  const top = frameH / 2 - (cy + ch / 2) * Lh + offY * (regionOverflowY / 2);

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
