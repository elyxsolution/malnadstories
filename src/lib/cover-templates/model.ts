// Cover DESIGN templates — shared model (PURE types + helpers, safe in client and server).
// No I/O. A cover template is a CoverConfig snapshot (lib/builder/cover.ts) authored in the
// same cover editor customers use; applying one deep-copies its config into an album's
// cover_config. Mirrors lib/templates/model.ts (layout templates).

import { CoverConfigSchema } from '@/lib/validations';
import { normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';

export const COVER_TEMPLATE_CATEGORIES = [
  'general', 'travel', 'wedding', 'minimal', 'bold', 'classic', 'seasonal',
] as const;
export type CoverTemplateCategory = (typeof COVER_TEMPLATE_CATEGORIES)[number];

export const COVER_TEMPLATE_STATUSES = ['active', 'inactive', 'archived'] as const;
export type CoverTemplateStatus = (typeof COVER_TEMPLATE_STATUSES)[number];

export const COVER_CATEGORY_LABEL: Record<CoverTemplateCategory, string> = {
  general: 'General',
  travel: 'Travel',
  wedding: 'Wedding',
  minimal: 'Minimal',
  bold: 'Bold',
  classic: 'Classic',
  seasonal: 'Seasonal',
};

export const COVER_STATUS_LABEL: Record<CoverTemplateStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  archived: 'Archived',
};

export const COVER_STATUS_CHIP: Record<CoverTemplateStatus, string> = {
  active: 'bg-success/12 text-success',
  inactive: 'bg-muted text-muted-foreground',
  archived: 'bg-amber-500/10 text-amber-600',
};

export const isCoverTemplateCategory = (v: string): v is CoverTemplateCategory =>
  (COVER_TEMPLATE_CATEGORIES as readonly string[]).includes(v);
export const isCoverTemplateStatus = (v: string): v is CoverTemplateStatus =>
  (COVER_TEMPLATE_STATUSES as readonly string[]).includes(v);

export const coverCategoryLabel = (v: string): string =>
  COVER_CATEGORY_LABEL[v as CoverTemplateCategory] ?? v;
export const coverStatusLabel = (v: string): string =>
  COVER_STATUS_LABEL[v as CoverTemplateStatus] ?? v;
export const coverStatusChip = (v: string): string =>
  COVER_STATUS_CHIP[v as CoverTemplateStatus] ?? 'bg-muted text-muted-foreground';

/**
 * Strict config validation — the ONLY gate between admin input and the stored template
 * (and the activation gate). Reuses the exact CoverConfigSchema that bounds a customer's
 * cover, so a template can never carry a shape the renderer/customer editor can't handle.
 */
export function validateCoverConfig(config: unknown): { ok: boolean; error: string | null } {
  const parsed = CoverConfigSchema.safeParse(config);
  return parsed.success ? { ok: true, error: null } : { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid cover design.' };
}

/**
 * Turn a template's stored CoverConfig into the config to write onto an ALBUM.
 *
 * A template is authored WITHOUT a customer's photos, so any photoId it carries would dangle;
 * we null the front + back image photoIds (and their edits) on apply. Everything else — text,
 * stickers, QR, background, typography, layout, spine, back composition — copies verbatim and
 * stays fully editable. Deep-cloned so the album never shares a reference with the catalog.
 *
 * VERSION SAFETY (Task 7 / 13): this is a COPY, never a link. The album stores the resulting
 * CoverConfig in its OWN `albums.cover_config`; there is no template_id reference anywhere. So
 * editing, deactivating, or deleting a template later can NEVER change any album, order, or PDF
 * that already applied it — a template only ever affects the next album that applies it. Legacy
 * PNG covers (cover_templates / albums.cover_template_id) are a separate, untouched path.
 */
export function applyCoverTemplateToAlbum(templateConfig: unknown): CoverConfig {
  const cfg = normalizeCoverConfig(templateConfig as Parameters<typeof normalizeCoverConfig>[0]);
  const cloned: CoverConfig = JSON.parse(JSON.stringify(cfg));
  cloned.photoId = null;
  cloned.imageEdit = null;
  cloned.back.photoId = null;
  cloned.back.imageEdit = null;
  return cloned;
}
