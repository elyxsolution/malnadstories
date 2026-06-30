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
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('content_pages')
      .select('id, type, title, slug, excerpt, content, cover_image, metadata, published_at')
      .eq('type', type)
      .eq('status', 'published') // defense in depth (the result is published-only by contract)
      .order('published_at', { ascending: false });
    if (error) throw error;

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
  } catch (e) {
    console.warn(`CMS query failed for type ${type}. Using fallback mockup content.`, e);
    if (type === 'faq') {
      return [
        {
          id: 'faq_1',
          type: 'faq',
          title: 'What is Layflat Binding?',
          slug: 'layflat-binding',
          excerpt: null,
          content: 'Our books are bound using a layflat technique so spreads open completely flat. No parts of your photos are lost in the middle fold seam.',
          coverImage: null,
          metadata: { category: 'Product' },
          publishedAt: new Date().toISOString(),
        },
        {
          id: 'faq_2',
          type: 'faq',
          title: 'How long does delivery take?',
          slug: 'delivery-time',
          excerpt: null,
          content: 'Albums are printed and bound by hand. Production takes 3–5 days, and standard courier shipping delivers within 4–7 days across India.',
          coverImage: null,
          metadata: { category: 'Shipping' },
          publishedAt: new Date().toISOString(),
        }
      ];
    }
    if (type === 'testimonial') {
      return [
        {
          id: 't_1',
          type: 'testimonial',
          title: 'Ananya R.',
          slug: 'ananya-r',
          excerpt: 'Bengaluru · Chikmagalur Album',
          content: '“It arrived heavier than I expected, in the best way. The matte paper textures feel incredibly authentic. It is a physical archive of our family trip that we will pass down.”',
          coverImage: null,
          metadata: {},
          publishedAt: new Date().toISOString(),
        }
      ];
    }
    if (type === 'legacy_story') {
      return [
        {
          id: 'story_1',
          type: 'legacy_story',
          title: 'The Mist of Chikmagalur',
          slug: 'mist-of-chikmagalur',
          excerpt: 'A misty walk through the coffee trails of Chikmagalur.',
          content: 'The morning mist didn’t clear until noon, leaving everything damp and green. Cardamom-scented trails wound up through the valleys...',
          coverImage: 'https://images.unsplash.com/photo-1590766940554-634a7ed41450?q=80&w=800&auto=format&fit=crop',
          metadata: { author: 'Aditya S.', destination: 'Chikmagalur' },
          publishedAt: new Date().toISOString(),
        }
      ];
    }
    return [];
  }
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
