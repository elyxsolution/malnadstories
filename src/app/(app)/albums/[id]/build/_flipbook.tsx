'use client';

import { forwardRef, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — react-pageflip ships its own types via the default export
import HTMLFlipBook from 'react-pageflip';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Minimize2, Pencil } from 'lucide-react';
import PairContent, { PrintGutter, type PairPhoto } from './_pair-frame';
import { CoverDesignFromConfig, BackCoverDesign } from './_cover-render';
import { useBuilderDimensions } from './_dimensions';
import type { Photo } from '@/lib/builder/photo';
import type { PhotoUiState } from './_photo-state';
import { usePhotoFor } from './_use-photo-for';
import type { Block } from '@/lib/builder/model';
import type { CoverConfig } from '@/lib/builder/cover';

/** The flipbook cover = the live custom design: resolved front + back image + config + title. */
type FlipCover = {
  imageUrl: string | null;
  backImageUrl: string | null;
  config: CoverConfig;
  title: string;
  name: string;
  size: number;
} | null;

/**
 * Premium photobook preview — opens fullscreen on a soft-lit studio stage and lets the
 * customer leaf through the book like a printed luxury album: the FRONT COVER first, then
 * the inside pages as continuous open spreads (left page + right page), each rendered through
 * the SAME `PairContent` as the PDF (so preview == print). Realistic proportions, centre
 * binding, page-edge depth, paper shadows + ambient light. Real page-curl via react-pageflip;
 * keyboard / drag / swipe / zoom / fullscreen; reduced-motion falls back to a calm spread view.
 */

// One physical page; react-pageflip needs each child to forward a DOM ref.
const FlipPage = forwardRef<HTMLDivElement, { children?: ReactNode; hard?: boolean }>(function FlipPage(
  { children, hard },
  ref,
) {
  return (
    <div ref={ref} className="overflow-hidden bg-white shadow-[inset_0_0_60px_-30px_rgba(20,30,24,0.25)]" data-density={hard ? 'hard' : 'soft'}>
      {children}
    </div>
  );
});

/** Render one physical page = a clip window onto the open pair (left or right half). */
function HalfPage({
  block,
  side,
  photoFor,
  stickerUrlFor,
}: {
  block: Block;
  side: 'left' | 'right';
  photoFor: PhotoFor;
  stickerUrlFor?: (stickerId: string) => string | undefined;
}) {
  // Center-fold shading: each page darkens toward the spine for real open-book depth.
  const foldStyle: CSSProperties =
    side === 'left'
      ? { right: 0, background: 'linear-gradient(to right, transparent, rgba(18,28,22,0.2))' }
      : { left: 0, background: 'linear-gradient(to left, transparent, rgba(18,28,22,0.2))' };
  // Outer edge: a faint "page stack" sliver away from the spine, hinting at the book's thickness.
  const outerStyle: CSSProperties =
    side === 'left'
      ? { left: 0, background: 'linear-gradient(to left, transparent, rgba(18,28,22,0.07))' }
      : { right: 0, background: 'linear-gradient(to right, transparent, rgba(18,28,22,0.07))' };
  return (
    <div className="relative h-full w-full overflow-hidden bg-white">
      <div className="absolute top-0 h-full" style={{ width: '200%', left: side === 'left' ? '0' : '-100%' }}>
        <PairContent block={block} photoFor={photoFor} stickerUrlFor={stickerUrlFor} half={side} badge="compact" />
      </div>
      <div className="pointer-events-none absolute inset-y-0 z-[2] w-[13%]" style={foldStyle} />
      <div className="pointer-events-none absolute inset-y-0 z-[2] w-[5%]" style={outerStyle} />
    </div>
  );
}

type PhotoFor = (id: string | null | undefined) => PairPhoto | undefined;

