/**
 * Album builder — rich-element catalogs + style resolvers (PURE, shared).
 *
 * Backgrounds, layout presets, text fonts, and the factory/style helpers for the
 * Text / QR / Background tools. No I/O, no 'use client' / 'server-only' — imported by
 * the builder UI, the shared renderer (`_pair-frame`), and the PDF print route alike, so
 * an element looks identical in the canvas, the preview, and the generated PDF.
 *
 * Backgrounds are CSS-only (colour | gradient | texture) so the PDF readiness gate never
 * waits on a network load. Layout presets are expressed as the existing
 * { base, overlays } geometry (no new renderer primitive, no schema change).
 */
import type { CSSProperties } from 'react';
import {
  REF_PAIR_W,
  cryptoId,
  DEFAULT_STICKER_GEOM,
  type Background,
  type LayoutTemplate,
  type QrElement,
  type Rect,
  type StickerElement,
  type TextElement,
  type TextVariant,
} from './model';
import { FONT_CATALOG, fontStack, FONT_KEYS } from './fonts-catalog';

// ── Fonts ──────────────────────────────────────────────────────────────────────
// The full selectable library lives in fonts-catalog.ts (legacy serif/sans/script + ~20 more).
// Re-export here so existing call sites (`import { fontStack, TEXT_FONTS } from './elements'`)
// keep working unchanged.
export { fontStack, FONT_CATALOG, FONT_KEYS };
export const TEXT_FONTS = FONT_CATALOG;

// ── Text variant presets + factory ───────────────────────────────────────────────
const VARIANT_DEFAULTS: Record<TextVariant, Partial<TextElement>> = {
  heading: { font: 'serif', size: 56, weight: 600, lineHeight: 1.05, letterSpacing: -0.01 },
  subtitle: { font: 'sans', size: 24, weight: 500, lineHeight: 1.2, letterSpacing: 0.08 },
  paragraph: { font: 'sans', size: 16, weight: 400, lineHeight: 1.55, letterSpacing: 0 },
};

const VARIANT_TEXT: Record<TextVariant, string> = {
  heading: 'Your headline',
  subtitle: 'A SUBTITLE',
  paragraph: 'Add a few words to tell the story of this moment…',
};

/** A fresh text element, centred near the top of the open pair. */
export function makeText(variant: TextVariant, overrides: Partial<TextElement> = {}): TextElement {
  const v = VARIANT_DEFAULTS[variant];
  const w = variant === 'paragraph' ? 0.4 : 0.5;
  return {
    id: cryptoId(),
    text: VARIANT_TEXT[variant],
    x: (1 - w) / 2,
    y: variant === 'paragraph' ? 0.5 : 0.12,
    w,
    h: variant === 'heading' ? 0.14 : variant === 'subtitle' ? 0.07 : 0.22,
    variant,
    font: v.font ?? 'sans',
    size: v.size ?? 18,
    weight: v.weight ?? 400,
    italic: false,
    underline: false,
    align: 'center',
    color: '#1e3a2f',
    letterSpacing: v.letterSpacing ?? 0,
    lineHeight: v.lineHeight ?? 1.3,
    opacity: 1,
    rotation: 0,
    shadow: false,
    ...overrides,
  };
}

/**
 * Container-query font size for a text element. Authored as px @ REF_PAIR_W, expressed in
 * `cqw` against the open-pair container (which declares `container-type: inline-size`), so
 * the SAME ratio renders in the canvas, the preview, and the PDF with no measurement.
 * REF_PAIR_W = 1000 → 1px = 0.1cqw.
 */
export function textFontSize(el: TextElement): string {
  return `${(el.size / REF_PAIR_W) * 100}cqw`;
}

/** Non-size text CSS (fontSize comes from textFontSize via container queries). */
export function textStyle(el: TextElement): CSSProperties {
  return {
    fontFamily: fontStack(el.font),
    fontSize: textFontSize(el),
    fontWeight: el.weight,
    fontStyle: el.italic ? 'italic' : 'normal',
    textDecoration: el.underline ? 'underline' : 'none',
    textAlign: el.align,
    color: el.color,
    letterSpacing: `${el.letterSpacing}em`,
    lineHeight: el.lineHeight,
    opacity: el.opacity,
    textShadow: el.shadow ? '0 0.2cqw 1cqw rgba(15,23,18,0.35)' : 'none',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };
}

