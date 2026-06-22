import 'server-only';
import { unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { recordTiming } from '@/lib/observability/log';
import { PERF_THRESHOLDS } from '@/lib/observability/model';
import { CACHE_TAGS, CACHE_TTL } from '@/lib/cache';
import type { ContentType } from './model';

/**
 * Public, published-only content reads — the SINGLE entry point for every customer-facing
 * CMS page, so draft/archived content can never leak by construction.
 *
 * Phase 10D: this is now CACHED (unstable_cache, tag `cms-public`) because it is global,
 * public, and read on every visit to /faq /testimonials /stories. The cached query runs
 * via the SERVICE client (no cookies → cacheable) but STILL filters `status='published'`
 * explicitly, so the result set is identical to the previous RLS-scoped anon read — only
 * published rows, never drafts/archived. The admin CMS write actions call
 * `revalidateTag('cms-public')`, so a publish/unpublish/archive busts the cache instantly;
 * the TTL is just a backstop.
 */
export type PublicContent = {
  id: string;
  type: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  coverImage: string | null;
  metadata: Record<string, unknown>;
  publishedAt: string | null;
};

async function fetchPublished(type: ContentType): Promise<PublicContent[]> {
  const startedAt = Date.now();
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('content_pages')
    .select('id, type, title, slug, excerpt, content, cover_image, metadata, published_at')
    .eq('type', type)
    .eq('status', 'published') // defense in depth (the result is published-only by contract)
    .order('published_at', { ascending: false });
  // Slow-read observability (Phase 10D) — only fires on a cache MISS (this runs only then).
  recordTiming('cms', `listPublished:${type}`, Date.now() - startedAt, PERF_THRESHOLDS.slowQueryMs, {
    category: 'system',
  });

  const rows = (data ?? []) as {
    id: string;
    type: string;
    title: string;
    slug: string;
    excerpt: string | null;
    content: string | null;
    cover_image: string | null;
    metadata: Record<string, unknown> | null;
    published_at: string | null;
  }[];

  return rows
    .map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      slug: r.slug,
      excerpt: r.excerpt,
      content: r.content,
      coverImage: r.cover_image,
      metadata: r.metadata ?? {},
      publishedAt: r.published_at,
    }))
    .sort((a, b) => Number(Boolean(b.metadata.featured)) - Number(Boolean(a.metadata.featured)));
}

// Cached wrapper — `type` is part of the cache key (unstable_cache includes call args), so each
// content type caches independently under the shared tag.
const getPublishedCached = unstable_cache(fetchPublished, ['cms-published'], {
  tags: [CACHE_TAGS.cmsPublic],
  revalidate: CACHE_TTL.cmsPublic,
});

export async function listPublished(type: ContentType): Promise<PublicContent[]> {
  return getPublishedCached(type);
}
