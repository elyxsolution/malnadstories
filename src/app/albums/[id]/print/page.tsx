import { notFound } from 'next/navigation';
import { createHash } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';
import PrintAlbum, { type PrintPhoto, type PrintCover } from './_print-album';
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
import { normalizeCoverConfig } from '@/lib/builder/cover';
import { resolveCoverImageKeys } from '@/lib/albums/cover';
import { resolveStickerUrls } from '@/lib/stickers';
import { builderFontVars } from '@/lib/fonts';
import { getProductDimensions } from '@/lib/products/catalog';
import { FALLBACK_DIMENSIONS } from '@/lib/products/model';

// No caching: this route is token-gated and renders live album data for the worker.
// `force-dynamic` forces dynamic RENDERING, but the per-fetch Data Cache can still
// serve a stale supabase-js GET (the PostgREST URL is identical every request) — that
// made the route validate a cached album_pdfs row (old token/expiry) while the worker
// read live. `force-no-store` makes every fetch in this route read live.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

type PhotoRow = { id: string; edit_config: EditConfig | null; sanitized_key: string | null };
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
 * /albums/[id]/print?t=<token>
 *
 * NOT publicly accessible. Reached only by the worker's headless Chromium with a
 * short-lived, single-use token. We validate the token (service role), mark it used,
 * then render the album via service access (the token IS the authorization here).
 * Any invalid/expired/used token → 404, leaking nothing.
 */
