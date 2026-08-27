import { notFound } from 'next/navigation';
import { loadPrintAlbum } from '@/lib/pdf/print-data';
import { validatePrintToken } from '@/lib/pdf/print-token';
import { builderFontVars } from '@/lib/fonts';
import { pagesConsumed, type Block } from '@/lib/builder/model';
import PrintContent from './_print-content';

// Same caching posture as the preview print route: token-gated, live album data, no Data Cache.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * /albums/[id]/print/content?t=<token>  —  THE PRINTER-READY INTERIOR.
 *
 * N pages at 206 × 291 mm, in reading order, and nothing else. Token-gated exactly like the
 * preview route, but scoped to the `print_content` kind: a preview token cannot render this file
 * and a cover token cannot either, because each artifact owns its own `album_pdfs` row and
 * therefore its own token. Any invalid/expired/superseded token → 404, leaking nothing.
 *
 * PAGE COUNT IS AN INVARIANT, NOT AN OUTCOME. The album's `size` IS its content page count (each
 * `album_pages` row is a two-page unit), so the file must contain exactly `size` pages. If the
 * saved layout does not account for exactly that many, this route REFUSES rather than emit a book
 * with the wrong number of leaves — a printer would bind whatever it is given. The primary gate is
 * upstream in `startAlbumPdfGeneration`, which fails with a readable admin message before a job is
 * ever enqueued; this is the backstop that cannot be bypassed by a stale token.
 */
export default async function PrintContentPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { t?: string };
}) {
  const gate = await validatePrintToken(params.id, searchParams.t, 'print_content');
  if (!gate.ok) notFound();

  // Cover artwork is not loaded: it is not part of the interior, and skipping it avoids two
  // pointless presigns per render.
  const data = await loadPrintAlbum(params.id, { content: true, cover: false });
  if (!data) notFound();

  const blocks = [...data.blocks] as Block[];
  const emitted = pagesConsumed(blocks);
  if (emitted !== data.album.size) {
    console.error('[print] content export refused: page count mismatch', {
      albumId: params.id,
      albumSize: data.album.size,
      blocks: blocks.length,
      wouldEmit: emitted,
    });
    notFound();
  }

  console.log('[print] rendering print content', {
    albumId: params.id,
    pages: emitted,
    blocks: blocks.length,
    readyPhotos: data.photos.length,
  });

  // Wrap in the full builder font library so every selectable typeface resolves in the PDF
  // (this route is outside the (app) group; the root layout only carries the brand fonts).
  return (
    <div className={builderFontVars}>
      <PrintContent
        blocks={blocks}
        photos={[...data.photos]}
        dimensions={data.dimensions}
        stickerUrls={data.stickerUrls}
      />
    </div>
  );
}
