'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PairContent from '@/app/(app)/albums/[id]/build/_pair-frame';
import { CoverDesignFromConfig, BackCoverDesign } from '@/app/(app)/albums/[id]/build/_cover-render';
import type { Block, EditConfig } from '@/lib/builder/model';
import type { CoverConfig } from '@/lib/builder/cover';
import { printPageCss, type ProductDimensions } from '@/lib/products/model';

export type PrintPhoto = { id: string; url: string; edit: EditConfig | null };
/** The custom cover design: front rendered on page 1, back on the final physical page. */
export type PrintCover = { imageUrl: string | null; backImageUrl: string | null; config: CoverConfig; title: string } | null;

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

/**
 * Uniform portrait page. Two side by side form one open pair (the 2-wide coordinate space
 * PairContent draws into). Dimensions come from the selected Album Product (0047) — NOT a
 * hardcoded constant — so every product prints at its own physical size (CSS supports `cm`).
 * The layout math below is percentage-based (200%-wide pair, ±100% clip), so it scales to
 * any page size without change.
 */
function buildPrintCss(dimensions: ProductDimensions): string {
  const page = printPageCss(dimensions); // e.g. { w: '21cm', h: '29.7cm' }
  return `
  @page { size: ${page.w} ${page.h}; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .pdf-page {
    position: relative; width: ${page.w}; height: ${page.h};
    overflow: hidden; background: #fff;
    break-after: page; page-break-after: always;
  }
  .pdf-page:last-child { break-after: auto; page-break-after: auto; }
  /* The open pair is 2 pages wide (200%); each physical page is a clip window onto it. */
  .pair-clip { position: absolute; top: 0; height: 100%; width: 200%; }
  .cover-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
`;
}

declare global {
  interface Window {
    __ALBUM_PRINT_READY?: boolean;
  }
}

export default function PrintAlbum({
  blocks,
  photos,
  cover,
  dimensions,
  stickerUrls = {},
}: {
  blocks: Block[];
  photos: PrintPhoto[];
  cover: PrintCover;
  /** Physical page dimensions of the album's product (0047). Drives the @page + page CSS. */
  dimensions: ProductDimensions;
  stickerUrls?: Record<string, string>;
}) {
  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const photoFor = useCallback(
    (id: string | null | undefined) => {
      const p = id ? photoMap.get(id) : undefined;
      return p ? { url: p.url, edit: p.edit } : undefined;
    },
    [photoMap],
  );
  const stickerUrlFor = useCallback((id: string) => stickerUrls[id], [stickerUrls]);

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
        // Empty placeholder overlays (photoId=null) render nothing in print → not counted.
        if (onHalf && o.photoId && photoMap.has(o.photoId)) n += 1;
      }
      return n;
    };
    // Stickers render on BOTH physical pages (not half-filtered, like text/QR — the clip window
    // shows the right portion), so each placed sticker with a resolved URL = 2 frames. The cover
    // renders its stickers once. The back cover is the final page (its own base + stickers).
    const coverStickers = cover ? cover.config.stickers.filter((s) => stickerUrls[s.stickerId]).length : 0;
    const backStickers = cover ? cover.config.back.stickers.filter((s) => stickerUrls[s.stickerId]).length : 0;
    return (
      (cover ? 2 : 0) + // front cover base + back cover base
      coverStickers +
      backStickers +
      blocks.reduce(
        (s, b) =>
          s + framesOnHalf(b, 'left') + framesOnHalf(b, 'right') + b.stickers.filter((st) => stickerUrls[st.stickerId]).length * 2,
        0,
      )
    );
  }, [blocks, photoMap, cover, stickerUrls]);

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
      <style dangerouslySetInnerHTML={{ __html: buildPrintCss(dimensions) }} />

      {/* Page 1 — Cover (the customer's custom design: image/background + title/tagline) */}
      <div className="pdf-page">
        {cover ? (
          <CoverDesignFromConfig
            config={cover.config}
            title={cover.title}
            imageUrl={cover.imageUrl}
            stickerUrlFor={stickerUrlFor}
            onReady={onFrameReady}
          />
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
          <PhysicalPage side="left" block={block} photoFor={photoFor} stickerUrlFor={stickerUrlFor} onFrameReady={onFrameReady} />
          <PhysicalPage side="right" block={block} photoFor={photoFor} stickerUrlFor={stickerUrlFor} onFrameReady={onFrameReady} />
        </div>
      ))}

      {/* Back matter — blank inside-back cover (left, right) then the Back cover (final page). */}
      {cover && (
        <>
          <div className="pdf-page" />
          <div className="pdf-page" />
          <div className="pdf-page">
            <BackCoverDesign back={cover.config.back} imageUrl={cover.backImageUrl} stickerUrlFor={stickerUrlFor} onReady={onFrameReady} />
          </div>
        </>
      )}
    </>
  );
}

function PhysicalPage({
  side,
  block,
  photoFor,
  stickerUrlFor,
  onFrameReady,
}: {
  side: 'left' | 'right';
  block: Block;
  photoFor: (id: string | null | undefined) => { url: string; edit?: EditConfig | null } | undefined;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  onFrameReady: () => void;
}) {
  // Left page shows x∈[0,6in] of the 12in open pair; right page shifts it by one page.
  // `half` makes PairContent render ONLY this page's frames (memory opt).
  return (
    <div className="pdf-page">
      <div className="pair-clip" style={{ left: side === 'left' ? '0' : '-100%' }}>
        <PairContent block={block} photoFor={photoFor} stickerUrlFor={stickerUrlFor} onFrameReady={onFrameReady} half={side} />
      </div>
    </div>
  );
}