export default function Flipbook({
  blocks,
  photoMap,
  stickerUrlFor,
  photoStateFor,
  cover,
  onClose,
  infoPanel,
  primaryAction,
  showGutter = true,
  startPage = 0,
  onPageChange,
  onEditAlbum,
}: {
  blocks: Block[];
  photoMap: Map<string, Photo>;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  /** Drives the shared processing badge. Absent outside the builder. */
  photoStateFor?: (photoId: string) => PhotoUiState | undefined;
  cover: FlipCover;
  /** Draw the printed fold in the flat spread view (Album Settings → Show print gutter). */
  showGutter?: boolean;
  /**
   * Physical page to open on. This is what makes Edit → Preview continuous: the designer lands
   * on the spread they were working on rather than being sent back to the cover.
   */
  startPage?: number;
  /** Fires as the reader turns pages, so the host can return them to the same place on exit. */
  onPageChange?: (page: number) => void;
  /** Present in the builder: swaps the dismiss X for a labelled "Edit album" destination. */
  onEditAlbum?: () => void;
  onClose: () => void;
  /** Optional right-docked panel (product info in the preview). Overlay — never changes the book. */
  infoPanel?: ReactNode;
  /** Optional persistent CTA (e.g. "Start Designing") pinned bottom-centre. */
  primaryAction?: ReactNode;
}) {
  const bookRef = useRef<{ pageFlip: () => { flipNext: () => void; flipPrev: () => void } } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 420, h: 560 });
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [page, setPage] = useState(startPage);
  const reduce = usePrefersReducedMotion();

  // Friendly position label: the front cover, the content spreads, then the back cover.
  const backIndex = cover ? 1 + blocks.length * 2 : -1;
  const spreadLabel =
    page <= 0
      ? 'Front cover'
      : backIndex > 0 && page >= backIndex
        ? 'Back cover'
        : `Spread ${Math.ceil(page / 2)} of ${Math.max(1, blocks.length)}`;

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await rootRef.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      /* fullscreen not available — modal already fills the viewport */
    }
  };

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const photoFor: PhotoFor = usePhotoFor(photoMap, photoStateFor);

  // Size ONE portrait page (aspect from the product) so the full open spread (two pages) always
  // fits the viewport — width is the binding constraint, so we fit the whole spread. `page` =
  // width/height, so height = width / page and width = height * page (no hardcoded 3:4 / 4:3).
  const { page: pageRatio } = useBuilderDimensions();
  useEffect(() => {
    const measure = () => {
      const maxSpread = Math.min(window.innerWidth * 0.94, 1080); // full open-book width
      const maxH = window.innerHeight * 0.74;
      let w = maxSpread / 2; // per-page width
      let h = w / pageRatio;
      if (h > maxH) {
        h = maxH;
        w = h * pageRatio;
      }
      setDims({ w: Math.round(w), h: Math.round(h) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [pageRatio]);

  // Build the physical-page list: FRONT COVER (hard) → each block's left+right page, so the
  // book opens cover → continuous content spreads (no empty inside-cover flip to leaf past).
  const pages: ReactNode[] = [];
  pages.push(
    <FlipPage key="cover" hard>
      {cover ? (
        <div className="relative h-full w-full">
          <CoverDesignFromConfig config={cover.config} title={cover.title} imageUrl={cover.imageUrl} pageAspect={pageRatio} stickerUrlFor={stickerUrlFor} />
          {/* Spine-edge depth on the binding side (right). */}
          <div className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-[8%]" style={{ background: 'linear-gradient(to left, rgba(18,28,22,0.32), transparent)' }} />
        </div>
      ) : (
        <div className="grid h-full w-full place-items-center bg-studio text-studio-foreground">
          <span className="font-display text-lg">Cover</span>
        </div>
      )}
    </FlipPage>,
  );
  blocks.forEach((b) => {
    pages.push(
      <FlipPage key={`${b.key}-l`}>
        <HalfPage block={b} side="left" photoFor={photoFor} stickerUrlFor={stickerUrlFor} />
      </FlipPage>,
      <FlipPage key={`${b.key}-r`}>
        <HalfPage block={b} side="right" photoFor={photoFor} stickerUrlFor={stickerUrlFor} />
      </FlipPage>,
    );
  });
  if (cover) {
    // Back cover — the final hard page (the back of the book).
    pages.push(
      <FlipPage key="back-cover" hard>
        <div className="relative h-full w-full">
          <BackCoverDesign back={cover.config.back} imageUrl={cover.backImageUrl} stickerUrlFor={stickerUrlFor} />
          {/* Spine-edge depth on the binding side (left). */}
          <div className="pointer-events-none absolute inset-y-0 left-0 z-[2] w-[8%]" style={{ background: 'linear-gradient(to right, rgba(18,28,22,0.32), transparent)' }} />
        </div>
      </FlipPage>,
    );
  }

  // Keyboard navigation + close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.fullscreenElement) return; // let the browser exit fullscreen first
        onClose();
      } else if (e.key === 'ArrowRight') bookRef.current?.pageFlip().flipNext();
      else if (e.key === 'ArrowLeft') bookRef.current?.pageFlip().flipPrev();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div ref={rootRef} className="animate-fade-in fixed inset-0 z-[100] flex flex-col bg-[rgb(10_15_12/0.88)] backdrop-blur-md">
      {/* Optional preview overlays — additive, never touch the book layout/geometry. */}
      {infoPanel && (
        <aside className="pointer-events-auto absolute right-0 top-0 z-[30] hidden h-full w-[320px] overflow-y-auto border-l border-white/10 bg-[rgb(12_18_14/0.72)] backdrop-blur-xl lg:block">
          {infoPanel}
        </aside>
      )}
      {primaryAction && (
        <div className="pointer-events-none absolute bottom-6 left-0 z-[30] flex w-full justify-center lg:w-[calc(100%-320px)]">
          <div className="pointer-events-auto">{primaryAction}</div>
        </div>
      )}
      {/* Studio stage — a soft top light + edge vignette so the book reads as a lit object. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(130% 80% at 50% 12%, rgba(86,112,96,0.22), transparent 52%), radial-gradient(150% 130% at 50% 116%, rgba(0,0,0,0.55), transparent 60%)',
        }}
      />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3 text-white/90 sm:px-6">
        <span className="font-display text-[15px] tracking-tight">{cover?.name ?? 'Album preview'}</span>
        <div className="flex items-center gap-1.5">
          <CircleBtn label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}>
            <ZoomOut className="h-4 w-4" />
          </CircleBtn>
          <span className="w-12 text-center text-[12px] tabular-nums text-white/70">{Math.round(zoom * 100)}%</span>
          <CircleBtn label="Zoom in" onClick={() => setZoom((z) => Math.min(2, +(z + 0.15).toFixed(2)))}>
            <ZoomIn className="h-4 w-4" />
          </CircleBtn>
          <CircleBtn label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </CircleBtn>
          {/* The other half of the persistent Edit ↔ Preview toggle. In preview the way back to
              editing is a real, labelled destination rather than a dismiss affordance — the
              builder is still mounted underneath, so it costs nothing but a repaint. */}
          {onEditAlbum ? (
            <button
              type="button"
              onClick={onEditAlbum}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/95 px-3.5 text-[12.5px] font-semibold text-[rgb(16_24_20)] shadow-sm transition-all duration-150 hover:bg-white active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit album
            </button>
          ) : (
            <CircleBtn label="Close preview" onClick={onClose}>
              <X className="h-4 w-4" />
            </CircleBtn>
          )}
        </div>
      </div>

      {/* Book */}
      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 pb-10">
        {reduce ? (
          <StaticSpreads blocks={blocks} cover={cover} photoFor={photoFor} stickerUrlFor={stickerUrlFor} width={dims.w} showGutter={showGutter} />
        ) : (
          <div className="animate-rise relative" style={{ transform: `scale(${zoom})`, transition: 'transform 200ms ease' }}>
            {/* Ambient depth — a soft cast shadow grounds the open book in space. */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 z-0 -translate-x-1/2 rounded-[50%] bg-black/45 blur-2xl"
              style={{ bottom: -dims.h * 0.05, width: dims.w * 1.92, height: dims.h * 0.1 }}
            />
            {/* @ts-expect-error react-pageflip's children typing is loose */}
            <HTMLFlipBook
              ref={bookRef}
              width={dims.w}
              height={dims.h}
              startPage={startPage}
              size="fixed"
              minWidth={150}
              maxWidth={620}
              minHeight={200}
              maxHeight={900}
              showCover
              drawShadow
              flippingTime={700}
              maxShadowOpacity={0.55}
              usePortrait={false}
              mobileScrollSupport
              onFlip={(e: { data: number }) => {
                setPage(e.data);
                // Report upward so leaving the preview returns to the spread being looked at.
                onPageChange?.(e.data);
              }}
              className="ms-flipbook relative z-[1]"
              style={{}}
            >
              {pages}
            </HTMLFlipBook>
          </div>
        )}
      </div>

      {!reduce && (
        <div className="relative z-10 flex flex-col items-center gap-1.5 pb-6">
          <div className="flex items-center gap-4">
            <CircleBtn label="Previous page" onClick={() => bookRef.current?.pageFlip().flipPrev()}>
              <ChevronLeft className="h-5 w-5" />
            </CircleBtn>
            <span className="min-w-[7.5rem] text-center text-[12.5px] font-medium tabular-nums text-white/85">{spreadLabel}</span>
            <CircleBtn label="Next page" onClick={() => bookRef.current?.pageFlip().flipNext()}>
              <ChevronRight className="h-5 w-5" />
            </CircleBtn>
          </div>
          <span className="text-[11px] text-white/45">Drag a corner, use the arrows, or press ← →</span>
        </div>
      )}
    </div>
  );
}

function StaticSpreads({
  blocks,
  cover,
  photoFor,
  stickerUrlFor,
  width,
  showGutter,
}: {
  blocks: Block[];
  cover: FlipCover;
  photoFor: PhotoFor;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  width: number;
  showGutter: boolean;
}) {
  const { page: pageRatio, pair: pairRatio } = useBuilderDimensions();
  return (
    <div className="flex max-h-full flex-col items-center gap-6 overflow-y-auto py-4">
      {cover && (
        <div className="overflow-hidden shadow-elevated" style={{ width, aspectRatio: pageRatio }}>
          <CoverDesignFromConfig config={cover.config} title={cover.title} imageUrl={cover.imageUrl} pageAspect={pageRatio} stickerUrlFor={stickerUrlFor} />
        </div>
      )}
      {blocks.map((b) => (
        <div key={b.key} className="relative overflow-hidden bg-white shadow-elevated" style={{ width: width * 2, aspectRatio: pairRatio, containerType: 'inline-size' as const }}>
          <PairContent block={b} photoFor={photoFor} stickerUrlFor={stickerUrlFor} />
          {/* The flat (reduced-motion) spread view shows the SAME fold as the builder canvas.
              The page-curl view keeps its own lighting, where the fold is inherent to the 3D. */}
          {showGutter && <PrintGutter />}
        </div>
      ))}
      {cover && (
        <div className="overflow-hidden shadow-elevated" style={{ width, aspectRatio: pageRatio }}>
          <BackCoverDesign back={cover.config.back} imageUrl={cover.backImageUrl} stickerUrlFor={stickerUrlFor} />
        </div>
      )}
    </div>
  );
}

function CircleBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white/90 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      {children}
    </button>
  );
}

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduce;
}
