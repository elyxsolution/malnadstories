import 'server-only';
import { unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';
import { recordTiming } from '@/lib/observability/log';
import { PERF_THRESHOLDS } from '@/lib/observability/model';
import { CACHE_TAGS, CACHE_TTL } from '@/lib/cache';
import { normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';
import { validateCoverConfig, type CoverTemplateCategory } from './model';

/**
 * Active cover-design-template catalog for the creation wizard + builder "Choose template".
 * Read via the service role (a global, non-user-owned list, like the covers/templates loaders).
 * Only ACTIVE rows whose config STILL validates are returned, so a malformed/unselectable
 * template can never reach the customer — parity by construction.
 *
 * CACHED (unstable_cache, tag `cover-templates-active`) — a global, slowly-changing list read
 * on the creation + build pages. The config re-validation runs INSIDE the cache. Admin
 * save/activate/deactivate/archive/duplicate call revalidateTag(coverTemplatesActive), so it
 * refreshes instantly; the TTL is only a backstop. previewUrl is presigned OUTSIDE the cache
 * (short-lived signed URLs must not be cached).
 */
/** A template is surfaced under "Recently added" when created within this window. */
export const COVER_TEMPLATE_NEW_DAYS = 21;

export type ActiveCoverTemplate = {
  id: string;
  name: string;
  description: string | null;
  category: CoverTemplateCategory;
  featured: boolean;
  popular: boolean;
  pinned: boolean;
  isNew: boolean;
  config: CoverConfig;
  previewKey: string | null;
  thumbKey: string | null;
};

const fetchActiveCoverTemplates = async (): Promise<ActiveCoverTemplate[]> => {
  const startedAt = Date.now();
  const svc = createServiceClient();
  const { data } = await svc
    .from('cover_design_templates')
    .select('id, name, description, category, featured, popular, pinned, config, preview_key, thumb_key, created_at')
    .eq('status', 'active')
    .order('pinned', { ascending: false })
    .order('featured', { ascending: false })
    .order('sort', { ascending: true })
    .order('updated_at', { ascending: false });
  recordTiming('cover-templates', 'listActive', Date.now() - startedAt, PERF_THRESHOLDS.slowQueryMs, {
    category: 'system',
  });

  const rows = (data ?? []) as {
    id: string;
    name: string;
    description: string | null;
    category: string;
    featured: boolean;
    popular: boolean;
    pinned: boolean;
    config: unknown;
    preview_key: string | null;
    thumb_key: string | null;
    created_at: string;
  }[];

  const newCutoff = Date.now() - COVER_TEMPLATE_NEW_DAYS * 24 * 60 * 60 * 1000;
  const out: ActiveCoverTemplate[] = [];
  for (const r of rows) {
    // Defense in depth: skip any active row whose config no longer validates.
    if (!validateCoverConfig(r.config).ok) continue;
    out.push({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category as CoverTemplateCategory,
      featured: r.featured,
      popular: r.popular,
      pinned: r.pinned,
      isNew: new Date(r.created_at).getTime() >= newCutoff,
      config: normalizeCoverConfig(r.config as Parameters<typeof normalizeCoverConfig>[0]),
      previewKey: r.preview_key,
      thumbKey: r.thumb_key,
    });
  }
  return out;
};

const getActiveCoverTemplatesCached = unstable_cache(fetchActiveCoverTemplates, ['cover-templates-active'], {
  tags: [CACHE_TAGS.coverTemplatesActive],
  revalidate: CACHE_TTL.coverTemplatesActive,
});

/** Active templates with a short-lived presigned preview URL (signed OUTSIDE the cache). */
export type CoverTemplateOption = ActiveCoverTemplate & { previewUrl: string | null };

export async function listActiveCoverTemplates(): Promise<CoverTemplateOption[]> {
  const rows = await getActiveCoverTemplatesCached();
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      previewUrl: r.thumbKey || r.previewKey ? await presignGet((r.thumbKey ?? r.previewKey) as string, 3600) : null,
    })),
  );
}

/** The config for a single active template, by id (for the album-apply path). */
export async function getActiveCoverTemplateConfig(id: string): Promise<CoverConfig | null> {
  const rows = await getActiveCoverTemplatesCached();
  return rows.find((r) => r.id === id)?.config ?? null;
}
