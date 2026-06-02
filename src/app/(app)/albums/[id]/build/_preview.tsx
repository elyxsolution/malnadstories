'use client';

import PhotoFrame from './_photo-frame';
import type { Photo } from './_uploader';
import { physicalStart, type Block } from '@/lib/builder/model';

/**
 * In-app full-album preview: every block rendered in order as a physical page (or a
 * two-leaf spread), with the base photo, any overlays, applied edits, and captions.
 * A clean paged preview — no PDF (that's the worker slice). Empty slots show as
 * placeholders. Uses the same PhotoFrame as the editor + slots, so it's WYSIWYG.
 */
export default function Preview({ blocks, photoMap }: { blocks: Block[]; photoMap: Map<string, Photo> }) {
  if (blocks.length === 0) {
    return <p className="text-sm text-muted-foreground">Add some layout blocks to see a preview.</p>;
  }

  return (
    <div className="space-y-8">
      {blocks.map((block, i) => {
        const start = physicalStart(blocks, i);
        const wide = block.template === 'spread-full';
        const base = block.photoIds[0] ? photoMap.get(block.photoIds[0]) : undefined;
        const label = wide ? `Pages ${start}–${start + 1}` : `Page ${start}`;

        return (
          <figure key={block.key} className="mx-auto w-full max-w-2xl">
            <div
              className={`relative mx-auto w-full overflow-hidden rounded-lg border bg-muted shadow-sm ${
                wide ? 'aspect-[2/1]' : 'aspect-[3/4] max-w-md'
              }`}
            >
              <SlotView photo={base} />
              {block.overlays.map((o, idx) => (
                <div
                  key={idx}
                  className="absolute overflow-hidden rounded border-2 border-white shadow-md"
                  style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%` }}
                >
                  <SlotView photo={photoMap.get(o.photoId)} />
                </div>
              ))}
            </div>
            <figcaption className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{label}</span>
              {block.caption && <span className="truncate italic">{block.caption}</span>}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function SlotView({ photo }: { photo?: Photo }) {
  if (!photo) {
    return <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Empty</div>;
  }
  return <PhotoFrame url={photo.url} edit={photo.edit} alt={photo.filename} />;
}
