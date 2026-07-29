'use client';

import PairContent from './_pair-frame';
import type { Photo } from '@/lib/builder/photo';
import type { PhotoUiState } from './_photo-state';
import { usePhotoFor } from './_use-photo-for';
import { physicalStart, type Block } from '@/lib/builder/model';
import { useBuilderDimensions } from './_dimensions';

/**
 * In-app full-album preview that mirrors the PHYSICAL printed book exactly:
 *   Cover (page 1) → Blank (page 2) → Blank (page 3) → content pairs (page 4…).
 * The cover + blanks are injected here (never stored); content pairs render through the
 * SAME PairContent used by the PDF print route, so preview == PDF. A double-page spread
 * shows one image spanning both pages with a centre gutter; a single page shows two
 * independent photos. WYSIWYG via the shared PhotoFrame.
 */
export default function Preview({
  blocks,
  photoMap,
  cover,
  stickerUrlFor,
  photoStateFor,
}: {
  blocks: Block[];
  photoMap: Map<string, Photo>;
  cover: { url: string; name: string } | null;
  stickerUrlFor?: (stickerId: string) => string | undefined;
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
          className="relative mx-auto w-full overflow-hidden rounded-lg border bg-muted shadow-sm"
          style={{ aspectRatio: page }}
        >
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover.url} alt={cover.name} className="absolute inset-0 h-full w-full object-cover" />
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
            <div className="relative w-full rounded-lg border border-dashed bg-white shadow-sm" style={{ aspectRatio: page }} />
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
                className="relative mx-auto w-full overflow-hidden rounded-lg border bg-muted shadow-sm"
                style={{ aspectRatio: pair }}
              >
                <PairContent block={block} photoFor={photoFor} stickerUrlFor={stickerUrlFor} badge="compact" />
                <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/70 mix-blend-difference" />
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
    </div>
  );
}
