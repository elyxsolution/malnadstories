'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PairContent from '@/app/(app)/albums/[id]/build/_pair-frame';
import { CoverDesignFromConfig, BackCoverDesign, SpineDesign } from '@/app/(app)/albums/[id]/build/_cover-render';
import type { Block, EditConfig } from '@/lib/builder/model';
import { spineWidthFor, type CoverConfig } from '@/lib/builder/cover';
import { cmToIn, pageAspect, printPageCss, type ProductDimensions } from '@/lib/products/model';

export type PrintPhoto = { id: string; url: string; edit: EditConfig | null };
/**
 * The custom cover design. Front is physical page 1, back is the final content-side page, and the
 * SPINE is a page of its own at the end — see the note on `PrintAlbum`.
 *
 * `size` is the album's leaf count; the spine's printed width is derived from it by the same
 * `spineWidthFor` the builder and the preview use, so all three agree on how thick the book is.
 */
export type PrintCover =
  | { imageUrl: string | null; backImageUrl: string | null; config: CoverConfig; title: string; size: number }
  | null;

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
 *
 * ── PAGE-BOUNDARY EXACTNESS (why the page is sized in px, not cm) ──────────────────────────
 *
 * Symptoms this addresses: a hairline white band along the bottom edge of an exported page, and
 * — on some pages — a thin sliver of the NEXT page appearing in that same band.
 *
 * Both come from ONE geometric fact, measured against real headless Chromium rather than
 * assumed. Chromium lays a printed page out in a fragmentainer whose size is the CEILING of the
 * `@page` size in CSS px, while a page element sized in the same cm units is the exact fraction:
 *
 *      @page height   29.7cm  =  1122.5197 px   ← what a cm-sized element measures
 *      fragmentainer                 1123    px   ← ceil(); the sheet Chromium actually paints
 *
 * So the page element stopped 0.48px short of the sheet on every page, and 0.30px short on the
 * right edge (21cm = 793.7008px, fragmentainer 794px). That shortfall IS the white line — the
 * strip of sheet no element ever covered. Note it is size-dependent: the legacy 6in × 8in album
 * lands on 576 × 768 px exactly and never showed the fault, which is why this only appeared once
 * products introduced centimetre sizes.
 *
 * The same shortfall explains the sliver. Where the page's forced break was in effect, the gap
 * showed the sheet (white line). Where it was NOT — see (2) — the following page element began
 * 0.48px before the sheet ended, so its first half-pixel painted at the bottom of the current
 * sheet: a thin band of the next page.
 *
 * (1) FIX — size the page element at `ceil(cm → px)`, the fragmentainer's own value, so it
 *     covers the sheet exactly. `@page size` stays in cm, so the PDF's physical page size is
 *     unchanged and still exact; the sub-pixel of overscan falls outside the media box and is
 *     clipped. Nothing is hidden: the gap is filled by the page rather than painted over.
 *
 * (2) FIX — a forced break that had silently switched itself off. Pages carried
 *     `break-after: page` with `.pdf-page:last-child { break-after: auto }` to avoid a trailing
 *     blank sheet. But each content pair wrapped its two pages in a `display: contents` element,
 *     and `:last-child` is structural — it does not see through `display: contents`. The
 *     RIGHT-hand page of every pair was therefore the last child of its wrapper and lost its
 *     break, which is why the sliver appeared on alternating pages rather than all of them. The
 *     wrappers are now real fragments, and the rule is inverted to `break-before` on every page
 *     after the first: it cannot produce a trailing blank, and it does not depend on where a
 *     page sits among its siblings.
 *
 * `print-color-adjust: exact` states in CSS what Puppeteer already asks for with
 * `printBackground` — backgrounds and photos print at full density.
 */

/** CSS px for a physical length, rounded UP to match Chromium's print fragmentainer exactly. */
const pageAxisPx = (cm: number): number => Math.ceil(cmToIn(cm) * 96);

