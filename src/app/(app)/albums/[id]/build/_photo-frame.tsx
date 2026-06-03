'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { computeFrameLayout, cssFilter, sharpenKernel, type EditConfig } from '@/lib/builder/model';

/**
 * THE single render surface. Applies the non-destructive EditConfig at display time
 * (R2 original untouched) and is used by the tray, slots, overlays, preview, and the
 * editor's crop canvas — so a photo looks identical everywhere (WYSIWYG).
 *
 * Geometry (crop + rotate + tilt + flip) comes from the pure computeFrameLayout();
 * brightness is a cheap CSS filter; sharpness is an SVG feConvolveMatrix attached
 * ONLY when sharpness > 0 (default frames pay nothing — matters in the preview where
 * many frames render at once). The filter id is per-instance so duplicate photos
 * (tray + slot + preview) never collide.
 */
export default function PhotoFrame({
  url,
  edit,
  alt = '',
  className,
  onReady,
}: {
  url: string;
  edit?: EditConfig | null;
  alt?: string;
  className?: string;
  // Fires exactly once when the image has loaded OR failed (used by the print route
  // to know every frame has settled). A failed image still counts as "ready" so one
  // broken/expired URL can't hang PDF generation. The app UI ignores this.
  onReady?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const rawId = useId();
  const sharpenId = `ms-sharpen-${rawId.replace(/:/g, '')}`;

  const readyRef = useRef(false);
  const fireReady = () => {
    if (readyRef.current) return;
    readyRef.current = true;
    onReady?.();
  };
  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
    fireReady();
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setFrame({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = computeFrameLayout(frame.w, frame.h, nat.w, nat.h, edit);
  const sharpness = edit?.sharpness ?? 0;

  return (
    <div
      ref={ref}
      className={`relative h-full w-full overflow-hidden ${className ?? ''}`}
      style={{ filter: cssFilter(edit, sharpenId) }}
    >
      {sharpness > 0 && (
        <svg width="0" height="0" className="absolute" aria-hidden>
          <filter id={sharpenId} x="0" y="0" width="100%" height="100%">
            <feConvolveMatrix order="3 3" preserveAlpha="true" kernelMatrix={sharpenKernel(sharpness)} />
          </filter>
        </svg>
      )}

      {layout ? (
        <div
          className="absolute"
          style={{ left: layout.layer.left, top: layout.layer.top, width: layout.layer.width, height: layout.layer.height }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt}
            draggable={false}
            onLoad={handleLoad}
            onError={fireReady}
            className="absolute left-1/2 top-1/2 max-w-none select-none"
            style={{ width: layout.img.width, height: layout.img.height, transform: layout.img.transform, willChange: 'transform' }}
          />
        </div>
      ) : (
        // Fallback until the frame is measured and the natural size is known.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          draggable={false}
          onLoad={handleLoad}
          onError={fireReady}
          className="absolute inset-0 h-full w-full select-none object-cover"
        />
      )}
    </div>
  );
}
