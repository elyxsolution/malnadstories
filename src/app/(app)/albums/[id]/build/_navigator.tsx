'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Photo } from './_uploader';
import type { Block } from '@/lib/builder/model';

/**
 * Bottom thumbnail navigator (client-only). One mini-spread per block; click to focus,
 * drag to reorder (reuses the parent's block-array reorder — placed-once is preserved
 * because reordering never changes which photo sits in which slot). Prev/Next at the end.
 */
export default function Navigator({
  blocks,
  photoMap,
  current,
  onJump,
  onReorder,
  onPrev,
  onNext,
}: {
  blocks: Block[];
  photoMap: Map<string, Photo>;
  current: number;
  onJump: (i: number) => void;
  onReorder: (from: number, to: number) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  if (blocks.length === 0) return null;

  const thumb = (id: string | undefined) => (id ? photoMap.get(id)?.thumbUrl || '' : '');

  return (
    <div className="builder-glass relative z-10 mt-5 flex items-center gap-2 rounded-2xl p-2">
      <button
        type="button"
        onClick={onPrev}
        disabled={current <= 0}
        aria-label="Previous spread"
        className="grid h-9 w-9 flex-none place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="ms-scroll flex flex-1 items-center gap-2 overflow-x-auto px-1 py-0.5">
        {blocks.map((b, i) => {
          const isDouble = b.template === 'double-spread';
          const left = thumb(b.photoIds[0]);
          const right = thumb(b.photoIds[1]);
          return (
            <button
              key={b.key}
              type="button"
              draggable
              onDragStart={() => setDragFrom(i)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOver !== i) setDragOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null && dragFrom !== i) onReorder(dragFrom, i);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              onClick={() => onJump(i)}
              title={`Spread ${i + 1}`}
              className={`relative flex-none cursor-grab active:cursor-grabbing ${dragFrom === i ? 'opacity-40' : ''}`}
            >
              <div
                className={`relative flex h-[44px] w-[88px] overflow-hidden border-2 bg-white transition-colors ${
                  i === current ? 'border-[#ecd9ad]' : dragOver === i ? 'border-primary' : 'border-white/20'
                }`}
              >
                {isDouble ? (
                  <MiniFill url={left} />
                ) : (
                  <>
                    <div className="h-full w-1/2 border-r border-black/10">
                      <MiniFill url={left} />
                    </div>
                    <div className="h-full w-1/2">
                      <MiniFill url={right} />
                    </div>
                  </>
                )}
                {b.overlays.length > 0 && (
                  <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-black/55 px-1 text-[8px] font-semibold text-white">
                    +{b.overlays.length}
                  </span>
                )}
              </div>
              <span className="mt-1 block text-center font-mono text-[9px] text-white/55">{i + 1}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={current >= blocks.length - 1}
        aria-label="Next spread"
        className="grid h-9 w-9 flex-none place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function MiniFill({ url }: { url: string }) {
  if (!url) return <div className="h-full w-full bg-[repeating-linear-gradient(45deg,#f0e7d6,#f0e7d6_4px,#e8dcc7_4px,#e8dcc7_8px)]" />;
  return (
    <div
      className="h-full w-full bg-cover bg-center"
      style={{ backgroundImage: `url("${url}")` }}
    />
  );
}
