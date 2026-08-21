/**
 * Album builder — custom front-cover model (PURE, shared).
 *
 * A cover is a composition over a 3:4 page: an image source (an admin cover template OR
 * an uploaded album photo OR a CSS background) + an editable title/subtitle with chosen
 * typography, colour, alignment and a premium layout preset. Stored in `albums.cover_config`
 * (jsonb) and rendered identically in the builder canvas, the flipbook preview, and the PDF
 * print route — so the cover the customer designs is exactly what prints.
 *
 * No I/O, no 'use client' / 'server-only' — safe to import anywhere. Reuses the existing
 * font + background catalogs so a cover element looks consistent with page elements.
 */
import type { CSSProperties } from 'react';
import { backgroundStyle } from './elements';
import { freeTexts } from './model';
import type { Background, EditConfig, QrElement, StickerElement, TextAlign, TextElement, TextFontKey } from './model';

/** Premium cover layouts — each is a tasteful default placement + framing of the title. */
export const COVER_LAYOUTS = ['classic', 'spotlight', 'banner', 'minimal'] as const;
export type CoverLayout = (typeof COVER_LAYOUTS)[number];

/** The object-model schema version this build writes. See `CoverConfig.v`. */
export const COVER_SCHEMA_VERSION = 2;

export const COVER_LAYOUT_LABEL: Record<CoverLayout, string> = {
  classic: 'Classic',
  spotlight: 'Spotlight',
  banner: 'Banner',
  minimal: 'Minimal',
};

/**
 * The BACK cover composition (the left page of the printed cover spread). Mirrors a content
 * page: its own image source (uploaded photo with optional crop) OR a CSS background, plus the
 * SAME free text / sticker / QR elements used on pages. An optional studio brand mark prints in
 * the corner. There is no admin "artwork template" on the back — that is a front-cover concept.
 */
export type BackCoverConfig = {
  background: Background | null; // CSS backdrop (used when no photo)
  photoId: string | null; // uploaded album photo used as the back image
  imageEdit: EditConfig | null; // crop/zoom/rotate for the back image (independent of page placement)
  texts: TextElement[];
  stickers: StickerElement[];
  qrs: QrElement[];
  showLogo: boolean; // print the Malnad Stories mark in the bottom corner
};

export const DEFAULT_BACK_COVER: BackCoverConfig = {
  background: null,
  photoId: null,
  imageEdit: null,
  texts: [],
  stickers: [],
  qrs: [],
  showLogo: false,
};

/**
 * The SPINE as a printable surface with its own objects.
 *
 * It used to be two scalar fields (`spineTitle` + `spineColor`) rendered by a bespoke `<span>`
 * with a hardcoded font, size and position — the last thing on the cover that could not be moved,
 * restyled or duplicated. It is a real page of the printed cover (the bound edge), so it gets a
 * real element array like the front and the back. One text object with `role: 'spine'` is what
 * migration puts here; nothing stops a customer adding a second.
 */
export type SpineConfig = {
  texts: TextElement[];
  /**
   * The spine's OWN backdrop, independent of the front and the back.
   *
   * It used to have none: `SpineDesign` painted a hardcoded `#1e3a2f` with a fixed edge gradient,
   * so the one surface between two freely-coloured faces was the one surface that could not be
   * coloured. Absent (`null`) still means exactly that hardcoded look, which is why every
   * pre-existing cover keeps the spine it has until someone deliberately changes it.
   */
  background: Background | null;
};

export const DEFAULT_SPINE: SpineConfig = { texts: [], background: null };

/**
 * The spine's legacy paint — what every cover printed before the spine became colourable. It is
 * the documented fallback for `spine.background === null`, never a value that gets written.
 */
export const SPINE_LEGACY_COLOR = '#1e3a2f';

/**
 * The bound-edge shading drawn OVER whatever colour the spine carries, so a coloured spine still
 * reads as a folded edge rather than a flat stripe. Unchanged from the hardcoded original.
 */
const SPINE_EDGE_SHADING =
  'linear-gradient(90deg, rgba(0,0,0,0.22), rgba(0,0,0,0.04) 40%, rgba(0,0,0,0.04) 60%, rgba(0,0,0,0.22))';

/**
 * Resolve the spine's CSS backdrop. `null` reproduces the legacy hardcoded spine EXACTLY, so an
 * album saved before this existed prints identically. Shared by the builder canvas, the preview
 * and the PDF print route — one definition, three surfaces.
 */
export function spineBackgroundStyle(bg: Background | null): CSSProperties {
  if (!bg) return { background: `${SPINE_EDGE_SHADING}, ${SPINE_LEGACY_COLOR}` };
  const resolved = backgroundStyle(bg);
  // A texture resolves to `backgroundImage` + `backgroundSize`; layering the shading over an
  // image would need a second background layer, so a texture keeps its own image and the shading
  // steps aside rather than fighting it.
  if (typeof resolved.background === 'string') return { background: `${SPINE_EDGE_SHADING}, ${resolved.background}` };
  return resolved;
}

