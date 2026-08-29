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
import type { FontKey } from './fonts-catalog';

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
  // ── Tone & finish (all optional; defaults compose to "no change") ────────────
  contrast?: number; // 1 = no change (CSS filter)
  saturation?: number; // 1 = no change (CSS filter saturate())
  grayscale?: number; // 0 = full colour, 1 = mono (CSS filter)
  opacity?: number; // 1 = opaque (applied to the frame container, not the filter)
  borderRadius?: number; // 0 = square corners; fraction (0..0.5) of the frame's short edge
  shadow?: number; // 0 = none; 0..1 soft drop-shadow intensity (container box-shadow)
};

export const FULL_CROP: Rect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * A photo container floating on a block — normalized rect (0..1 of the OPEN PAIR) plus an
 * OPTIONAL photo. `photoId === null` is a genuine EMPTY PLACEHOLDER: the container exists
 * independently of whether a photo has been assigned (exactly like an empty base slot, which
 * is represented by a missing `photoIds` index). This is what lets a Blueprint store overlay
 * geometry with no photos and round-trip it through save → DB → load → builder without the
 * slot disappearing. A photo is assigned later (auto-fill or manual drag/pick).
 */
/**
 * A floating photo container on a spread.
 *
 * `id` is a STABLE CLIENT-SIDE identity, exactly like `Block.key` — generated on hydration and
 * on creation, never persisted. Overlays used to be addressed by array index, which is fine
 * until something reorders or deletes: every stored index then points at a different overlay.
 * That made index-based selection unsafe to build on, so identity moved to an id.
 *
 * It is OPTIONAL on the type on purpose. Pure producers outside the builder (`auto-layout`,
 * `blueprint`, template appliers — some of which run inside server actions) construct overlays
 * without one, and must keep compiling untouched. The builder's state container is what
 * guarantees presence: every `Block[]` entering `useBlocks` is normalized, so an overlay inside
 * builder state always has an id, and `serialize()` strips it again so the saved payload is
 * byte-identical to before.
 */
export type Overlay = { id?: string; photoId: string | null; x: number; y: number; w: number; h: number };

/** Fresh client-side overlay identity. Mirrors how `Block.key` is minted. */
export function makeOverlayId(): string {
  return cryptoId();
}

/**
 * Guarantee every overlay in `blocks` carries an id, preserving any that already has one.
 * Returns the SAME array reference when nothing was missing, so it is safe to run on every
 * state entry without causing spurious updates.
 */
export function withOverlayIds(blocks: Block[]): Block[] {
  let changed = false;
  const next = blocks.map((b) => {
    if (b.overlays.every((o) => !!o.id)) return b;
    changed = true;
    return { ...b, overlays: b.overlays.map((o) => (o.id ? o : { ...o, id: makeOverlayId() })) };
  });
  return changed ? next : blocks;
}

/** Strip client-only overlay ids for persistence — the server has never stored them. */
export function stripOverlayIds(overlays: Overlay[]): Overlay[] {
  return overlays.map((o) => {
    const rest = { ...o };
    delete rest.id;
    return rest;
  });
}

/** Geometry for a freshly added overlay (no photo yet — caller sets photoId, or null for a placeholder). */
export const DEFAULT_OVERLAY_GEOM = { x: 0.55, y: 0.08, w: 0.34, h: 0.34 };

/**
 * WHERE A NEW IMAGE OVERLAY LANDS — the ONE placement rule, for every surface that has overlays.
 *
 * It used to live inside `useBlocks.addOverlay`, which is bound to `Block[]`. The back cover has
 * overlays now and no blocks, and re-deriving "a sensible starting frame" there would have meant a
 * second set of geometry constants that drift apart. So the decision is pure and shared, and both
 * callers apply the result with their own primitives.
 *
 * `at` is where the customer asked for it — a drop point, or `'center'` for a menu action; `count`
 * is how many overlays the surface already has, which drives a gentle cascade so a second frame is
 * visibly a second frame rather than an invisible one exactly beneath the first. Without `at` the
 * frame cascades from `DEFAULT_OVERLAY_GEOM`, kept fully on the surface.
 */
