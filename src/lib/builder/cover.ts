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
import type { Background, EditConfig, QrElement, StickerElement, TextAlign, TextElement, TextFontKey } from './model';

/** Premium cover layouts — each is a tasteful default placement + framing of the title. */
export const COVER_LAYOUTS = ['classic', 'spotlight', 'banner', 'minimal'] as const;
export type CoverLayout = (typeof COVER_LAYOUTS)[number];

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
  subtitle: string; // tagline under the title (the title itself is albums.title)
  author: string; // author / customer name printed on the cover (e.g. "by Asha R.")
  spineTitle: string; // text printed vertically on the book spine (falls back to the album title)
  spineColor: string; // spine text colour hex
  font: TextFontKey; // 'serif' | 'sans' | 'script'
  color: string; // title/subtitle hex
  align: TextAlign; // 'left' | 'center' | 'right'
  layout: CoverLayout;
  posY: number; // 0..1 vertical anchor of the text block centre
  background: Background | null; // CSS backdrop (used when no image source)
  photoId: string | null; // uploaded album photo used as the cover image (overrides template)
  imageEdit: EditConfig | null; // crop/zoom/rotate for the front image (independent of page placement)
  // Free elements — the SAME types used on content pages, so the cover and pages share one
  // element-editing experience. Default [] (legacy covers hydrate unchanged).
  texts: TextElement[];
  stickers: StickerElement[];
  qrs: QrElement[];
  back: BackCoverConfig; // the back cover composition
};

export const DEFAULT_COVER_CONFIG: CoverConfig = {
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

/** Normalize a partial/legacy cover_config jsonb to a full CoverConfig. */
export function normalizeCoverConfig(c: Partial<CoverConfig> | null | undefined): CoverConfig {
  if (!c) return { ...DEFAULT_COVER_CONFIG };
  return {
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

/** A cover is "custom" (worth persisting/rendering) when it diverges from plain defaults. */
export function isCustomCover(c: CoverConfig): boolean {
  return (
    c.subtitle.trim() !== '' ||
    c.author.trim() !== '' ||
    c.spineTitle.trim() !== '' ||
    c.layout !== DEFAULT_COVER_CONFIG.layout ||
    c.background !== null ||
    c.photoId !== null ||
    c.font !== DEFAULT_COVER_CONFIG.font ||
    c.texts.length > 0 ||
    c.stickers.length > 0 ||
    c.qrs.length > 0 ||
    c.back.photoId !== null ||
    c.back.background !== null ||
    c.back.texts.length > 0 ||
    c.back.stickers.length > 0 ||
    c.back.qrs.length > 0 ||
    c.back.showLogo
  );
}

/**
 * Per-layout framing: a scrim (so light text stays legible over photos), an optional
 * translucent band behind the text, and the default text anchor. Pure CSS so the PDF
 * readiness gate never waits on a load.
 */
export function coverLayoutFraming(layout: CoverLayout, hasImage: boolean): {
  scrim: CSSProperties | null;
  band: boolean;
} {
  if (!hasImage) return { scrim: null, band: false };
  switch (layout) {
    case 'spotlight':
      return { scrim: { background: 'radial-gradient(120% 90% at 50% 50%, rgba(12,18,15,0.55), rgba(12,18,15,0.15))' }, band: false };
    case 'banner':
      return { scrim: null, band: true };
    case 'minimal':
      return { scrim: { background: 'linear-gradient(to bottom, rgba(12,18,15,0.32), transparent 40%)' }, band: false };
    case 'classic':
    default:
      return { scrim: { background: 'linear-gradient(to top, rgba(12,18,15,0.6), transparent 55%)' }, band: false };
  }
}

/** Resolve a cover's CSS backdrop (used when there is no image source). */
export function coverBackgroundStyle(bg: Background | null): CSSProperties {
  return bg ? backgroundStyle(bg) : { background: '#1e3a2f' };
}
