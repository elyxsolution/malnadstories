import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';

/**
 * Admin sticker catalogue read (mirrors lib/admin/covers.ts): EVERY sticker (active + inactive)
 * + all categories, presigned for the management grid. Service role (bypasses RLS) — gated by
 * requireCapability('sticker:manage') at the page.
 */
export type AdminSticker = {
  id: string;
  name: string;
  categoryId: string | null;
  thumbUrl: string;
  active: boolean;
  sort: number;
  createdAt: string;
};

export type AdminStickerCategory = { id: string; name: string; slug: string; sort: number };

type StickerRow = {
  id: string;
  name: string;
  category_id: string | null;
  image_key: string;
  thumb_key: string | null;
  active: boolean;
  sort: number;
  created_at: string;
};
type CategoryRow = { id: string; name: string; slug: string; sort: number };

export async function listAllStickers(): Promise<{ stickers: AdminSticker[]; categories: AdminStickerCategory[] }> {
  const svc = createServiceClient();
  const [{ data: catData }, { data: rows }] = await Promise.all([
    svc.from('sticker_categories').select('id, name, slug, sort').order('sort', { ascending: true }),
    svc
      .from('stickers')
      .select('id, name, category_id, image_key, thumb_key, active, sort, created_at')
      .order('sort', { ascending: true })
      .order('created_at', { ascending: false }),
  ]);

  const stickers: AdminSticker[] = await Promise.all(
    ((rows ?? []) as StickerRow[]).map(async (s) => ({
      id: s.id,
      name: s.name,
      categoryId: s.category_id,
      thumbUrl: await presignGet(s.thumb_key ?? s.image_key, 3600),
      active: s.active,
      sort: s.sort,
      createdAt: s.created_at,
    })),
  );

  const categories: AdminStickerCategory[] = ((catData ?? []) as CategoryRow[]).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    sort: c.sort,
  }));

  return { stickers, categories };
}