export default async function PrintPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { t?: string };
}) {
  const token = searchParams.t;
  if (!token) {
    console.warn('[print] 404: no token', { albumId: params.id, tokenPresent: false });
    notFound();
  }

  const supabase = createServiceClient();
  const tokenHash = createHash('sha256').update(token).digest('hex');

  // Bounded-reuse window: a single page.goto by the worker triggers more than one
  // request to this route (the HTML document AND Next's RSC/data fetch), so strict
  // first-hit invalidation 404s the second one. Instead the token is valid while:
  //   - the hash matches this album, AND
  //   - it has not passed its absolute expiry (token_expires_at), AND
  //   - it is unused OR was first used within REUSE_WINDOW_MS.
  // The window is anchored to FIRST use (we stamp token_used_at only when null), so
  // reuse is bounded to one short burst — it can't be replayed later.
  const REUSE_WINDOW_MS = 2 * 60 * 1000; // covers one PDF job's in-render requests

  const { data: pdfRow } = await supabase
    .from('album_pdfs')
    .select('album_id, token_hash, token_expires_at, token_used_at')
    .eq('album_id', params.id)
    .maybeSingle();

  const row = pdfRow as
    | {
        album_id: string;
        token_hash: string | null;
        token_expires_at: string | null;
        token_used_at: string | null;
      }
    | null;

  // Diagnostics: the exact row (PK + expiry) the route actually loaded. With the
  // Data Cache disabled this must now match what the worker logs.
  console.log('[print] loaded album_pdfs row', {
    requestedAlbumId: params.id,
    rowPk: row?.album_id ?? null,
    tokenHash: row?.token_hash?.slice(0, 8) ?? null,
    tokenExpiresAt: row?.token_expires_at ?? null,
    tokenUsedAt: row?.token_used_at ?? null,
  });

  const now = Date.now();
  const usedAt = row?.token_used_at ? new Date(row.token_used_at).getTime() : null;
  const notExpired = !!row?.token_expires_at && new Date(row.token_expires_at).getTime() > now;
  const withinReuse = usedAt === null || now - usedAt <= REUSE_WINDOW_MS;

  const hashMatch = !!row?.token_hash && row.token_hash === tokenHash;
  const valid = !!row && hashMatch && notExpired && withinReuse;

  if (!valid) {
    // Log the PRECISE rejection reason before returning the generic 404. (These land
    // in the Next app terminal — `pnpm dev` — not the worker terminal.) The token
    // itself is never logged.
    console.warn('[print] 404: token rejected', {
      albumId: params.id,
      tokenPresent: true,
      rowFound: !!row,
      hashMatch,
      expired: !notExpired,
      tokenExpiresAt: row?.token_expires_at ?? null,
      tokenUsedAt: row?.token_used_at ?? null,
      withinReuse,
      now: new Date(now).toISOString(),
    });
    notFound();
  }

  // Anchor the window to first use only. The `.is('token_used_at', null)` guard makes
  // this idempotent + race-safe: when the document and RSC requests arrive together,
  // both pass validation, only the first stamps, and neither moves the window forward.
  if (usedAt === null) {
    await supabase
      .from('album_pdfs')
      .update({ token_used_at: new Date(now).toISOString() })
      .eq('album_id', params.id)
      .eq('token_hash', tokenHash)
      .is('token_used_at', null);
  }

  const { data: albumData } = await supabase
    .from('albums')
    .select('id, title, size, cover_template_id, product_id')
    .eq('id', params.id)
    .maybeSingle();
  if (!albumData) notFound();
  // `size` (the leaf count) is read for one reason: the spine's printed width derives from it,
  // via the same `spineWidthFor` the builder and the preview use.
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

  // Custom cover design (0038). Best-effort: a not-yet-migrated `cover_config` column
  // returns an error (not a throw) → we keep defaults, so the PDF still renders.
  const { data: cfgRow } = await supabase.from('albums').select('cover_config').eq('id', params.id).maybeSingle();
  const coverConfig = normalizeCoverConfig(
    (cfgRow as { cover_config?: unknown } | null)?.cover_config as Parameters<typeof normalizeCoverConfig>[0],
  );

  // Resolve the cover IMAGE via the CANONICAL resolver (Section 3) — the SAME priority chain
  // (photo → template → design/default) that validation, checkout and the builder use, so the
  // printed cover can never disagree with what those layers reported. The composition
  // (title/tagline/typography/layout) comes from coverConfig; a design/default cover has no image
  // key and the renderer draws the CSS/brand-green backdrop. Presign TTL is local to this route.
  const coverKeys = await resolveCoverImageKeys(supabase, {
    id: params.id,
    cover_template_id: albumRow.cover_template_id,
    cover_config: coverConfig,
  });
  const coverImageUrl = coverKeys.front.key ? await presignGet(coverKeys.front.key, 900) : null;
  const backCoverImageUrl = coverKeys.back.key ? await presignGet(coverKeys.back.key, 900) : null;

  const cover: PrintCover = { imageUrl: coverImageUrl, backImageUrl: backCoverImageUrl, config: coverConfig, title: albumRow.title, size: albumRow.size };

  // Only 'ready' photos have a sanitized key; presign the full-res master (longer
  // TTL so the worker finishes within the window). Never the raw original.
  const { data: photoData } = await supabase
    .from('photos')
    .select('id, edit_config, sanitized_key, status')
    .eq('album_id', params.id)
    .eq('status', 'ready');

  const photoRows = (photoData ?? []) as PhotoRow[];
  const photos: PrintPhoto[] = await Promise.all(
    photoRows
      .filter((r) => r.sanitized_key)
      .map(async (r) => ({
        id: r.id,
        url: await presignGet(r.sanitized_key as string, 900),
        edit: r.edit_config,
      })),
  );
  const photoIdSet = new Set(photos.map((p) => p.id));

  const { data: pageData } = await supabase
    .from('album_pages')
    .select('page_number, layout_template, caption, photo_ids, layout_config')
    .eq('album_id', params.id)
    .order('page_number', { ascending: true });

  const isTemplate = (t: string | null): t is LayoutTemplate =>
    !!t && (LAYOUT_TEMPLATES as readonly string[]).includes(t);

  const blocks: Block[] = ((pageData ?? []) as PageRow[])
    .filter((r) => isTemplate(r.layout_template))
    .map((r) => ({
      key: `${r.page_number}`,
      template: r.layout_template as LayoutTemplate,
      photoIds: (r.photo_ids ?? []).filter((id) => photoIdSet.has(id)),
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

  // Resolve presigned URLs for every sticker the album references (pages + cover) — by id, via
  // the service role, so a deactivated-but-placed sticker still prints. PDF == builder preview.
  const stickerUrls = await resolveStickerUrls([
    ...blocks.flatMap((b) => b.stickers.map((s) => s.stickerId)),
    ...coverConfig.stickers.map((s) => s.stickerId),
    ...coverConfig.back.stickers.map((s) => s.stickerId),
  ]);

  console.log('[print] rendering album', {
    albumId: params.id,
    blocks: blocks.length,
    readyPhotos: photos.length,
    hasCover: !!cover,
  });

  // Wrap in the full builder font library so every selectable typeface resolves in the PDF
  // (this route is outside the (app) group; the root layout only carries the brand fonts).
  return (
    <div className={builderFontVars}>
      <PrintAlbum blocks={blocks} photos={photos} cover={cover} dimensions={dimensions} stickerUrls={stickerUrls} />
    </div>
  );
}
