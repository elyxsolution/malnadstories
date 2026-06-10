'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PairContent from '@/app/(app)/albums/[id]/build/_pair-frame';
import type { Block, EditConfig } from '@/lib/builder/model';

export type PrintPhoto = { id: string; url: string; edit: EditConfig | null };
export type PrintCover = { url: string } | null;

/**
 * Print-only album renderer — the PHYSICAL photobook, one PDF page per physical page:
 *
 *   Page 1 = Cover (selected template, full-bleed; no user content)
 *   Page 2 = Blank (inside front cover, left)
 *   Page 3 = Blank (inside front cover, right)
 *   Page 4… = content. Each content PAIR emits TWO portrait pages:
 *             • single-pair   → left photo page, right photo page
 *             • double-spread → ONE image split exactly at centre (left half | right half)
 *
 * The split is achieved by rendering the SAME open-pair (PairContent, 2 pages wide)
 * into a clip window per physical page — identical geometry to the builder preview, so
 * PDF == preview. Every page is the same portrait size; there are NO landscape pages.
 */

// Uniform portrait page. Two of these side by side form one open pair (the 2-wide
// coordinate space PairContent draws into). Parameterized for the print partner later.
const PAGE = { w: '6in', h: '8in', margin: '0' };

const PRINT_CSS = `
  @page { size: ${PAGE.w} ${PAGE.h}; margin: ${PAGE.margin}; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .pdf-page {
    position: relative; width: ${PAGE.w}; height: ${PAGE.h};
    overflow: hidden; background: #fff;
    break-after: page; page-break-after: always;
  }
  .pdf-page:last-child { break-after: auto; page-break-after: auto; }
  /* The open pair is 2 pages wide (200%); each physical page is a clip window onto it. */
  .pair-clip { position: absolute; top: 0; height: 100%; width: 200%; }
  .cover-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
`;

declare global {
  interface Window {
    __ALBUM_PRINT_READY?: boolean;
  }
}

export default function PrintAlbum({
  blocks,
  photos,
  cover,
}: {
  blocks: Block[];
  photos: PrintPhoto[];
  cover: PrintCover;
}) {
  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const photoFor = useCallback(
    (id: string | undefined) => {
      const p = id ? photoMap.get(id) : undefined;
      return p ? { url: p.url, edit: p.edit } : undefined;
    },
    [photoMap],
  );

  // Frames the worker must wait for — counted to MATCH what each physical page renders
  // (memory opt: single-pair photos render once on their own page, not twice; overlays
  // only on the page(s) they overlap; a double-spread image renders on both pages).
  const totalFrames = useMemo(() => {
    const framesOnHalf = (b: Block, half: 'left' | 'right') => {
      let n = 0;
      if (b.template === 'double-spread') {
        if (b.photoIds[0] && photoMap.has(b.photoIds[0])) n += 1; // image spans both pages
      } else {
        const id = half === 'left' ? b.photoIds[0] : b.photoIds[1];
        if (id && photoMap.has(id)) n += 1;
      }
      for (const o of b.overlays) {
        const onHalf = half === 'left' ? o.x < 0.5 : o.x + o.w > 0.5;
        if (onHalf && photoMap.has(o.photoId)) n += 1;
      }
      return n;
    };
    return (
      (cover ? 1 : 0) +
      blocks.reduce((s, b) => s + framesOnHalf(b, 'left') + framesOnHalf(b, 'right'), 0)
    );
  }, [blocks, photoMap, cover]);

  const [, setLoaded] = useState(0);
  const loadedRef = useRef(0);

  const markReady = useCallback(() => {
    window.__ALBUM_PRINT_READY = true;
  }, []);

  useEffect(() => {
    if (totalFrames === 0) markReady();
  }, [totalFrames, markReady]);

  // Safety net so a stuck <img> can't hang the worker the full 60s.
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

      {/* Page 1 — Cover */}
      <div className="pdf-page">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.url} alt="" className="cover-img" onLoad={onFrameReady} onError={onFrameReady} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">Cover</div>
        )}
      </div>

      {/* Pages 2 & 3 — Blank inside front cover (left, right) */}
      <div className="pdf-page" />
      <div className="pdf-page" />

      {/* Content — each pair → two physical pages (left half, right half). */}
      {blocks.map((block) => (
        <div key={block.key} style={{ display: 'contents' }}>
          <PhysicalPage side="left" block={block} photoFor={photoFor} onFrameReady={onFrameReady} />
          <PhysicalPage side="right" block={block} photoFor={photoFor} onFrameReady={onFrameReady} />
        </div>
      ))}
    </>
  );
}

function PhysicalPage({
  side,
  block,
  photoFor,
  onFrameReady,
}: {
  side: 'left' | 'right';
  block: Block;
  photoFor: (id: string | undefined) => { url: string; edit?: EditConfig | null } | undefined;
  onFrameReady: () => void;
}) {
  // Left page shows x∈[0,6in] of the 12in open pair; right page shifts it by one page.
  // `half` makes PairContent render ONLY this page's frames (memory opt).
  return (
    <div className="pdf-page">
      <div className="pair-clip" style={{ left: side === 'left' ? '0' : '-100%' }}>
        <PairContent block={block} photoFor={photoFor} onFrameReady={onFrameReady} half={side} />
      </div>
    </div>
  );
}
