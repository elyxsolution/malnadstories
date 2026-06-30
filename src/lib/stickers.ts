import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';

/**
 * Sticker catalog read model (mirrors covers.ts).
 *
 * `listActiveStickers` powers the builder's Stickers panel (active rows, grouped by category,
 * presigned). `resolveStickerUrls` resolves specific sticker ids via the service role — used by
 * the PDF print route, the flipbook, and the admin preview, which must render the stickers an
 * album already references EVEN IF a sticker was later deactivated (same policy as covers).
 */

export type StickerOption = {
  id: string;
  name: string;
  categoryId: string | null;
  url: string; // full master (presigned)
  thumbUrl: string; // thumbnail (presigned), falls back to master
};

export type StickerCategory = { id: string; name: string; slug: string; stickers: StickerOption[] };

type CategoryRow = { id: string; name: string; slug: string; sort: number };
type StickerRow = { id: string; name: string; category_id: string | null; image_key: string; thumb_key: string | null };

/** Active stickers grouped by category, for the customer-facing builder panel. */
export async function listActiveStickers(): Promise<StickerCategory[]> {
  const supabase = createClient();
  const [{ data: catData }, { data: stickerData }] = await Promise.all([
    supabase.from('sticker_categories').select('id, name, slug, sort').order('sort', { ascending: true }),
    supabase.from('stickers').select('id, name, category_id, image_key, thumb_key').eq('active', true).order('sort', { ascending: true }),
  ]);

  const stickers: StickerOption[] = await Promise.all(
    ((stickerData ?? []) as StickerRow[]).map(async (s) => ({
      id: s.id,
      name: s.name,
      categoryId: s.category_id,
      url: await presignGet(s.image_key, 3600),
      thumbUrl: await presignGet(s.thumb_key ?? s.image_key, 3600),
    })),
  );

  const byCat = new Map<string | null, StickerOption[]>();
  for (const s of stickers) {
    const list = byCat.get(s.categoryId) ?? [];
    list.push(s);
    byCat.set(s.categoryId, list);
  }

  const categories: StickerCategory[] = ((catData ?? []) as CategoryRow[])
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug, stickers: byCat.get(c.id) ?? [] }))
    .filter((c) => c.stickers.length > 0);

  const uncategorized = byCat.get(null) ?? [];
  if (uncategorized.length > 0) categories.push({ id: 'uncategorized', name: 'Other', slug: 'other', stickers: uncategorized });

  return categories;
}

/**
 * Presigned URLs for specific sticker ids (service role → resolves regardless of `active`). Used
 * wherever an album's ALREADY-PLACED stickers must render: the builder hydration, the flipbook,
 * the PDF print route, and the admin preview. Returns an id → url map.
 */
export async function resolveStickerUrls(ids: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return {};
  const svc = createServiceClient();
  const { data } = await svc.from('stickers').select('id, image_key').in('id', unique);
  const out: Record<string, string> = {};
  await Promise.all(
    ((data ?? []) as { id: string; image_key: string }[]).map(async (r) => {
      out[r.id] = await presignGet(r.image_key, 3600);
    }),
  );
  return out;
}
