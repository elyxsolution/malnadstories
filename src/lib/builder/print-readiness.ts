/**
 * WHEN IS A PHOTO FRAME FINISHED? — the readiness rule the PDF capture waits on. PURE.
 *
 * ── THE RACE THIS CLOSES ───────────────────────────────────────────────────────────────────
 *
 * `PhotoFrame` renders a photo in one of two ways:
 *
 *   layout !== null   the DESIGNED render — `computeFrameLayout` has the frame's measured size
 *                     AND the image's natural size, so the crop, zoom, pan, rotation, tilt and
 *                     flip the customer composed are all applied.
 *   layout === null   a FALLBACK — a plain `object-fit: cover` image, correct only by accident.
 *                     It exists so a frame is never blank while it waits.
 *
 * The frame's size arrives from a `ResizeObserver`; the natural size arrives from the image's
 * `load` event. They are independent. Readiness used to be signalled from `load` ALONE, so a
 * frame could report itself finished while it was still showing the fallback — and if the print
 * route's counter reached its total at that moment, Chromium captured the page with the
 * customer's crop not yet applied. Silently: the photo is there, it fills its frame, and it is
 * simply not the picture they framed.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────────────────────
 *
 * A frame is ready when it is showing what it will finally show, and can never be ready on a
 * timer — a delay long enough to be safe is a delay every PDF pays, and one short enough not to
 * hurt is one that eventually loses the race.
 *
 *   1. `layout` resolved            → the designed render is on screen. Ready.
 *   2. the image failed             → nothing better is coming. Ready. A broken or expired URL
 *                                     must never be able to hang PDF generation.
 *   3. loaded AND measured, but no  → both inputs have arrived and STILL produce no layout, which
 *      layout                         means the frame measured as degenerate (a zero-sized box).
 *                                     Nothing further will change it, so waiting is waiting
 *                                     forever. Ready — the fallback is the final answer here.
 *
 * (3) is what keeps this from being able to deadlock, and it is why `measured` is an explicit
 * flag rather than `frame.w > 0`: a frame that has genuinely been measured as zero and one that
 * has not been measured yet look identical in the numbers, and only one of them is finished.
 */

export type FrameReadyState = {
  /** `computeFrameLayout` returned a layout — the designed crop/zoom/rotation is rendered. */
  readonly hasLayout: boolean;
  /** The image reported `load`, so its natural size is known. */
  readonly loaded: boolean;
  /** The ResizeObserver has delivered at least one observation — even a zero-sized one. */
  readonly measured: boolean;
  /** The image reported `error`; no better render is possible. */
  readonly errored: boolean;
};

/**
 * Is this frame finished, for the purposes of capturing a PDF?
 *
 * Deterministic and state-based: every input is an event that has either happened or not. There
 * is no time in this function, and there must never be.
 */
export function isFrameReadyForCapture(s: FrameReadyState): boolean {
  if (s.errored) return true;
  if (s.hasLayout) return true;
  return s.loaded && s.measured;
}
