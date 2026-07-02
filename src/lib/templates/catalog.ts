import 'server-only';
import { unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';
import { recordTiming } from '@/lib/observability/log';
import { PERF_THRESHOLDS } from '@/lib/observability/model';
import { CACHE_TAGS, CACHE_TTL } from '@/lib/cache';
import { validateGeometry, normalizeGeometry, type TemplateCategory, type TemplateGeometry } from './model';
import { normalizeBlueprint, type Blueprint } from '@/lib/builder/blueprint';

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
    .is('blueprint', null) // presets only — whole-album blueprints are served separately
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

// ── Album Blueprints (0043) ────────────────────────────────────────────────────
// The active whole-album blueprint catalog (creation flow + admin). Blueprints live in the SAME
// layout_templates table (blueprint IS NOT NULL); read via the service role, cached under the same
// `templates-active` tag so any layout-template mutation refreshes both. Only ACTIVE blueprints are
// returned → only active blueprints are ever user-visible. Stats are stored (derived on write).
export type ActiveBlueprint = {
  id: string;
  name: string;
  description: string | null;
  category: TemplateCategory;
  pageCount: number;
  slotCount: number;
  recommendedPhotos: number;
  featured: boolean;
  popular: boolean;
  pinned: boolean;
  isNew: boolean;
  blueprint: Blueprint;
  thumbKey: string | null;
};

/** A blueprint is "Recently added" within this window. */
const BLUEPRINT_NEW_DAYS = 21;

const fetchActiveBlueprints = async (): Promise<ActiveBlueprint[]> => {
  const startedAt = Date.now();
  const svc = createServiceClient();
  const { data } = await svc
    .from('layout_templates')
    .select('id, name, description, category, page_count, slot_count, recommended_photos, featured, popular, pinned, blueprint, thumb_key, created_at')
    .eq('status', 'active')
    .not('blueprint', 'is', null)
    .order('pinned', { ascending: false })
    .order('featured', { ascending: false })
    .order('sort', { ascending: true })
    .order('updated_at', { ascending: false });
  recordTiming('blueprints', 'listActive', Date.now() - startedAt, PERF_THRESHOLDS.slowQueryMs, { category: 'system' });

  const rows = (data ?? []) as {
    id: string;
    name: string;
    description: string | null;
    category: string;
    page_count: number | null;
    slot_count: number | null;
    recommended_photos: number | null;
    featured: boolean;
    popular: boolean;
    pinned: boolean;
    blueprint: unknown;
    thumb_key: string | null;
    created_at: string;
  }[];

  const newCutoff = Date.now() - BLUEPRINT_NEW_DAYS * 24 * 60 * 60 * 1000;
  const out: ActiveBlueprint[] = [];
  for (const r of rows) {
    const bp = normalizeBlueprint(r.blueprint);
    if (!bp) continue; // defense in depth
    out.push({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category as TemplateCategory,
      pageCount: r.page_count ?? 0,
      slotCount: r.slot_count ?? 0,
      recommendedPhotos: r.recommended_photos ?? r.slot_count ?? 0,
      featured: r.featured,
      popular: r.popular,
      pinned: r.pinned,
      isNew: new Date(r.created_at).getTime() >= newCutoff,
      blueprint: bp,
      thumbKey: r.thumb_key,
    });
  }
  return out;
};

const getActiveBlueprintsCached = unstable_cache(fetchActiveBlueprints, ['blueprints-active'], {
  tags: [CACHE_TAGS.templatesActive],
  revalidate: CACHE_TTL.templatesActive,
});

export type BlueprintOption = ActiveBlueprint & { thumbUrl: string | null };

/** Active blueprints with a short-lived presigned thumbnail URL (signed OUTSIDE the cache). */
export async function listActiveBlueprints(): Promise<BlueprintOption[]> {
  const rows = await getActiveBlueprintsCached();
  return Promise.all(
    rows.map(async (r) => ({ ...r, thumbUrl: r.thumbKey ? await presignGet(r.thumbKey, 3600) : null })),
  );
}

/** One active blueprint by id (creation-apply path). */
export async function getActiveBlueprint(id: string): Promise<ActiveBlueprint | null> {
  const rows = await getActiveBlueprintsCached();
  return rows.find((r) => r.id === id) ?? null;
}
