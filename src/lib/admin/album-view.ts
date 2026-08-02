import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';
import { resolveStickerUrls } from '@/lib/stickers';
import type { Photo } from '@/lib/builder/photo';
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
import { normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';
import { resolveCoverImageKeys } from '@/lib/albums/cover';

/**
 * The cover, in the shape the shared `Preview` renderer takes. Structurally identical to the
 * customer surfaces' `PreviewCover` — declared here rather than imported so a server-only loader
 * doesn't reach into a client component for a type.
 */
export type AdminPreviewCover = {
  config: CoverConfig;
  title: string;
  size: number;
  frontImageUrl: string | null;
  backImageUrl: string | null;
};

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
  cover: AdminPreviewCover;
  stickerUrls: Record<string, string>;
} | null> {
  const svc = createServiceClient();

  const { data: albumRow } = await svc
    .from('albums')
    .select('id, title, size, cover_template_id, cover_config')
    .eq('id', albumId)
    .maybeSingle();
  if (!albumRow) return null;
  const album = albumRow as {
    id: string;
    title: string;
    size: number;
    cover_template_id: string | null;
    cover_config: unknown;
  };

  /**
   * THE CUSTOMER'S COVER, not the artwork underneath it.
   *
   * This used to presign `cover_templates.image_key` and hand the admin a bare PNG — so an admin
   * checking an album before it went to print saw the house template where the customer's title,
   * subtitle, photo and stickers would actually be. The image is now resolved through the
   * CANONICAL `resolveCoverImageKeys` (the same chain the print route uses) and the composition
   * comes from `cover_config`, so what the admin proofs is what the PDF renders.
   */
  const coverConfig = normalizeCoverConfig(album.cover_config as Parameters<typeof normalizeCoverConfig>[0]);
  const coverKeys = await resolveCoverImageKeys(svc, {
    id: album.id,
    cover_template_id: album.cover_template_id,
    cover_config: coverConfig,
  });
  const cover: AdminPreviewCover = {
    config: coverConfig,
    title: album.title,
    size: album.size,
    frontImageUrl: coverKeys.front.key ? await presignGet(coverKeys.front.key, 900) : null,
    backImageUrl: coverKeys.back.key ? await presignGet(coverKeys.back.key, 900) : null,
  };

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
      // Preserve overlay containers; an unassigned/deleted-photo overlay becomes an empty
      // placeholder (photoId=null) — it renders nothing in the admin preview/PDF but the slot
      // is not silently dropped (parallel to the builder's own hydration).
      overlays: (r.layout_config?.overlays ?? []).map((o) =>
        o.photoId && photoIdSet.has(o.photoId) ? o : { ...o, photoId: null },
      ),
      texts: r.layout_config?.texts ?? [],
      qrs: r.layout_config?.qrs ?? [],
      stickers: r.layout_config?.stickers ?? [],
      background: r.layout_config?.background ?? null,
    }));

  // Resolve presigned URLs for every referenced sticker (service role → ignores `active`).
  const stickerUrls = await resolveStickerUrls(blocks.flatMap((b) => b.stickers.map((s) => s.stickerId)));

  return { photos, blocks, cover, stickerUrls };
}