export function nextOverlayGeom(count: number, at?: { x: number; y: number } | 'center'): Rect {
  const { w, h } = DEFAULT_OVERLAY_GEOM;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  if (at) {
    const drift = ((count % 5) - 2) * 0.035; // a gentle cascade around the anchor, both axes
    const cx = at === 'center' ? 0.5 + drift : at.x;
    const cy = at === 'center' ? 0.5 + drift : at.y;
    return { x: clamp01(cx - w / 2), y: clamp01(cy - h / 2), w, h };
  }
  return {
    x: clamp01(Math.min(DEFAULT_OVERLAY_GEOM.x + (count % 5) * 0.04, 1 - w)),
    y: clamp01(Math.min(DEFAULT_OVERLAY_GEOM.y + (count % 5) * 0.04, 1 - h)),
    w,
    h,
  };
}

/**
 * THE FRAMES A NEW SPREAD STARTS WITH.
 *
 * A page is a background, and photos live in overlay frames — so a page that starts with nothing
 * gives the customer a blank sheet and no obvious way in. These are the frames the old model
 * implied and drew implicitly (the page WAS the photo container); making them explicit overlays is
 * what lets them be moved, resized, cropped, layered, deleted and undone like anything else,
 * instead of being a special case built into the page.
 *
 * ── WHY TWO, AND WHY THIS IS NOT ONE BOX SPLIT IN HALF ─────────────────────────────────────
 *
 * A `single-pair` unit is TWO independent printed pages that happen to be edited together. One
 * spread-wide frame would therefore be a single photo crossing the gutter — the thing
 * `double-spread` exists to express — and it would make the two pages inseparable: filling the
 * left would fill the right, and cropping one would crop both. So a new pair gets two genuine
 * `Overlay` objects, one per page, each with its own id, its own `photoId` and its own geometry.
 * Page ownership is the geometry: an overlay is normalized to the OPEN PAIR, so x ∈ [0, 0.5) is
 * the left page and x ∈ [0.5, 1] is the right. Nothing else needs to record it, and nothing can
 * disagree with it.
 *
 * A `double-spread` unit really is one image across both pages, so it keeps one full-pair frame.
 *
 * Full bleed on each page, deliberately: the trim IS the usable area (there is no margin in the
 * page model — every renderer clips at the page edge), so anything smaller would invent a margin
 * that nothing else in the builder or the PDF honours.
 */
export const LEFT_PAGE_OVERLAY_GEOM = { x: 0, y: 0, w: 0.5, h: 1 };
export const RIGHT_PAGE_OVERLAY_GEOM = { x: 0.5, y: 0, w: 0.5, h: 1 };
export const FULL_PAIR_OVERLAY_GEOM = { x: 0, y: 0, w: 1, h: 1 };

/** The starting frame geometry for a freshly created unit of `template`, in reading order. */
export function newUnitOverlayGeoms(template: LayoutTemplate): Rect[] {
  return template === 'double-spread'
    ? [{ ...FULL_PAIR_OVERLAY_GEOM }]
    : [{ ...LEFT_PAGE_OVERLAY_GEOM }, { ...RIGHT_PAGE_OVERLAY_GEOM }];
}

/** Hard cap on overlays per block — UI is unlimited, this rejects abusive payloads. */
export const MAX_OVERLAYS_PER_BLOCK = 50;

// ── Rich page elements (text · QR · background) ────────────────────────────────
// All additive + backward-compatible: stored in album_pages.layout_config jsonb
// alongside `overlays` (which the existing CHECK requires to be an array). Old rows
// have none of these → they hydrate to []/null and render exactly as before.

