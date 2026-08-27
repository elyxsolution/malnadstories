import { notFound } from 'next/navigation';
import { loadPrintAlbum } from '@/lib/pdf/print-data';
import { validatePrintToken } from '@/lib/pdf/print-token';
import { builderFontVars } from '@/lib/fonts';
import PrintCover from './_print-cover';

// Same caching posture as the preview print route: token-gated, live album data, no Data Cache.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * /albums/[id]/print/cover?t=<token>  —  THE PRINTER-READY FLAT COVER SPREAD.
 *
 * One page at 483 × 327 mm: back · hinge · spine · hinge · front, inside a blank 15 mm wrap.
 * Token-gated exactly like the preview route but scoped to the `print_cover` kind, so a preview or
 * content token cannot render it. Any invalid/expired/superseded token → 404, leaking nothing.
 *
 * Content pages and photos are NOT loaded: the cover's own image resolves through the canonical
 * `resolveCoverImageKeys` chain (uploaded photo → cover template → design/default), so skipping
 * the album's photo set costs nothing and avoids presigning up to 128 URLs per render.
 */
export default async function PrintCoverPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { t?: string };
}) {
  const gate = await validatePrintToken(params.id, searchParams.t, 'print_cover');
  if (!gate.ok) notFound();

  const data = await loadPrintAlbum(params.id, { content: false, cover: true });
  if (!data) notFound();

  console.log('[print] rendering print cover', {
    albumId: params.id,
    hasFrontImage: !!data.coverImageUrl,
    hasBackImage: !!data.backCoverImageUrl,
  });

  // Wrap in the full builder font library so every selectable typeface resolves in the PDF
  // (this route is outside the (app) group; the root layout only carries the brand fonts).
  return (
    <div className={builderFontVars}>
      <PrintCover
        config={data.coverConfig}
        title={data.album.title}
        frontImageUrl={data.coverImageUrl}
        backImageUrl={data.backCoverImageUrl}
        stickerUrls={data.stickerUrls}
      />
    </div>
  );
}
