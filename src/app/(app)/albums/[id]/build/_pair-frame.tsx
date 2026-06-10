'use client';

import PhotoFrame from './_photo-frame';
import type { Block, EditConfig, Overlay } from '@/lib/builder/model';

/**
 * Shared, read-only renderer for ONE content pair (two physical pages) in the OPEN-BOOK
 * coordinate space — both pages laid out side by side as a single 2-wide box.
 *
 * THE single source of pair geometry, reused by:
 *   - the in-app preview (`half="full"`, rendered once full-width with a centre gutter), and
 *   - the print route (`half="left"|"right"`, rendered once per physical page, clipped),
 * so the builder preview and the generated PDF are pixel-identical by construction.
 *
 * Memory (Phase F.1): in PDF mode we render ONLY the frames that belong to the given
 * physical page — `single-pair` renders just that side's photo (so a photo is decoded
 * once, not twice), and overlays render only on the page(s) they overlap. A
 * `double-spread` image inherently spans both pages, so it renders on each.
 *
 * Gutter/seam: the split is at exactly x=0.5 of the 2-wide box, which at the worker's
 * deviceScaleFactor:2 falls on an integer device-pixel boundary (6in·96·2 = 1152 px),
 * so the two halves meet with no sub-pixel gap — pixel-perfect, no stretch, no bleed.
 */

export type PairPhoto = { url: string; edit?: EditConfig | null };
export type PairHalf = 'full' | 'left' | 'right';

const overlapsHalf = (o: Overlay, half: PairHalf) =>
  half === 'full' || (half === 'left' ? o.x < 0.5 : o.x + o.w > 0.5);

export default function PairContent({
  block,
  photoFor,
  onFrameReady,
  half = 'full',
}: {
  block: Block;
  photoFor: (id: string | undefined) => PairPhoto | undefined;
  onFrameReady?: () => void;
  half?: PairHalf;
}) {
  const isDouble = block.template === 'double-spread';
  const left = photoFor(block.photoIds[0]);
  const right = photoFor(block.photoIds[1]);
  const showLeft = half === 'full' || half === 'left';
  const showRight = half === 'full' || half === 'right';

  return (
    <div className="absolute inset-0">
      {isDouble ? (
        // One image across the whole open pair; per-page clipping performs the split.
        left ? (
          <PhotoFrame url={left.url} edit={left.edit} onReady={onFrameReady} />
        ) : (
          <EmptyHalf full label="Double-page image" />
        )
      ) : (
        <>
          {showLeft && (
            <div className="absolute left-0 top-0 h-full w-1/2 overflow-hidden">
              {left ? <PhotoFrame url={left.url} edit={left.edit} onReady={onFrameReady} /> : <EmptyHalf label="Left page" />}
            </div>
          )}
          {showRight && (
            <div className="absolute left-1/2 top-0 h-full w-1/2 overflow-hidden">
              {right ? <PhotoFrame url={right.url} edit={right.edit} onReady={onFrameReady} /> : <EmptyHalf label="Right page" />}
            </div>
          )}
        </>
      )}

      {block.overlays.map((o, i) => {
        if (!overlapsHalf(o, half)) return null;
        const photo = photoFor(o.photoId);
        if (!photo) return null;
        return (
          <div
            key={i}
            className="absolute overflow-hidden border-2 border-white shadow"
            style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%` }}
          >
            <PhotoFrame url={photo.url} edit={photo.edit} onReady={onFrameReady} />
          </div>
        );
      })}
    </div>
  );
}

function EmptyHalf({ label, full }: { label: string; full?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center bg-muted text-xs text-muted-foreground ${
        full ? 'absolute inset-0' : 'h-full w-full'
      }`}
    >
      {label}
    </div>
  );
}
