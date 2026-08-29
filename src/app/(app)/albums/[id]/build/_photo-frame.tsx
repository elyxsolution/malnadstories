'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { computeFrameLayout, cssFilter, frameFinish, sharpenKernel, type EditConfig } from '@/lib/builder/model';
import { isFrameReadyForCapture } from '@/lib/builder/print-readiness';
import { now, record } from '@/lib/perf/metrics';

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
  onLoadError,
  lazy = false,
  bleed = false,
}: {
  url: string;
  edit?: EditConfig | null;
  alt?: string;
  className?: string;
  // Fires exactly once when the image has loaded OR failed (used by the print route
  // to know every frame has settled). A failed image still counts as "ready" so one
  // broken/expired URL can't hang PDF generation. The app UI ignores this.
  onReady?: () => void;
  /**
   * Fires when the image fails to load. The builder uses this to detect an EXPIRED signed URL
   * and refresh just that photo (Phase 5). Separate from `onReady`, which must keep treating a
   * failure as "settled" so PDF generation can never hang on it.
   */
  onLoadError?: () => void;
  /**
   * Defer decoding until the image is near the viewport. Off by default — the PRINT ROUTE must
   * never lazy-load, because Puppeteer's readiness gate would wait forever for images the
   * headless viewport never scrolls to. Only surfaces that scroll opt in.
   */
  lazy?: boolean;
  /**
   * Draw the WHOLE image, unclipped, instead of only the part inside the frame.
   *
   * This is the one thing the frame renderer could not do, and the reason the adjustment ghost
   * needs it: while you reposition a photo you have to see what you are choosing FROM, not just
   * what is currently selected. Geometry is untouched — same `computeFrameLayout`, same footprint,
   * same transform — only the clip is lifted, so the faint spill lines up exactly with the crisp
   * frame it surrounds. Off everywhere else, so no printing surface is affected.
   */
  bleed?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const rawId = useId();
  const sharpenId = `ms-sharpen-${rawId.replace(/:/g, '')}`;

  /**
   * PROGRESSIVE TRANSITION (Phase 4). When the URL changes on a frame that is ALREADY showing
   * something — the local blob giving way to the sanitized master — the outgoing image is held
   * on screen underneath while the new one fades in over it, then dropped.
   *
   * Why it is invisible: both layers share the measured frame and the same computed geometry,
   * so nothing reflows; `nat` only updates once the incoming image has decoded, so the layout
   * never jumps mid-fade; and the two images have the same ORIENTED aspect by construction
   * (the worker bakes EXIF rotation in, the browser applies it to the blob), so the crossfade
   * is between two identically-framed pictures.
   *
   * The first paint of a frame is NOT a transition — there is nothing to fade from, so it
   * appears immediately. The print route only ever renders final URLs, so it never crossfades
   * and its readiness gate is untouched.
   */
  const [prevUrl, setPrevUrl] = useState<string | null>(null);
  const [fadedIn, setFadedIn] = useState(true);
  const shownUrlRef = useRef<string>(url);

  useEffect(() => {
    if (url === shownUrlRef.current) return;
    const hadImage = !!shownUrlRef.current;
    setPrevUrl(hadImage ? shownUrlRef.current : null);
    setFadedIn(!hadImage); // nothing to fade from ⇒ show immediately
    shownUrlRef.current = url;
  }, [url]);

  const readyRef = useRef(false);
  const fireReady = () => {
    if (readyRef.current) return;
    readyRef.current = true;
    onReady?.();
  };

  // Decode timing: the clock starts when a new URL is committed to the <img>, so the sample
  // measures fetch + decode as the user experiences it.
  const decodeStartRef = useRef(now());
  useEffect(() => {
    decodeStartRef.current = now();
  }, [url]);

  /**
   * THE TWO INPUTS A DESIGNED RENDER NEEDS, tracked so readiness can wait for BOTH.
   *
   * `loaded` is the image's natural size; `measured` is the frame's box. They arrive from
   * independent sources (the `load` event and a ResizeObserver) and readiness used to be
   * signalled from the first alone — see `lib/builder/print-readiness`. Both are set alongside
   * state React already updates in the same callback, so they cost no extra render.
   */
  const [loaded, setLoaded] = useState(false);
  const [measured, setMeasured] = useState(false);

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    record('image.decode', now() - decodeStartRef.current);
    setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
    setFadedIn(true);
    // NOT `fireReady()`. A decoded image is not a finished frame: until the frame has been
    // measured the renderer is still showing the `object-fit: cover` fallback, and capturing a
    // PDF at that instant prints a photo the customer never framed.
    setLoaded(true);
  };
  const handleError = () => {
    // A broken incoming image must not leave the frame blank behind a half-finished fade.
    setFadedIn(true);
    setPrevUrl(null);
    // Still IMMEDIATE: nothing better is coming, and a broken or expired URL must never be able
    // to hang PDF generation.
    fireReady();
    onLoadError?.();
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setFrame({ w: width, h: height });
      // Batched with `setFrame` in the same callback — one render, not two. A ZERO observation
      // still counts as measured: a degenerate box is an answer, and readiness must not wait on
      // a number that will never change.
      setMeasured(true);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = computeFrameLayout(frame.w, frame.h, nat.w, nat.h, edit);

  /**
   * THE READINESS SIGNAL — fired when the frame is showing what it will finally show.
   *
   * Only surfaces that ask for it (the print routes, via `onReady`) pay anything here; the
   * editor passes no `onReady`, so this effect is inert for the builder canvas, the tray and
   * every other interactive surface. Print-only by construction, not by a flag.
   */
  useEffect(() => {
    if (!onReady) return;
    if (isFrameReadyForCapture({ hasLayout: layout !== null, loaded, measured, errored: false })) fireReady();
    // `fireReady` is idempotent (a ref latch) and reads the latest `onReady` through the closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, loaded, measured, onReady]);
  const sharpness = edit?.sharpness ?? 0;
  // Container finish (opacity / rounded corners / soft shadow). Border-radius uses the
  // measured short edge for crisp, uniform px corners on any aspect.
  const finish = frameFinish(edit, Math.min(frame.w, frame.h) || undefined);

  return (
    <div
      ref={ref}
      className={`relative h-full w-full ${bleed ? '' : 'overflow-hidden'} ${className ?? ''}`}
      style={{ filter: cssFilter(edit, sharpenId), ...finish }}
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
          {/* Outgoing image, held underneath until the incoming one has decoded. */}
          {prevUrl && !fadedIn && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={prevUrl}
              alt=""
              aria-hidden
              draggable={false}
              className="absolute left-1/2 top-1/2 max-w-none select-none"
              style={{ width: layout.img.width, height: layout.img.height, transform: layout.img.transform }}
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt}
            draggable={false}
            onLoad={handleLoad}
            onError={handleError}
            loading={lazy ? 'lazy' : undefined}
            decoding="async"
            onTransitionEnd={() => setPrevUrl(null)}
            className="absolute left-1/2 top-1/2 max-w-none select-none motion-safe:transition-opacity motion-safe:duration-300 motion-safe:ease-out"
            style={{
              width: layout.img.width,
              height: layout.img.height,
              transform: layout.img.transform,
              willChange: 'transform',
              opacity: fadedIn ? 1 : 0,
            }}
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
          onError={handleError}
          loading={lazy ? 'lazy' : undefined}
          decoding="async"
          className="absolute inset-0 h-full w-full select-none object-cover"
        />
      )}
    </div>
  );
}
