'use client';

import PairContent, { PrintGutter } from './_pair-frame';
import { CoverDesignFromConfig, BackCoverDesign, SpineDesign } from './_cover-render';
import type { Photo } from '@/lib/builder/photo';
import type { PhotoUiState } from './_photo-state';
import { usePhotoFor } from './_use-photo-for';
import { physicalStart, type Block } from '@/lib/builder/model';
import { spineWidthFor, type CoverConfig } from '@/lib/builder/cover';
import { useBuilderDimensions } from './_dimensions';

/**
 * In-app full-album preview that mirrors the PHYSICAL printed book exactly:
 *   Cover (page 1) → Blank (page 2) → Blank (page 3) → content pairs → Back cover → Spine.
 * The blanks are injected here (never stored); every printed surface renders through the SAME
 * components the PDF print route uses, so preview == PDF. A double-page spread shows one image
 * spanning both pages with a centre gutter; a single page shows two independent photos.
 *
 * ── WHY THE COVER PROP IS THE WHOLE DESIGN ────────────────────────────────────────────────
 *
 * This surface used to draw the cover as a bare `<img>` of the admin template artwork, which
 * meant the three places it is used — the post-purchase view, the layout proposal and the admin
 * album preview — all showed a plain PNG where the customer's designed cover (their title,
 * subtitle, photo, stickers, background) would actually print. It was the last renderer that had
 * not moved onto the cover object model, and the only one where a customer could see a cover that
 * was not theirs. It now takes the same `CoverConfig` every other surface takes and draws it with
 * the same renderers.
 */
export type PreviewCover = {
  config: CoverConfig;
  title: string;
  /** Album leaf count — sets how thick the spine proofs, via the shared `spineWidthFor`. */
  size: number;
  frontImageUrl: string | null;
  backImageUrl: string | null;
} | null;

export default function Preview({
  blocks,
  photoMap,
  cover,
  stickerUrlFor,
  photoStateFor,
  showGutter = true,
}: {
  blocks: Block[];
  photoMap: Map<string, Photo>;
  cover: PreviewCover;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  /** Draw the printed fold (Album Settings → Show print gutter). */
  showGutter?: boolean;
  /** Optional (builder only): drives the shared processing badge. Absent in admin previews. */
  photoStateFor?: (photoId: string) => PhotoUiState | undefined;
}) {
  const { page, pair } = useBuilderDimensions();
  const photoFor = usePhotoFor(photoMap, photoStateFor);

  return (
    <div className="space-y-8">
      {/* Front matter — fixed, not editable. */}
      <figure className="mx-auto w-full max-w-md">
        <div
          className="relative mx-auto w-full overflow-hidden border bg-muted shadow-sm"
          style={{ aspectRatio: page }}
        >
          {cover ? (
            <CoverDesignFromConfig
              config={cover.config}
              title={cover.title}
              imageUrl={cover.frontImageUrl}
              pageAspect={page}
              stickerUrlFor={stickerUrlFor}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              No cover selected
            </div>
          )}
        </div>
        <figcaption className="mt-2 text-xs text-muted-foreground">Page 1 · Cover</figcaption>
      </figure>

      <div className="mx-auto grid w-full max-w-2xl grid-cols-2 gap-4">
        {[2, 3].map((p) => (
          <figure key={p}>
            <div className="relative w-full border border-dashed bg-white shadow-sm" style={{ aspectRatio: page }} />
            <figcaption className="mt-2 text-xs text-muted-foreground">Page {p} · Blank</figcaption>
          </figure>
        ))}
      </div>

      {blocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add content pages to see them here.</p>
      ) : (
        blocks.map((block, i) => {
          const start = physicalStart(blocks, i);
          const isDouble = block.template === 'double-spread';
          return (
            <figure key={block.key} className="mx-auto w-full max-w-2xl">
              {/* Open pair: two pages side by side (pair aspect from the product), centre gutter. */}
              <div
                className="relative mx-auto w-full overflow-hidden border bg-muted shadow-sm"
                style={{ aspectRatio: pair }}
              >
                <PairContent block={block} photoFor={photoFor} stickerUrlFor={stickerUrlFor} badge="compact" />
                {showGutter && <PrintGutter />}
              </div>
              <figcaption className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Pages {start}–{start + 1} · {isDouble ? 'Double page (one image across both)' : 'Single page (two photos)'}
                </span>
                {block.caption && <span className="truncate italic">{block.caption}</span>}
              </figcaption>
            </figure>
          );
        })
      )}

      {/* Back matter — the same two surfaces the PDF ends with, in the same order, so the preview
          shows the whole manufactured object rather than stopping at the last content spread. */}
      {cover && (
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-start justify-center gap-6">
          <figure className="w-full max-w-md">
            <div className="relative w-full overflow-hidden border bg-muted shadow-sm" style={{ aspectRatio: page }}>
              <BackCoverDesign back={cover.config.back} imageUrl={cover.backImageUrl} stickerUrlFor={stickerUrlFor} />
            </div>
            <figcaption className="mt-2 text-xs text-muted-foreground">Back cover</figcaption>
          </figure>
          <figure className="w-24">
            <div
              className="relative w-full overflow-hidden border shadow-sm"
              style={{ aspectRatio: page * spineWidthFor(cover.size) }}
            >
              <SpineDesign config={cover.config} title={cover.title} pageAspect={page} />
            </div>
            <figcaption className="mt-2 text-xs text-muted-foreground">Spine</figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}
