import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ContentType } from './model';

/**
 * Public, published-only content reads — the SINGLE entry point for every customer-facing
 * CMS page, so draft/archived content can never leak by construction.
 *
 * Uses the anon/authenticated Supabase client: RLS already restricts non-admins to
 * status='published', and we ALSO filter explicitly here (defense in depth). Ordered for
 * display: featured first (when present in metadata), then most-recently published.
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

export async function listPublished(type: ContentType): Promise<PublicContent[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('content_pages')
    .select('id, type, title, slug, excerpt, content, cover_image, metadata, published_at')
    .eq('type', type)
    .eq('status', 'published')
    .order('published_at', { ascending: false });

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