// ── QR factory ─────────────────────────────────────────────────────────────────
// On a 3:2 open pair, a square box needs h = 1.5·w (the pair is 1.5× wider than tall).
export const PAIR_ASPECT = 3 / 2;
export function squareQrHeight(w: number): number {
  return Math.min(1, w * PAIR_ASPECT);
}

export function makeQr(data = '', overrides: Partial<QrElement> = {}): QrElement {
  const w = 0.14;
  return {
    id: cryptoId(),
    data,
    x: 0.76,
    y: 0.62,
    w,
    h: squareQrHeight(w), // square pixels on the 3:2 pair
    fg: '#1e3a2f',
    bg: '#ffffff',
    padding: 0.12,
    radius: 0.12,
    ...overrides,
  };
}

// ── Sticker factory ──────────────────────────────────────────────────────────────
/**
 * A fresh sticker element. `squareRatio` = the host container's width/height (PAIR_ASPECT on a
 * 3:2 page, 3/4 on the 3:4 cover) so the default box renders pixel-square; the artwork itself is
 * always `object-fit: contain` (never distorted) regardless of the box aspect.
 */
export function makeSticker(stickerId: string, squareRatio = PAIR_ASPECT, overrides: Partial<StickerElement> = {}): StickerElement {
  const { x, y, w } = DEFAULT_STICKER_GEOM;
  return {
    id: cryptoId(),
    stickerId,
    x,
    y,
    w,
    h: Math.min(1, w * squareRatio),
    rotation: 0,
    opacity: 1,
    ...overrides,
  };
}

// ── Backgrounds (CSS-only catalog) ───────────────────────────────────────────────
export type BackgroundSwatch = {
  key: string;
  label: string;
  kind: Background['kind'];
  /** Small preview swatch for the picker. */
  swatch: CSSProperties;
};

const SOLIDS: Record<string, string> = {
  white: '#ffffff',
  cream: '#fbf8f1',
  forest: '#1e3a2f',
  sand: '#efe7d6',
};

const GRADIENTS: Record<string, string> = {
  'gradient-dawn': 'linear-gradient(135deg, #fbf8f1 0%, #f0e7d4 100%)',
  'gradient-forest': 'linear-gradient(160deg, #2c5446 0%, #14241d 100%)',
  'gradient-mist': 'linear-gradient(180deg, #ffffff 0%, #eef2ef 100%)',
};

/** Paper texture as layered CSS gradients over a base colour — no remote image. */
function paperTexture(base: string): string {
  return [
    'radial-gradient(circle at 20% 25%, rgba(0,0,0,0.018) 0 1px, transparent 1px)',
    'radial-gradient(circle at 70% 65%, rgba(0,0,0,0.018) 0 1px, transparent 1px)',
    'linear-gradient(0deg, rgba(0,0,0,0.012), rgba(0,0,0,0.012))',
    `linear-gradient(0deg, ${base}, ${base})`,
  ].join(', ');
}

const TEXTURES: Record<string, { image: string; size: string }> = {
  'texture-paper': { image: paperTexture('#fbf8f1'), size: '7px 7px, 9px 9px, 100% 100%, 100% 100%' },
};

