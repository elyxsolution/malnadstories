'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PhotoFrame from '@/app/(app)/albums/[id]/build/_photo-frame';
import type { Block, EditConfig } from '@/lib/builder/model';

export type PrintPhoto = { id: string; url: string; edit: EditConfig | null };

/**
 * Print-only album renderer. One .pdf-page per album page (a spread is one wide
 * page) using the SAME PhotoFrame as the builder/preview, so the PDF matches the
 * screen exactly. Page sizes are parameterized for the print partner's later
 * bleed/DPI; for now they mirror the on-screen preview aspects (3:4 / 2:1).
 *
 * Readiness: Puppeteer waits on `window.__ALBUM_PRINT_READY`. We count exactly the
 * frames that actually render an image (base + overlays with a known photo); a
 * load OR error counts (a broken/expired URL can't hang the PDF); a zero-image
 * album is ready immediately.
 */

// Parameterize here — later set to the print partner's exact page box + bleed.
const PRINT = {
  single: { w: '6in', h: '8in' }, // 3:4
  spread: { w: '16in', h: '8in' }, // 2:1
  margin: '0',
};

const PRINT_CSS = `
  @page single { size: ${PRINT.single.w} ${PRINT.single.h}; margin: ${PRINT.margin}; }
  @page spread { size: ${PRINT.spread.w} ${PRINT.spread.h}; margin: ${PRINT.margin}; }
  @page { margin: ${PRINT.margin}; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .pdf-page { position: relative; overflow: hidden; background: #fff; break-after: page; page-break-after: always; }
  .pdf-page:last-child { break-after: auto; page-break-after: auto; }
  .pdf-page.single { page: single; width: ${PRINT.single.w}; height: ${PRINT.single.h}; }
  .pdf-page.spread { page: spread; width: ${PRINT.spread.w}; height: ${PRINT.spread.h}; }
`;

declare global {
  interface Window {
    __ALBUM_PRINT_READY?: boolean;
  }
}

export default function PrintAlbum({ blocks, photos }: { blocks: Block[]; photos: PrintPhoto[] }) {
  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);

  // Exact count of frames that will render an image (empty slots/missing overlays excluded).
  const totalFrames = useMemo(() => {
    let n = 0;
    for (const b of blocks) {
      if (b.photoIds[0] && photoMap.has(b.photoIds[0])) n += 1;
      for (const o of b.overlays) if (photoMap.has(o.photoId)) n += 1;
    }
    return n;
  }, [blocks, photoMap]);

  const [, setLoaded] = useState(0);
  const loadedRef = useRef(0);

  const markReady = useCallback(() => {
    // Signal that all frames have mounted and their images settled (load/error). The
    // worker still awaits real image decode before snapshotting, so this need not (and
    // must not) depend on requestAnimationFrame, which is unreliable in headless.
    window.__ALBUM_PRINT_READY = true;
  }, []);

  // Zero-image album: ready immediately.
  useEffect(() => {
    if (totalFrames === 0) markReady();
  }, [totalFrames, markReady]);

  // Safety net: never let the worker hang the full 60s. If, for any edge case, the
  // per-frame onReady count doesn't reach totalFrames (e.g. an <img> that fires
  // neither load nor error), flip the flag after a bounded delay anyway. The worker
  // still awaits real image decode before the snapshot, so this can't blank the PDF.
  useEffect(() => {
    const t = setTimeout(markReady, 12_000);
    return () => clearTimeout(t);
  }, [markReady]);

  const onFrameReady = useCallback(() => {
    loadedRef.current += 1;
    setLoaded(loadedRef.current);
    if (loadedRef.current >= totalFrames) markReady();
  }, [totalFrames, markReady]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      {blocks.map((block) => {
        const wide = block.template === 'spread-full';
        const base = block.photoIds[0] ? photoMap.get(block.photoIds[0]) : undefined;
        return (
          <div key={block.key} className={`pdf-page ${wide ? 'spread' : 'single'}`}>
            {base ? (
              <PhotoFrame url={base.url} edit={base.edit} onReady={onFrameReady} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">Empty</div>
            )}
            {block.overlays.map((o, i) => {
              const photo = photoMap.get(o.photoId);
              if (!photo) return null;
              return (
                <div
                  key={i}
                  className="absolute overflow-hidden"
                  style={{
                    left: `${o.x * 100}%`,
                    top: `${o.y * 100}%`,
                    width: `${o.w * 100}%`,
                    height: `${o.h * 100}%`,
                    border: '2px solid #fff',
                  }}
                >
                  <PhotoFrame url={photo.url} edit={photo.edit} onReady={onFrameReady} />
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
