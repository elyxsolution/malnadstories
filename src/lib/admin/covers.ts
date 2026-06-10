import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';
import { checkCoverResolution } from '@/lib/covers';

export type AdminCover = {
  id: string;
  name: string;
  description: string | null;
  thumbUrl: string;
  active: boolean;
  sort: number;
  createdAt: string;
  width: number | null;
  height: number | null;
  lowRes: boolean; // below the recommended 300-DPI cover size
  usedBy: number; // albums referencing this cover (drives soft- vs hard-delete)
};

type Row = {
  id: string;
  name: string;
  description: string | null;
  image_key: string;
  thumb_key: string | null;
  width: number | null;
  height: number | null;
  active: boolean;
  sort: number;
  created_at: string;
};

/**
 * Admin catalogue read: EVERY cover template (active + inactive), presigned (thumbnail,
 * falling back to the master) for the management grid, with a low-resolution flag and a
 * usage count. Service role (bypasses RLS) — gated by requireAdmin() at the page.
 */
export async function listAllCovers(): Promise<AdminCover[]> {
  const svc = createServiceClient();
  const { data } = await svc
    .from('cover_templates')
    .select('id, name, description, image_key, thumb_key, width, height, active, sort, created_at')
    .order('sort', { ascending: true })
    .order('created_at', { ascending: false });

  // Usage counts: tally albums.cover_template_id in one pass (catalogue is small).
  const { data: albumRefs } = await svc
    .from('albums')
    .select('cover_template_id')
    .not('cover_template_id', 'is', null);
  const usage = new Map<string, number>();
  for (const r of (albumRefs ?? []) as { cover_template_id: string }[]) {
    usage.set(r.cover_template_id, (usage.get(r.cover_template_id) ?? 0) + 1);
  }

  return Promise.all(
    ((data ?? []) as Row[]).map(async (c) => {
      const res = checkCoverResolution(c.width, c.height);
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        thumbUrl: await presignGet(c.thumb_key ?? c.image_key, 3600),
        active: c.active,
        sort: c.sort,
        createdAt: c.created_at,
        width: c.width,
        height: c.height,
        lowRes: res.known && res.belowRecommended,
        usedBy: usage.get(c.id) ?? 0,
      };
    }),
  );
}