export type TextVariant = 'heading' | 'subtitle' | 'paragraph';
/** Selectable typeface key — defined by the shared font catalog (legacy serif/sans/script + library). */
export type TextFontKey = FontKey;
export type TextAlign = 'left' | 'center' | 'right';

/**
 * A text object that is BOUND TO ALBUM METADATA rather than free-floating.
 *
 * The cover's title, subtitle, author and spine text are ordinary movable text objects — but
 * their words are not theirs to own: `albums.title` is the canonical album title, printed on the
 * dashboard, the order, the invoice and the PDF filename, and the cover must show that exact
 * string. A role is the binding. It says "this object renders metadata field X", which is what
 * lets the object be dragged, restyled and rotated like any other while its `text` stays
 * synchronised in both directions (see `lib/builder/cover-objects`).
 *
 * Absent (the overwhelmingly common case) = an ordinary text object that owns its own words.
 */
export const COVER_TEXT_ROLES = ['title', 'subtitle', 'author', 'spine'] as const;
export type CoverTextRole = (typeof COVER_TEXT_ROLES)[number];

/**
 * Text objects the customer AUTHORED, as opposed to metadata views.
 *
 * Lives here (with the type) rather than beside the cover model, because every "has this cover
 * been designed?" predicate needs it and those are spread across validation, readiness and
 * checkout. Migration guarantees a title object on every cover, so a bare `texts.length > 0` now
 * reports a pristine album as custom-designed — a metadata view is not a design decision.
 */
export const freeTexts = (texts: { role?: CoverTextRole }[]) => texts.filter((t) => !t.role);

/** A free text element placed on the open pair (normalized rect, like an overlay). */
export type TextElement = {
  id: string;
  text: string;
  /**
   * Metadata binding (cover objects only). Additive + optional, so every existing text element
   * — on pages and on covers — is unchanged and untouched by this.
   */
  role?: CoverTextRole;
  x: number;
  y: number;
  w: number;
  h: number;
  variant: TextVariant;
  font: TextFontKey;
  size: number; // px at the reference open-pair width (REF_PAIR_W); scales with the canvas
  weight: number; // 400 | 500 | 600 | 700
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  color: string; // hex (validated server-side)
  letterSpacing: number; // em
  lineHeight: number; // unitless multiplier
  opacity: number; // 0..1
  rotation: number; // deg, -180..180
  shadow: boolean;
};

/** A QR code generated from a URL/string, placed on the open pair. */
export type QrElement = {
  id: string;
  data: string; // the URL/text to encode
  x: number;
  y: number;
  w: number;
  h: number;
  fg: string; // foreground hex
  bg: string; // background hex (or 'transparent')
  padding: number; // quiet-zone padding, 0..0.4 (fraction of the QR box)
  radius: number; // container corner radius, 0..0.5 (fraction of the QR box short edge)
};

/** A page background — CSS-only (colour | gradient | texture) so the PDF never waits on a load. */
export type Background = {
  kind: 'color' | 'gradient' | 'texture';
  value: string; // catalog key (resolved by backgroundStyle in elements.ts)
};

/**
 * A decorative sticker (admin-managed artwork) placed on a page or the cover. Stores only the
 * catalog `stickerId` + geometry — NEVER a URL (presigned URLs expire). The renderer resolves
 * the id → presigned URL via a `stickerUrlFor` resolver (parallel to how photos are resolved),
 * so the same element renders in the canvas, the preview, and the PDF.
 */
export type StickerElement = {
  id: string;
  stickerId: string; // FK to the admin stickers catalog
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number; // deg, -180..180
  opacity: number; // 0..1
  // Additive, all optional so legacy jsonb rows hydrate + render identically when absent.
  flipH?: boolean; // mirror horizontally (scaleX(-1))
  flipV?: boolean; // mirror vertically (scaleY(-1))
  locked?: boolean; // freeze drag/resize/rotate on the canvas (Movable honours this)
};

