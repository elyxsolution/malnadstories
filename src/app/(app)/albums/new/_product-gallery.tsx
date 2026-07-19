'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Minimize2 } from 'lucide-react';

/**
 * Premium product preview lightbox — a full-screen gallery for a product's imagery.
 * Desktop: modal · arrow nav · keyboard (←/→/Esc) · zoom · thumbnail strip · counter · fullscreen.
 * Mobile: swipe between images · tap zoom · fullscreen. Pure presentation over presigned URLs.
 */
export default function ProductGallery({
  images,
  title,
  startIndex = 0,
  onClose,
}: {
  images: string[];
  title: string;
  startIndex?: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(Math.min(startIndex, Math.max(0, images.length - 1)));
  const [zoomed, setZoomed] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);

  const count = images.length;
  const go = useCallback(
    (dir: -1 | 1) => {
      setZoomed(false);
      setIndex((i) => (i + dir + count) % count);
    },
    [count],
  );

  // Keyboard navigation + close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  // Track fullscreen state.
  useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else rootRef.current?.requestFullscreen().catch(() => {});
  };

  if (count === 0) return null;

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100] flex flex-col bg-black/92 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} gallery`}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 text-white/90 sm:px-6">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs tabular-nums text-white/55">
            {index + 1} / {count}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <IconBtn label={zoomed ? 'Zoom out' : 'Zoom in'} onClick={() => setZoomed((z) => !z)}>
            {zoomed ? <ZoomOut className="h-5 w-5" /> : <ZoomIn className="h-5 w-5" />}
          </IconBtn>
          <IconBtn label={isFull ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>
            {isFull ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </IconBtn>
          <IconBtn label="Close" onClick={onClose}>
            <X className="h-5 w-5" />
          </IconBtn>
        </div>
      </div>

      {/* Stage */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 sm:px-16"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
          touchX.current = null;
        }}
      >
        {count > 1 && (
          <IconBtn label="Previous" onClick={() => go(-1)} className="absolute left-2 top-1/2 hidden -translate-y-1/2 sm:flex">
            <ChevronLeft className="h-7 w-7" />
          </IconBtn>
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[index]}
          alt={`${title} — image ${index + 1}`}
          onClick={() => setZoomed((z) => !z)}
          className={`max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl transition-transform duration-300 ${
            zoomed ? 'scale-[1.6] cursor-zoom-out' : 'cursor-zoom-in'
          }`}
          draggable={false}
        />

        {count > 1 && (
          <IconBtn label="Next" onClick={() => go(1)} className="absolute right-2 top-1/2 hidden -translate-y-1/2 sm:flex">
            <ChevronRight className="h-7 w-7" />
          </IconBtn>
        )}
      </div>

      {/* Thumbnail strip */}
      {count > 1 && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 py-3 sm:py-4">
          {images.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setZoomed(false);
                setIndex(i);
              }}
              aria-label={`View image ${i + 1}`}
              className={`relative h-14 w-14 flex-none overflow-hidden rounded-md ring-2 transition-all ${
                i === index ? 'ring-white' : 'opacity-55 ring-transparent hover:opacity-90'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  className = '',
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 active:scale-95 ${className}`}
    >
      {children}
    </button>
  );
}