export const BACKGROUNDS: BackgroundSwatch[] = [
  { key: 'white', label: 'White', kind: 'color', swatch: { background: SOLIDS.white, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)' } },
  { key: 'cream', label: 'Cream', kind: 'color', swatch: { background: SOLIDS.cream } },
  { key: 'sand', label: 'Sand', kind: 'color', swatch: { background: SOLIDS.sand } },
  { key: 'forest', label: 'Forest', kind: 'color', swatch: { background: SOLIDS.forest } },
  { key: 'texture-paper', label: 'Paper', kind: 'texture', swatch: { backgroundImage: TEXTURES['texture-paper'].image, backgroundSize: TEXTURES['texture-paper'].size } },
  { key: 'gradient-dawn', label: 'Dawn', kind: 'gradient', swatch: { background: GRADIENTS['gradient-dawn'] } },
  { key: 'gradient-mist', label: 'Mist', kind: 'gradient', swatch: { background: GRADIENTS['gradient-mist'] } },
  { key: 'gradient-forest', label: 'Forest fade', kind: 'gradient', swatch: { background: GRADIENTS['gradient-forest'] } },
];

/** Is a background dark enough that overlaid default text should flip to light? */
export function isDarkBackground(bg: Background | null): boolean {
  if (!bg) return false;
  return bg.value === 'forest' || bg.value === 'gradient-forest';
}

/** Resolve a stored Background to renderable CSS (used in canvas, preview, and PDF). */
export function backgroundStyle(bg: Background | null): CSSProperties {
  if (!bg) return {};
  if (bg.kind === 'color') return { background: SOLIDS[bg.value] ?? bg.value };
  if (bg.kind === 'gradient') return { background: GRADIENTS[bg.value] ?? bg.value };
  const tex = TEXTURES[bg.value];
  return tex ? { backgroundImage: tex.image, backgroundSize: tex.size } : { background: SOLIDS.cream };
}

// ── Layout presets ───────────────────────────────────────────────────────────────
// Each preset is the existing { base, overlays } geometry over the OPEN PAIR (x<0.5 =
// left page, x>0.5 = right page). Applied via the builder's existing applyTemplateToBlock,
// so nothing new reaches the renderer / saveLayout. Base photos satisfy submit-completeness;
// overlays are tasteful framed insets (editorial collage), never required.
export type LayoutPreset = {
  key: string;
  label: string;
  hint: string;
  base: LayoutTemplate;
  overlays: Rect[];
};

const cell = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { key: 'single', label: 'Single', hint: 'One photo per page', base: 'single-pair', overlays: [] },
  { key: 'full-bleed', label: 'Full bleed', hint: 'One image, edge to edge', base: 'double-spread', overlays: [] },
  {
    key: 'panorama',
    label: 'Panorama',
    hint: 'A sweeping band across the fold',
    base: 'single-pair',
    overlays: [cell(0.08, 0.34, 0.84, 0.32)],
  },
  {
    key: 'two-vertical',
    label: 'Two vertical',
    hint: 'A tall inset on each page',
    base: 'single-pair',
    overlays: [cell(0.09, 0.13, 0.32, 0.74), cell(0.59, 0.13, 0.32, 0.74)],
  },
  {
    key: 'two-horizontal',
    label: 'Two horizontal',
    hint: 'Two wide bands stacked',
    base: 'single-pair',
    overlays: [cell(0.1, 0.09, 0.8, 0.38), cell(0.1, 0.53, 0.8, 0.38)],
  },
  {
    key: 'three-grid',
    label: 'Three',
    hint: 'A trio arrangement',
    base: 'single-pair',
    overlays: [cell(0.07, 0.12, 0.4, 0.46), cell(0.53, 0.12, 0.4, 0.46), cell(0.29, 0.55, 0.42, 0.35)],
  },
  {
    key: 'four-grid',
    label: 'Four',
    hint: 'A clean 2×2 grid',
    base: 'single-pair',
    overlays: [
      cell(0.07, 0.09, 0.4, 0.4),
      cell(0.53, 0.09, 0.4, 0.4),
      cell(0.07, 0.53, 0.4, 0.4),
      cell(0.53, 0.53, 0.4, 0.4),
    ],
  },
  {
    key: 'collage',
    label: 'Collage',
    hint: 'A scattered five-up',
    base: 'single-pair',
    overlays: [
      cell(0.06, 0.1, 0.34, 0.42),
      cell(0.42, 0.08, 0.28, 0.34),
      cell(0.72, 0.12, 0.22, 0.46),
      cell(0.1, 0.56, 0.3, 0.36),
      cell(0.45, 0.5, 0.42, 0.42),
    ],
  },
];
