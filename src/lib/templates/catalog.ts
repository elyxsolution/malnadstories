import 'server-only';
import { unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { recordTiming } from '@/lib/observability/log';
import { PERF_THRESHOLDS } from '@/lib/observability/model';
import { CACHE_TAGS, CACHE_TTL } from '@/lib/cache';
import { validateGeometry, normalizeGeometry, type TemplateCategory, type TemplateGeometry } from './model';

/**
 * Active layout-template catalog for the builder + auto-layout. Read via the service role
 * (the active catalog is a global, non-user-owned list, like the covers/album_pdfs loaders).
 * Only ACTIVE rows whose geometry STILL validates are returned, so an unselectable or
 * malformed template can never reach the builder/renderer — PDF parity by construction.
 *
 * Phase 10D: CACHED (unstable_cache, tag `templates-active`) — it's a global, slowly-changing
 * list read on every build-page load. The geometry re-validation runs INSIDE the cache, so the
 * cached output is already the safe, validated list. Admin template save/activate/deactivate/
 * duplicate call `revalidateTag('templates-active')`, so the catalog refreshes instantly; the
 * TTL is only a backstop.
 */
export type ActiveTemplate = {
  id: string;
  name: string;
  category: TemplateCategory;
  geometry: TemplateGeometry;
};

const fetchActiveTemplates = async (): Promise<ActiveTemplate[]> => {
  const startedAt = Date.now();
  const svc = createServiceClient();
  const { data } = await svc
    .from('layout_templates')
    .select('id, name, category, geometry')
    .eq('status', 'active')
    .order('category', { ascending: true })
    .order('updated_at', { ascending: false });
  recordTiming('templates', 'listActive', Date.now() - startedAt, PERF_THRESHOLDS.slowQueryMs, {
    category: 'system',
  });

  const rows = (data ?? []) as { id: string; name: string; category: string; geometry: unknown }[];
  const out: ActiveTemplate[] = [];
  for (const r of rows) {
    // Defense in depth: skip any active row that no longer validates.
    if (!validateGeometry(r.geometry).ok) continue;
    out.push({
      id: r.id,
      name: r.name,
      category: r.category as TemplateCategory,
      geometry: normalizeGeometry(r.geometry),
    });
  }
  return out;
};

const getActiveTemplatesCached = unstable_cache(fetchActiveTemplates, ['templates-active'], {
  tags: [CACHE_TAGS.templatesActive],
  revalidate: CACHE_TTL.templatesActive,
});

export async function listActiveTemplates(): Promise<ActiveTemplate[]> {
  return getActiveTemplatesCached();
}