function buildPrintCss(dimensions: ProductDimensions, spineCm: number | null): string {
  const page = printPageCss(dimensions); // e.g. { w: '21cm', h: '29.7cm' } — the PHYSICAL size
  const w = pageAxisPx(dimensions.printWidthCm);
  const h = pageAxisPx(dimensions.printHeightCm);
  /**
   * THE SPINE'S OWN PAGE SIZE.
   *
   * The spine is a printed surface of the cover, a few percent of a page wide and the full page
   * tall — so it cannot share the uniform portrait `@page`. A NAMED page is the standard CSS
   * answer and the worker already prints with `preferCSSPageSize`, which is what makes a
   * per-page size take effect. It is emitted only when there is a spine to print, so an album
   * without one produces byte-identical CSS to before.
   *
   * Degradation is benign by design: if a renderer ignored the named size, the spine page would
   * print at the default portrait size with the spine strip drawn inside it — narrower than
   * intended, never broken, and never affecting any other page.
   */
  const spine =
    spineCm === null
      ? ''
      : `
  @page spine { size: ${spineCm.toFixed(3)}cm ${page.h}; margin: 0; }
  .pdf-page-spine { page: spine; width: ${pageAxisPx(spineCm)}px; }
`;
  return `
  @page { size: ${page.w} ${page.h}; margin: 0; }
  html, body {
    margin: 0; padding: 0; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pdf-page {
    position: relative;
    /* The fragmentainer's own dimensions — an exact fit, so no strip of sheet is left bare. */
    width: ${w}px; height: ${h}px;
    overflow: hidden; background: #fff;
  }
  .pdf-page + .pdf-page { break-before: page; page-break-before: always; }
  /* The open pair is 2 pages wide (200%); each physical page is a clip window onto it. The
     integer page width keeps the fold at a whole pixel (and a whole device pixel at the
     worker's deviceScaleFactor: 2), so the two halves meet with no sub-pixel seam. */
  .pair-clip { position: absolute; top: 0; height: 100%; width: 200%; }
  .cover-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
${spine}`;
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

  /**
   * The spine's printed width, in cm. `spineWidthFor` returns a fraction of ONE page width and is
   * the same function the builder canvas and the cover preview use — a thicker book reads thicker
   * everywhere, from one definition. Null when there is no cover to print a spine for.
   */
  const spineCm = cover ? spineWidthFor(cover.size) * dimensions.printWidthCm : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: buildPrintCss(dimensions, spineCm) }} />

      {/* Page 1 — Cover (the customer's custom design: image/background + title/tagline) */}
      <div className="pdf-page">
        {cover ? (
          <CoverDesignFromConfig
            config={cover.config}
            title={cover.title}
            imageUrl={cover.imageUrl}
            /* Migration geometry is aspect-dependent, so the PDF must migrate against the SAME
               page proportions the builder did — otherwise a legacy cover that has not been
               re-saved would print its title stack a hair off where the canvas showed it. */
            pageAspect={pageAspect(dimensions)}
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

      {/*
        Content — each pair → two physical pages (left half, right half).

        A React Fragment, NOT a `display: contents` element: every `.pdf-page` must be a true
        sibling of every other one, or the CSS fragmentation rules that key off sibling position
        (`.pdf-page + .pdf-page`) silently skip pages. See the note on `buildPrintCss`.
      */}
      {blocks.map((block) => (
        <Fragment key={block.key}>
          <PhysicalPage side="left" block={block} photoFor={photoFor} stickerUrlFor={stickerUrlFor} onFrameReady={onFrameReady} />
          <PhysicalPage side="right" block={block} photoFor={photoFor} stickerUrlFor={stickerUrlFor} onFrameReady={onFrameReady} />
        </Fragment>
      ))}

      {/* Back matter — blank inside-back cover (left, right) then the Back cover. */}
      {cover && (
        <>
          <div className="pdf-page" />
          <div className="pdf-page" />
          <div className="pdf-page">
            <BackCoverDesign back={cover.config.back} imageUrl={cover.backImageUrl} stickerUrlFor={stickerUrlFor} onReady={onFrameReady} />
          </div>

          {/*
            THE SPINE — the third printed surface of the cover, and until now the only authorable
            one that appeared nowhere in the PDF. A customer could put the album's name on the
            bound edge, see it in the builder and in the preview, and never find it in the file.

            It goes LAST, after the back cover, for one reason: appending cannot shift anything.
            Every content page keeps the position it has always had, so nothing downstream — the
            worker's readiness count, the page arithmetic, a print partner's expectations — has to
            learn a new sequence. It carries no image loads (text only), so it adds nothing to the
            readiness gate either.
          */}
          <div className="pdf-page pdf-page-spine">
            <SpineDesign config={cover.config} title={cover.title} pageAspect={pageAspect(dimensions)} />
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
