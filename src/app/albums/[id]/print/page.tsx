import { notFound } from 'next/navigation';
import { loadPrintAlbum } from '@/lib/pdf/print-data';
import { validatePrintToken } from '@/lib/pdf/print-token';
import { builderFontVars } from '@/lib/fonts';
import PrintAlbum, { type PrintCover } from './_print-album';

// No caching: this route is token-gated and renders live album data for the worker.
// `force-dynamic` forces dynamic RENDERING, but the per-fetch Data Cache can still
// serve a stale supabase-js GET (the PostgREST URL is identical every request) — that
// made the route validate a cached album_pdfs row (old token/expiry) while the worker
// read live. `force-no-store` makes every fetch in this route read live.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * /albums/[id]/print?t=<token>  —  THE CUSTOMER PREVIEW BOOK. Unchanged.
 *
 * NOT publicly accessible. Reached only by the worker's headless Chromium with a short-lived,
 * single-use token. The token is validated (service role, kind-scoped to 'preview') and marked
 * used, then the album is rendered via service access — the token IS the authorization here. Any
 * invalid/expired/used token → 404, leaking nothing.
 *
 * The token gate and the album read now live in `@/lib/pdf/print-token` and `@/lib/pdf/print-data`
 * so all three print routes share one implementation. The behaviour of THIS route is unchanged:
 * same gate (with the kind filter matching its own row), same data, same renderer, same page
 * sequence, same R2 key. The printer-ready exports are separate routes — see ./cover and ./content.
 */
export default async function PrintPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { t?: string };
}) {
  const gate = await validatePrintToken(params.id, searchParams.t, 'preview');
  if (!gate.ok) notFound();

  const data = await loadPrintAlbum(params.id, { content: true, cover: true });
  if (!data) notFound();

  const cover: PrintCover = {
    imageUrl: data.coverImageUrl,
    backImageUrl: data.backCoverImageUrl,
    config: data.coverConfig,
    title: data.album.title,
    size: data.album.size,
  };

  console.log('[print] rendering album', {
    albumId: params.id,
    blocks: data.blocks.length,
    readyPhotos: data.photos.length,
    hasCover: !!cover,
  });

  // Wrap in the full builder font library so every selectable typeface resolves in the PDF
  // (this route is outside the (app) group; the root layout only carries the brand fonts).
  return (
    <div className={builderFontVars}>
      <PrintAlbum
        blocks={[...data.blocks]}
        photos={[...data.photos]}
        cover={cover}
        dimensions={data.dimensions}
        stickerUrls={data.stickerUrls}
      />
    </div>
  );
}
