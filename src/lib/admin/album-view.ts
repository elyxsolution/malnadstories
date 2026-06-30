import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';
import { resolveStickerUrls } from '@/lib/stickers';
import { type Photo } from '@/app/(app)/albums/[id]/build/_uploader';
import {
  LAYOUT_TEMPLATES,
  type Background,
  type Block,
  type EditConfig,
  type LayoutTemplate,
  type Overlay,
  type QrElement,
  type StickerElement,
  type TextElement,
} from '@/lib/builder/model';

type PhotoRow = {
  id: string;
  original_filename: string;
  edit_config: EditConfig | null;
  status: 'pending' | 'ready' | 'rejected';
  sanitized_key: string | null;
  thumb_key: string | null;
  taken_at: string | null;
};
type PageRow = {
  page_number: number;
  layout_template: string | null;
  caption: string | null;
  photo_ids: string[] | null;
  layout_config: {
    overlays?: Overlay[];
    texts?: TextElement[];
    qrs?: QrElement[];
    stickers?: StickerElement[];
    background?: Background | null;
  } | null;
};

/**
 * Load an album's photos + layout blocks for the ADMIN preview. Uses the service-role
 * client (bypasses RLS) so an admin can view any customer's album — this is gated by
 * requireAdmin() at the page level. Only SANITIZED derivatives are presigned (never
 * the raw upload), mirroring the customer builder.
 */
export async function loadAlbumForAdmin(
  albumId: string,
): Promise<{
  photos: Photo[];
  blocks: Block[];
  cover: { url: string; name: string } | null;
  stickerUrls: Record<string, string>;
} | null> {
  const svc = createServiceClient();

  const { data: albumRow } = await svc
    .from('albums')
    .select('id, cover_template_id')
    .eq('id', albumId)
    .maybeSingle();
  if (!albumRow) return null;

  // Selected cover (admin template), presigned for the preview.
  let cover: { url: string; name: string } | null = null;
  const coverTemplateId = (albumRow as { cover_template_id: string | null }).cover_template_id;
  if (coverTemplateId) {
    const { data: coverRow } = await svc
      .from('cover_templates')
      .select('name, image_key')
      .eq('id', coverTemplateId)
      .maybeSingle();
    const c = coverRow as { name: string; image_key: string } | null;
    if (c) cover = { url: await presignGet(c.image_key, 900), name: c.name };
  }

  const { data: photoData } = await svc
    .from('photos')
    .select('id, original_filename, edit_config, status, sanitized_key, thumb_key, taken_at')
    .eq('album_id', albumId)
    .order('taken_at', { ascending: true, nullsFirst: false })
    .order('uploaded_at', { ascending: true });

  const photoRows = (photoData ?? []) as PhotoRow[];
  const photos: Photo[] = await Promise.all(
    photoRows.map(async (r) => ({
      id: r.id,
      url: r.status === 'ready' && r.sanitized_key ? await presignGet(r.sanitized_key) : '',
      thumbUrl: r.status === 'ready' && r.thumb_key ? await presignGet(r.thumb_key) : '',
      filename: r.original_filename,
      edit: r.edit_config,
      status: r.status,
      takenAt: r.taken_at,
    })),
  );
  const photoIdSet = new Set(photos.map((p) => p.id));

  const { data: pageData } = await svc
    .from('album_pages')
    .select('page_number, layout_template, caption, photo_ids, layout_config')
    .eq('album_id', albumId)
    .order('page_number', { ascending: true });

  const isTemplate = (t: string | null): t is LayoutTemplate =>
    !!t && (LAYOUT_TEMPLATES as readonly string[]).includes(t);

  const blocks: Block[] = ((pageData ?? []) as PageRow[])
    .filter((r) => isTemplate(r.layout_template))
    .map((r) => ({
      key: crypto.randomUUID(),
      template: r.layout_template as LayoutTemplate,
      photoIds: (r.photo_ids ?? []).filter((id) => photoIdSet.has(id)),
      caption: r.caption ?? '',
      overlays: (r.layout_config?.overlays ?? []).filter((o) => photoIdSet.has(o.photoId)),
      texts: r.layout_config?.texts ?? [],
      qrs: r.layout_config?.qrs ?? [],
      stickers: r.layout_config?.stickers ?? [],
      background: r.layout_config?.background ?? null,
    }));

  // Resolve presigned URLs for every referenced sticker (service role → ignores `active`).
  const stickerUrls = await resolveStickerUrls(blocks.flatMap((b) => b.stickers.map((s) => s.stickerId)));

  return { photos, blocks, cover, stickerUrls };
}