/**
 * The persisted custom-cover design. Top-level fields describe the FRONT cover (the book's
 * face — rendered as physical page 1); `back` describes the back cover (printed as the last
 * physical page); `spine*` describe the binding shown between them in the editor + preview.
 *
 * The front IMAGE source resolves by priority:
 *   photoId (an uploaded album photo) → cover template (albums.cover_template_id) → background.
 * `background` (CSS colour/gradient/texture) is used when no image is chosen, or as a
 * solid backdrop behind the title for image-less covers.
 */
export type CoverConfig = {
  /**
   * OBJECT-MODEL SCHEMA VERSION.
   *
   *   absent / 1 — legacy: the title, subtitle, author and spine are SCALAR FIELDS rendered by a
   *                bespoke, unmovable title block.
   *   2          — object model: those four are ordinary `TextElement`s carrying a `role`, living
   *                in `texts` / `spine.texts` like every other object.
   *
   * It exists because migration must be able to answer "has this cover been converted?" exactly
   * once. Without it, a lazy migration either re-runs on every load — duplicating the title
   * object each time — or the renderer cannot tell whether drawing the structured block would
   * paint the title twice. One integer removes both failure modes; see `migrateCoverConfig`.
   */
  v?: number;

  // ── canonical metadata (see `lib/builder/cover-objects` for the two-way binding) ──
  // These remain the album's metadata of record and are NOT replaced by the objects: readiness,
  // validation, checkout and the admin console all read them. In v2 they are kept in lockstep
  // with the corresponding role-tagged text objects, in both directions.
  subtitle: string; // tagline under the title (the title itself is albums.title)
  author: string; // author / customer name printed on the cover (e.g. "by Asha R.")
  spineTitle: string; // text printed on the book spine (falls back to the album title)

  // ── legacy structured typography (v1) ──
  // Kept so a v1 row can still be read and migrated, and so a config that never re-enters the
  // builder keeps its meaning. In v2 they are inputs to migration only; `layout` additionally
  // survives as the cover's THEME (it drives the legibility scrim over photos).
  spineColor: string; // spine text colour hex
  font: TextFontKey;
  color: string; // title/subtitle hex
  align: TextAlign;
  layout: CoverLayout;
  posY: number; // 0..1 vertical anchor of the legacy text block centre

  background: Background | null; // CSS backdrop (used when no image source)
  photoId: string | null; // uploaded album photo used as the cover image (overrides template)
  imageEdit: EditConfig | null; // crop/zoom/rotate for the front image (independent of page placement)
  // Free elements — the SAME types used on content pages, so the cover and pages share one
  // element-editing experience. Default [] (legacy covers hydrate unchanged).
  texts: TextElement[];
  stickers: StickerElement[];
  qrs: QrElement[];
  spine: SpineConfig; // the bound edge — its own objects (v2)
  back: BackCoverConfig; // the back cover composition
};

export const DEFAULT_COVER_CONFIG: CoverConfig = {
  v: COVER_SCHEMA_VERSION,
  subtitle: '',
  author: '',
  spineTitle: '',
  spineColor: '#ffffff',
  font: 'serif',
  color: '#ffffff',
  align: 'center',
  layout: 'classic',
  posY: 0.8,
  background: null,
  photoId: null,
  imageEdit: null,
  texts: [],
  stickers: [],
  qrs: [],
  spine: { ...DEFAULT_SPINE },
  back: { ...DEFAULT_BACK_COVER },
};

/**
 * Spine thickness as a fraction of ONE cover-page width — a thicker book (more leaves) reads
 * thicker, like a real photobook. `size` is the album leaf count (24 / 36 / 48). Advisory: a
 * faithful preview proportion, not a pre-press measurement.
 */
export function spineWidthFor(size: number): number {
  const t = Math.max(0, Math.min(1, (size - 24) / 24)); // 24→0 … 48→1
  return 0.06 + t * 0.06; // 0.06 … 0.12 of a page width
}

/** Normalize a partial/legacy back-cover jsonb to a full BackCoverConfig. */
export function normalizeBackCover(b: Partial<BackCoverConfig> | null | undefined): BackCoverConfig {
  if (!b) return { ...DEFAULT_BACK_COVER };
  return {
    background: b.background ?? null,
    photoId: b.photoId ?? null,
    imageEdit: b.imageEdit ?? null,
    texts: Array.isArray(b.texts) ? b.texts : [],
    stickers: Array.isArray(b.stickers) ? b.stickers : [],
    qrs: Array.isArray(b.qrs) ? b.qrs : [],
    showLogo: b.showLogo === true,
  };
}

/** Reference cover width (px) the title size is authored against (for cqw scaling). */
export const REF_COVER_W = 600;