export const MAX_TEXTS_PER_BLOCK = 30;
export const MAX_QRS_PER_BLOCK = 10;
export const MAX_STICKERS_PER_BLOCK = 30;

/** Geometry for a freshly added sticker (square, near the top-right of the page/cover). */
export const DEFAULT_STICKER_GEOM = { x: 0.42, y: 0.12, w: 0.16, h: 0.16 };

/** Reference open-pair width (px) that TextElement.size is authored against. */
export const REF_PAIR_W = 1000;

/** One content PAIR (two physical pages) in the working builder state. */
export type Block = {
  key: string; // client-side id; not persisted (page_number is the persisted order)
  template: LayoutTemplate;
  /**
   * The unit's BASE IMAGE SLOTS, positional:
   *   single-pair    [leftId, rightId] — index 0 is the left page, 1 is the right page
   *   double-spread  [imageId]         — one image split across both pages
   *
   * `null` IS A DELIBERATE HOLE, and the array is positional because of it.
   *
   * It used to be a compact list of ids, which could not express "the right page has a photo and
   * the left one does not". Clearing the left slot therefore removed index 0 and the right photo
   * SLID onto the left page — a photo migrating between pages because of an edit to a different
   * page. There is no arrangement of a compact array that avoids this; the hole has to be
   * representable, so it is. `uuid[]` carries nulls natively, and every reader either indexes
   * positionally (which is now correct) or filters falsy values (which was already correct).
   *
   * Trailing holes are trimmed on the way out (`trimBaseIds`) so `[X]` and `[X, null]` are the
   * same stored value, and an emptied unit persists as `[]`.
   */
  photoIds: (string | null)[];
  caption: string;
  overlays: Overlay[]; // normalized 0..1 across the OPEN PAIR (both pages)
  texts: TextElement[]; // free text elements (default [])
  qrs: QrElement[]; // QR codes (default [])
  stickers: StickerElement[]; // decorative stickers (default [])
  background: Background | null; // page background (default null)
  // Additive, optional: the LAYOUT PRESET key this block was created from (single / panorama /
  // collage / …). Persisted in layout_config so blueprint breakdowns are accurate. The renderer
  // never reads it; absent/legacy blocks fall back to inference from the geometry.
  preset?: string;
};

/**
 * Normalize a base-slot array for storage: coerce `undefined` holes to `null` and drop trailing
 * ones, so a unit with nothing in its last slot is byte-identical to one that never had it.
 * Interior holes are PRESERVED — they are the whole point (see `Block.photoIds`).
 */
export function trimBaseIds(ids: readonly (string | null | undefined)[]): (string | null)[] {
  const out = ids.map((id) => id ?? null);
  while (out.length > 0 && out[out.length - 1] === null) out.pop();
  return out;
}

/** Build a fresh, empty block with all rich-element fields initialized. */
export function makeBlock(template: LayoutTemplate, key?: string): Block {
  return {
    key: key ?? cryptoId(),
    template,
    photoIds: [],
    caption: '',
    overlays: [],
    texts: [],
    qrs: [],
    stickers: [],
    background: null,
  };
}

/** Normalize a partially-shaped block (e.g. loaded/legacy) to a full Block. */
export function normalizeBlock(b: Partial<Block> & { template: LayoutTemplate; key?: string }): Block {
  return {
    key: b.key ?? cryptoId(),
    template: b.template,
    photoIds: b.photoIds ?? [],
    caption: b.caption ?? '',
    overlays: b.overlays ?? [],
    texts: b.texts ?? [],
    qrs: b.qrs ?? [],
    stickers: b.stickers ?? [],
    background: b.background ?? null,
  };
}

/** SSR/Node-safe id (crypto.randomUUID in the browser + modern Node; fallback otherwise). */
export function cryptoId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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

