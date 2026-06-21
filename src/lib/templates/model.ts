// Template Management — shared model. Pure types + geometry validation + presets, safe in
// both client and server components. No I/O. Values are the lowercase DB enums (0032).
//
// A template's geometry is a RENDERER-SAFE PRESET over the existing two builder primitives:
//   geometry = { base: 'single-pair' | 'double-spread', overlays: Rect[] }
// Applying a template emits an ordinary Block[]; nothing new ever reaches the renderer or
// saveLayout. validateGeometry() is the single source of geometry truth (Zod boundary +
// the activation gate).

import { LAYOUT_TEMPLATES, MAX_OVERLAYS_PER_BLOCK, type LayoutTemplate, type Rect } from '@/lib/builder/model';

export const TEMPLATE_CATEGORIES = ['solo', 'pair', 'collage', 'panoramic', 'story'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_STATUSES = ['active', 'inactive', 'archived'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

/** The base primitive — exactly the existing renderer primitives. */
export type TemplateBase = LayoutTemplate;

/** A renderer-safe layout preset. */
export type TemplateGeometry = {
  base: TemplateBase;
  overlays: Rect[];
};

export const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  solo: 'Solo',
  pair: 'Pair',
  collage: 'Collage',
  panoramic: 'Panoramic',
  story: 'Story',
};

export const STATUS_LABEL: Record<TemplateStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  archived: 'Archived',
};

export const STATUS_CHIP: Record<TemplateStatus, string> = {
  active: 'bg-success/12 text-success',
  inactive: 'bg-muted text-muted-foreground',
  archived: 'bg-amber-500/10 text-amber-600',
};

export const isTemplateCategory = (v: string): v is TemplateCategory =>
  (TEMPLATE_CATEGORIES as readonly string[]).includes(v);
export const isTemplateStatus = (v: string): v is TemplateStatus =>
  (TEMPLATE_STATUSES as readonly string[]).includes(v);

export const categoryLabel = (v: string): string => CATEGORY_LABEL[v as TemplateCategory] ?? v;
export const statusLabel = (v: string): string => STATUS_LABEL[v as TemplateStatus] ?? v;
export const statusChip = (v: string): string =>
  STATUS_CHIP[v as TemplateStatus] ?? 'bg-muted text-muted-foreground';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inUnit = (v: number) => v >= 0 && v <= 1;

/**
 * Strict geometry validation — the ONLY gate between admin input and the renderer.
 * Guarantees: base is an existing primitive; overlays is a bounded array of numeric rects
 * fully inside the [0,1] open-pair box. No HTML/CSS/arbitrary keys are ever accepted.
 * A template can only become ACTIVE (selectable) when this passes.
 */
export function validateGeometry(geom: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof geom !== 'object' || geom === null) {
    return { ok: false, errors: ['Geometry must be an object.'] };
  }
  const g = geom as { base?: unknown; overlays?: unknown };

  if (typeof g.base !== 'string' || !(LAYOUT_TEMPLATES as readonly string[]).includes(g.base)) {
    errors.push(`base must be one of: ${LAYOUT_TEMPLATES.join(', ')}.`);
  }

  if (!Array.isArray(g.overlays)) {
    errors.push('overlays must be an array.');
  } else {
    if (g.overlays.length > MAX_OVERLAYS_PER_BLOCK) {
      errors.push(`Too many overlay slots (max ${MAX_OVERLAYS_PER_BLOCK}).`);
    }
    g.overlays.forEach((o, i) => {
      const r = o as Record<string, unknown>;
      if (typeof o !== 'object' || o === null || !isNum(r.x) || !isNum(r.y) || !isNum(r.w) || !isNum(r.h)) {
        errors.push(`Overlay #${i + 1}: x/y/w/h must be numbers.`);
        return;
      }
      const { x, y, w, h } = r as { x: number; y: number; w: number; h: number };
      if (!inUnit(x) || !inUnit(y)) errors.push(`Overlay #${i + 1}: x/y must be within 0–1.`);
      if (w <= 0 || w > 1 || h <= 0 || h > 1) errors.push(`Overlay #${i + 1}: w/h must be within 0–1 and > 0.`);
      if (x + w > 1.0001 || y + h > 1.0001) errors.push(`Overlay #${i + 1}: extends past the page bounds.`);
    });
  }

  return { ok: errors.length === 0, errors };
}

/** Coerce arbitrary stored JSON into a clean TemplateGeometry (after validation passes). */
export function normalizeGeometry(geom: unknown): TemplateGeometry {
  const g = geom as { base: TemplateBase; overlays: Rect[] };
  return {
    base: g.base,
    overlays: (g.overlays ?? []).map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h })),
  };
}

/** Default geometry per category — valid starting points so admins never begin invalid. */
export const CATEGORY_PRESET: Record<TemplateCategory, TemplateGeometry> = {
  solo: { base: 'double-spread', overlays: [] },
  pair: { base: 'single-pair', overlays: [] },
  collage: {
    base: 'single-pair',
    overlays: [
      { x: 0.06, y: 0.08, w: 0.2, h: 0.26 },
      { x: 0.74, y: 0.08, w: 0.2, h: 0.26 },
      { x: 0.06, y: 0.66, w: 0.2, h: 0.26 },
      { x: 0.74, y: 0.66, w: 0.2, h: 0.26 },
    ],
  },
  panoramic: { base: 'double-spread', overlays: [] },
  story: {
    base: 'double-spread',
    overlays: [
      { x: 0.08, y: 0.6, w: 0.22, h: 0.3 },
      { x: 0.7, y: 0.6, w: 0.22, h: 0.3 },
    ],
  },
};