/**
 * Normalize a partial/legacy cover_config jsonb to a full CoverConfig.
 *
 * NOTE: this fills in shape, not semantics — a legacy row comes back with `v` absent, its
 * structured fields intact and `spine.texts` empty. Turning that into objects is
 * `migrateCoverConfig` (`lib/builder/cover-objects`), which every renderer and the builder call
 * next. The two are deliberately separate: normalization is total and cheap, migration needs the
 * album title and the page aspect and is the thing that must run exactly once.
 */
export function normalizeCoverConfig(c: Partial<CoverConfig> | null | undefined): CoverConfig {
  if (!c) return { ...DEFAULT_COVER_CONFIG };
  return {
    v: typeof c.v === 'number' ? c.v : 1,
    spine:
      c.spine && Array.isArray(c.spine.texts)
        ? { texts: c.spine.texts, background: c.spine.background ?? null }
        : { ...DEFAULT_SPINE },
    subtitle: typeof c.subtitle === 'string' ? c.subtitle : '',
    author: typeof c.author === 'string' ? c.author : '',
    spineTitle: typeof c.spineTitle === 'string' ? c.spineTitle : '',
    font: c.font ?? DEFAULT_COVER_CONFIG.font,
    color: c.color ?? DEFAULT_COVER_CONFIG.color,
    align: c.align ?? DEFAULT_COVER_CONFIG.align,
    layout: (COVER_LAYOUTS as readonly string[]).includes(c.layout as string)
      ? (c.layout as CoverLayout)
      : DEFAULT_COVER_CONFIG.layout,
    posY: typeof c.posY === 'number' ? Math.max(0.1, Math.min(0.95, c.posY)) : DEFAULT_COVER_CONFIG.posY,
    background: c.background ?? null,
    photoId: c.photoId ?? null,
    imageEdit: c.imageEdit ?? null,
    spineColor: c.spineColor ?? c.color ?? DEFAULT_COVER_CONFIG.spineColor,
    texts: Array.isArray(c.texts) ? c.texts : [],
    stickers: Array.isArray(c.stickers) ? c.stickers : [],
    qrs: Array.isArray(c.qrs) ? c.qrs : [],
    back: normalizeBackCover(c.back),
  };
}

/**
 * A cover is "custom" (worth persisting/rendering) when it diverges from plain defaults.
 *
 * Text is counted through `freeTexts`: since Cover Editor 2.0 every cover carries a title object
 * (and a spine object) as a VIEW of album metadata, so counting all of `texts` would call a
 * pristine album custom.
 */
export function isCustomCover(c: CoverConfig): boolean {
  return (
    c.subtitle.trim() !== '' ||
    c.author.trim() !== '' ||
    c.spineTitle.trim() !== '' ||
    c.layout !== DEFAULT_COVER_CONFIG.layout ||
    c.background !== null ||
    c.photoId !== null ||
    c.font !== DEFAULT_COVER_CONFIG.font ||
    freeTexts(c.texts).length > 0 ||
    c.stickers.length > 0 ||
    c.qrs.length > 0 ||
    c.back.photoId !== null ||
    c.back.background !== null ||
    c.back.texts.length > 0 ||
    c.back.stickers.length > 0 ||
    c.back.qrs.length > 0 ||
    c.back.showLogo ||
    c.spine.background !== null
  );
}

/**
 * Per-layout framing — the THEME's legibility scrim over a cover photo. Pure CSS, so the PDF
 * readiness gate never waits on a load.
 *
 * `band` is gone (Cover Editor 2.0). It used to draw a translucent plate sized to the structured
 * title block, which only worked while the renderer owned that block's position — with the title
 * as a free object there is no "behind the text" for a fixed layer to be. `banner` keeps its
 * intent, expressed the way every other theme expresses it: a soft horizontal plate across the
 * lower third, which is where that layout has always anchored its type. Legacy `banner` covers
 * therefore keep a dark strip behind their title rather than losing their contrast entirely.
 */
export function coverLayoutFraming(layout: CoverLayout, hasImage: boolean): { scrim: CSSProperties | null } {
  if (!hasImage) return { scrim: null };
  switch (layout) {
    case 'spotlight':
      return { scrim: { background: 'radial-gradient(120% 90% at 50% 50%, rgba(12,18,15,0.55), rgba(12,18,15,0.15))' } };
    case 'banner':
      return {
        scrim: {
          background:
            'linear-gradient(to bottom, transparent 46%, rgba(12,18,15,0.46) 56%, rgba(12,18,15,0.46) 88%, transparent 96%)',
        },
      };
    case 'minimal':
      return { scrim: { background: 'linear-gradient(to bottom, rgba(12,18,15,0.32), transparent 40%)' } };
    case 'classic':
    default:
      return { scrim: { background: 'linear-gradient(to top, rgba(12,18,15,0.6), transparent 55%)' } };
  }
}

/** Resolve a cover's CSS backdrop (used when there is no image source). */
export function coverBackgroundStyle(bg: Background | null): CSSProperties {
  return bg ? backgroundStyle(bg) : { background: '#1e3a2f' };
}