/** Does this unit carry anything that will actually print? */
export function blockHasContent(b: Block): boolean {
  return (
    b.photoIds.some(Boolean) ||
    b.overlays.some((o) => o.photoId) ||
    b.texts.length > 0 ||
    b.stickers.length > 0 ||
    b.qrs.length > 0 ||
    b.background !== null
  );
}

/**
 * Complete = the unit is designed, and nothing on it is a half-finished container.
 *
 * This used to mean "every base slot is filled" — single-pair needed BOTH page photos, or the
 * page was reported incomplete. That rule described a model where a page WAS a photo container,
 * and it no longer is: a new page starts as background only, photos arrive as overlays the
 * customer places deliberately, and a page carrying a colour and a caption is a finished page,
 * not a page missing two photos.
 *
 * So the unfinished state is now an EMPTY CONTAINER — an overlay placed with no photo in it,
 * which really is something the customer started and did not finish — plus the genuinely blank
 * page, which has nothing on it at all. Base slots still count as content when a layout preset,
 * a blueprint or a legacy album filled them; they are simply no longer demanded.
 */
export function isBlockComplete(b: Block): boolean {
  if (b.overlays.some((o) => !o.photoId)) return false;
  return blockHasContent(b);
}

/**
 * Album is submittable: content leaves exactly match size (cover/blanks are extra and
 * excluded) AND every unit is complete. size is always even, so paired units fit.
 */
export function isAlbumComplete(blocks: Block[], size: number): boolean {
  return blocks.length > 0 && pagesConsumed(blocks) === size && blocks.every(isBlockComplete);
}

// NOTE: The former `validateAlbumForPdf()` lived here. It has been REMOVED as part of the
// validation unification — album completeness + cover + PDF-integrity now live in the single
// central service `@/lib/albums/validation` (which reuses the pure primitives below:
// PAGE_COST, requiredBaseCount, isBlockComplete, LAYOUT_TEMPLATES). There must be exactly one
// validator; do not re-add a parallel one here.

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
  const contrast = e?.contrast ?? 1;
  const saturation = e?.saturation ?? 1;
  const grayscale = e?.grayscale ?? 0;
  const parts: string[] = [];
  if (brightness !== 1) parts.push(`brightness(${brightness})`);
  if (contrast !== 1) parts.push(`contrast(${contrast})`);
  if (saturation !== 1) parts.push(`saturate(${saturation})`);
  if (grayscale > 0) parts.push(`grayscale(${clamp(grayscale, 0, 1)})`);
  if ((e?.sharpness ?? 0) > 0) parts.push(`url(#${sharpenId})`);
  return parts.length ? parts.join(' ') : 'none';
}

/**
 * Container-level finish for a photo frame: opacity, rounded corners, and a soft drop
 * shadow. These live on the frame's wrapper (not the CSS `filter`) so they compose with
 * the geometry inside. Pure — the renderer (and the PDF print route) build the same style.
 * `shortEdgePx` lets border-radius track the frame size; omit for a fractional fallback.
 */
export function frameFinish(
  e: EditConfig | null | undefined,
  shortEdgePx?: number,
): { opacity?: number; borderRadius?: string; boxShadow?: string } {
  const out: { opacity?: number; borderRadius?: string; boxShadow?: string } = {};
  const opacity = e?.opacity ?? 1;
  if (opacity < 1) out.opacity = clamp(opacity, 0, 1);
  const radius = clamp(e?.borderRadius ?? 0, 0, 0.5);
  if (radius > 0) out.borderRadius = shortEdgePx ? `${radius * shortEdgePx}px` : `${radius * 100}%`;
  const shadow = clamp(e?.shadow ?? 0, 0, 1);
  if (shadow > 0) {
    const y = Math.round(6 + shadow * 22);
    const blur = Math.round(12 + shadow * 40);
    out.boxShadow = `0 ${y}px ${blur}px -8px rgba(20, 30, 24, ${0.18 + shadow * 0.32})`;
  }
  return out;
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
