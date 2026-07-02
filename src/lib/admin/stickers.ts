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
  tags: string[];
  thumbUrl: string;
  active: boolean;
  sort: number;
  createdAt: string;
  usageCount: number; // # of albums that have placed this sticker (best-effort)
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
  tags: string[] | null;
};
type CategoryRow = { id: string; name: string; slug: string; sort: number };

/**
 * Best-effort usage count: how many distinct ALBUMS reference each sticker id. Placements live only
 * as `stickerId`s inside album_pages.layout_config (pages) and albums.cover_config (front + back),
 * so we tally id → set(albumId) from those jsonb columns. Read via the service role; bounded by row
 * count (fine at launch scale). Never throws — a failure yields empty counts so the page still loads.
 */
async function stickerUsageCounts(svc: ReturnType<typeof createServiceClient>): Promise<Map<string, Set<string>>> {
  const counts = new Map<string, Set<string>>();
  const add = (stickerId: string, albumId: string) => {
    const set = counts.get(stickerId) ?? new Set<string>();
    set.add(albumId);
    counts.set(stickerId, set);
  };
  try {
    const [{ data: pageRows }, { data: albumRows }] = await Promise.all([
      svc.from('album_pages').select('album_id, layout_config'),
      svc.from('albums').select('id, cover_config'),
    ]);
    for (const r of (pageRows ?? []) as { album_id: string; layout_config: { stickers?: { stickerId?: string }[] } | null }[]) {
      for (const s of r.layout_config?.stickers ?? []) if (s?.stickerId) add(s.stickerId, r.album_id);
    }
    for (const r of (albumRows ?? []) as {
      id: string;
      cover_config: { stickers?: { stickerId?: string }[]; back?: { stickers?: { stickerId?: string }[] } } | null;
    }[]) {
      for (const s of r.cover_config?.stickers ?? []) if (s?.stickerId) add(s.stickerId, r.id);
      for (const s of r.cover_config?.back?.stickers ?? []) if (s?.stickerId) add(s.stickerId, r.id);
    }
  } catch (e) {
    console.error('[admin] stickerUsageCounts failed (continuing with empty counts):', e);
  }
  return counts;
}

export async function listAllStickers(): Promise<{ stickers: AdminSticker[]; categories: AdminStickerCategory[] }> {
  const svc = createServiceClient();
  const [{ data: catData }, { data: rows }, usage] = await Promise.all([
    svc.from('sticker_categories').select('id, name, slug, sort').order('sort', { ascending: true }),
    svc
      .from('stickers')
      .select('id, name, category_id, image_key, thumb_key, active, sort, created_at, tags')
      .order('sort', { ascending: true })
      .order('created_at', { ascending: false }),
    stickerUsageCounts(svc),
  ]);

  const stickers: AdminSticker[] = await Promise.all(
    ((rows ?? []) as StickerRow[]).map(async (s) => ({
      id: s.id,
      name: s.name,
      categoryId: s.category_id,
      tags: s.tags ?? [],
      thumbUrl: await presignGet(s.thumb_key ?? s.image_key, 3600),
      active: s.active,
      sort: s.sort,
      createdAt: s.created_at,
      usageCount: usage.get(s.id)?.size ?? 0,
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
