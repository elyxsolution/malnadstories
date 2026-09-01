import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';
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
  trimBaseIds,
} from '@/lib/builder/model';
import { normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';
import { resolveCoverImageKeys } from '@/lib/albums/cover';
import { resolveStickerUrls } from '@/lib/stickers';
import { getProductDimensions } from '@/lib/products/catalog';
import { FALLBACK_DIMENSIONS, type ProductDimensions } from '@/lib/products/model';

/**
 * THE PRINT DATA LOADER — one read of everything a print route renders.
 *
 * Extracted from the preview print route so the two printer-ready exports read the album EXACTLY
 * the way the preview does. This is not tidying: three routes each assembling their own view of an
 * album is three chances for the printed book to disagree with the preview the customer approved.
 * The preview route now calls this too, so "the PDF shows what the preview showed" stays true by
 * construction rather than by inspection.
 *
 * SERVICE ROLE, deliberately. A print route has no session — it is reached only by the worker's
 * headless Chromium with a validated single-use token (`validatePrintToken`), and the token IS the
 * authorization. This loader must therefore only ever be called AFTER that gate has passed.
 *
 * Presign TTLs are 900s: long enough for the worker to finish a 48-page render, short enough that a
 * leaked URL is worthless. Only `sanitized_key` is ever presigned — never the raw upload.
 */

const PRESIGN_TTL_S = 900;

type PhotoRow = { id: string; edit_config: EditConfig | null; sanitized_key: string | null };
type PageRow = {
  page_number: number;
  layout_template: string | null;
  caption: string | null;
  photo_ids: string[] | null;
  layout_config: {
    overlays?: Overlay[];
    /** Per-base-slot placement edits (see `Block.baseEdits`). Absent on every pre-existing row. */
    baseEdits?: (EditConfig | null)[];
    texts?: TextElement[];
    qrs?: QrElement[];
    stickers?: StickerElement[];
    background?: Background | null;
  } | null;
};

export type PrintPhotoData = { id: string; url: string; edit: EditConfig | null };

export type PrintAlbumData = {
  readonly album: { id: string; title: string; size: number };
  /** Physical page dimensions from the album's product (0047), or the legacy fallback. */
  readonly dimensions: ProductDimensions;
  readonly coverConfig: CoverConfig;
  readonly coverImageUrl: string | null;
  readonly backCoverImageUrl: string | null;
  readonly photos: readonly PrintPhotoData[];
  readonly blocks: readonly Block[];
  readonly stickerUrls: Record<string, string>;
  /**
   * Photos placed as OVERLAYS on a cover face, by id.
   *
   * Separate from `photos` because the cover-only export deliberately does not load the album's
   * photo set (up to 128 presigns for images the cover never shows). A cover overlay is a specific,
   * named handful, so it is resolved on its own — but through the SAME sanitized-master rule:
   * only `ready` photos, never the raw original.
   */
  readonly coverPhotos: Record<string, PrintPhotoData>;
};

export type PrintLoadOptions = {
  /** Load + presign album photos and content blocks. Off for the cover-only export. */
  readonly content?: boolean;
  /** Resolve + presign the cover artwork. Off for the content-only export. */
  readonly cover?: boolean;
};

/**
 * Load one album for printing. Returns `null` when the album no longer exists (→ the caller 404s).
 *
 * `options` narrows the work, not the meaning: skipping the cover skips two presigns and a
 * resolver, and skipping content skips the photo + page reads. Anything not loaded comes back
 * empty, never stale or fabricated.
 */
export async function loadPrintAlbum(
  albumId: string,
  options: PrintLoadOptions = { content: true, cover: true },
): Promise<PrintAlbumData | null> {
  const wantContent = options.content ?? false;
  const wantCover = options.cover ?? false;
  const supabase = createServiceClient();

  const { data: albumData } = await supabase
    .from('albums')
    .select('id, title, size, cover_template_id, product_id')
    .eq('id', albumId)
    .maybeSingle();
  if (!albumData) return null;
  // `size` (the content page count) is read for two reasons: the preview's spine proportion
  // derives from it, and the content export asserts it against the pages it actually emits.
  const albumRow = albumData as {
    id: string;
    title: string;
    size: number;
    cover_template_id: string | null;
    product_id: string | null;
  };

  // Physical page dimensions from the album's product (0047). Never hardcoded — a null/legacy
  // album (no product_id) falls back to the Standard-equivalent defaults so the PDF still renders.
  const dimensions = (await getProductDimensions(albumRow.product_id)) ?? FALLBACK_DIMENSIONS;

  // Custom cover design (0038). Best-effort: a not-yet-migrated `cover_config` column returns an
  // error (not a throw) → we keep defaults, so the PDF still renders.
  const { data: cfgRow } = await supabase
    .from('albums')
    .select('cover_config')
    .eq('id', albumId)
    .maybeSingle();
  const coverConfig = normalizeCoverConfig(
    (cfgRow as { cover_config?: unknown } | null)?.cover_config as Parameters<typeof normalizeCoverConfig>[0],
  );

  // Resolve the cover IMAGE via the CANONICAL resolver — the SAME priority chain
  // (photo → template → design/default) that validation, checkout and the builder use, so the
  // printed cover can never disagree with what those layers reported.
  let coverImageUrl: string | null = null;
  let backCoverImageUrl: string | null = null;
  if (wantCover) {
    const coverKeys = await resolveCoverImageKeys(supabase, {
      id: albumId,
      cover_template_id: albumRow.cover_template_id,
      cover_config: coverConfig,
    });
    coverImageUrl = coverKeys.front.key ? await presignGet(coverKeys.front.key, PRESIGN_TTL_S) : null;
    backCoverImageUrl = coverKeys.back.key ? await presignGet(coverKeys.back.key, PRESIGN_TTL_S) : null;
  }

  let photos: PrintPhotoData[] = [];
  let blocks: Block[] = [];
  const coverPhotos: Record<string, PrintPhotoData> = {};

  if (wantContent) {
    // Only 'ready' photos have a sanitized key; presign the full-res master. Never the raw original.
    const { data: photoData } = await supabase
      .from('photos')
      .select('id, edit_config, sanitized_key, status')
      .eq('album_id', albumId)
      .eq('status', 'ready');

    const photoRows = (photoData ?? []) as PhotoRow[];
    photos = await Promise.all(
      photoRows
        .filter((r) => r.sanitized_key)
        .map(async (r) => ({
          id: r.id,
          url: await presignGet(r.sanitized_key as string, PRESIGN_TTL_S),
          edit: r.edit_config,
        })),
    );
    const photoIdSet = new Set(photos.map((p) => p.id));

    const { data: pageData } = await supabase
      .from('album_pages')
      .select('page_number, layout_template, caption, photo_ids, layout_config')
      .eq('album_id', albumId)
      .order('page_number', { ascending: true });

    const isTemplate = (t: string | null): t is LayoutTemplate =>
      !!t && (LAYOUT_TEMPLATES as readonly string[]).includes(t);

    blocks = ((pageData ?? []) as PageRow[])
      .filter((r) => isTemplate(r.layout_template))
      .map((r) => ({
        key: `${r.page_number}`,
        template: r.layout_template as LayoutTemplate,
        // Vacate the slot of a photo that no longer exists — never compact the row, or the right
        // page's photo slides onto the left. `trimBaseIds` drops trailing holes only.
        photoIds: trimBaseIds((r.photo_ids ?? []).map((id) => (id && photoIdSet.has(id) ? id : null))),
        // The printed book must use the SAME per-placement edit the customer saw, so this rides
        // through verbatim — a base slot cropped one way on page 1 and another way on page 5 is
        // two different pictures, and the PDF has to agree with the preview about both.
        baseEdits: r.layout_config?.baseEdits,
        caption: r.caption ?? '',
        // Print is the FINAL physical book: only overlays with a real, still-present photo render.
        // Empty placeholders (photoId=null) and deleted-photo overlays are intentionally excluded
        // so an unfilled container never prints as an empty box.
        overlays: (r.layout_config?.overlays ?? []).filter((o) => o.photoId != null && photoIdSet.has(o.photoId)),
        texts: r.layout_config?.texts ?? [],
        qrs: r.layout_config?.qrs ?? [],
        stickers: r.layout_config?.stickers ?? [],
        background: r.layout_config?.background ?? null,
      }));
  }

  // Cover overlays: presign exactly the photos the cover faces place, and no others. Runs for the
  // cover-only export too, which is the whole reason it is not folded into the `wantContent` read.
  if (wantCover) {
    const ids = Array.from(new Set(coverConfig.back.overlays.map((o) => o.photoId).filter((id): id is string => !!id)));
    if (ids.length > 0) {
      const { data: coverPhotoData } = await supabase
        .from('photos')
        .select('id, edit_config, sanitized_key, status')
        .eq('album_id', albumId)
        .eq('status', 'ready')
        .in('id', ids);
      for (const r of (coverPhotoData ?? []) as PhotoRow[]) {
        if (!r.sanitized_key) continue;
        coverPhotos[r.id] = { id: r.id, url: await presignGet(r.sanitized_key, PRESIGN_TTL_S), edit: r.edit_config };
      }
    }
  }

  // Resolve presigned URLs for every sticker the album references (pages + cover) — by id, via the
  // service role, so a deactivated-but-placed sticker still prints. PDF == builder preview.
  const stickerUrls = await resolveStickerUrls([
    ...blocks.flatMap((b) => b.stickers.map((s) => s.stickerId)),
    ...(wantCover
      ? [
          ...coverConfig.stickers.map((s) => s.stickerId),
          ...coverConfig.back.stickers.map((s) => s.stickerId),
        ]
      : []),
  ]);

  return {
    album: { id: albumRow.id, title: albumRow.title, size: albumRow.size },
    dimensions,
    coverConfig,
    coverImageUrl,
    backCoverImageUrl,
    photos,
    blocks,
    stickerUrls,
    coverPhotos,
  };
}
