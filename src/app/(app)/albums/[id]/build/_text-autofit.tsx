'use client';

import { useEffect } from 'react';
import { fontStack } from '@/lib/builder/fonts-catalog';
import { textFontPx } from '@/lib/builder/elements';
import { canAutoFitText, fitTextBox, isMeaningfulFit, textFitSignature } from '@/lib/builder/text-fit';
import type { Rect, TextElement } from '@/lib/builder/model';

/**
 * TEXT AUTO-FIT, the measuring half. Renders nothing.
 *
 * Mounted once per text element on an EDITING canvas (the page spread and the cover face). It
 * measures the words the customer actually typed and reports the box that fits them; the decisions
 * about what that box means live in `lib/builder/text-fit.ts`.
 *
 * ── WHY THE MIRROR IS ATTACHED TO THE CONTAINER, NOT THE BODY ──────────────────────────────
 *
 * Every builder font is a CSS variable (`var(--font-display)`, …) declared by `builderFontVars` on
 * a wrapper element, not on `:root`. A mirror parked on `document.body` would resolve none of them
 * and would be measured in the browser's fallback face — a plausible-looking box that is quietly
 * the wrong size. Inside the page/face element the variables inherit, so the mirror is laid out in
 * the same typeface the canvas paints.
 *
 * It is created, measured and removed synchronously inside the effect, so React never reconciles
 * against it and no stray node survives a render.
 *
 * ── WHY THERE IS NO ResizeObserver ─────────────────────────────────────────────────────────
 *
 * Observing the element's size and rewriting that size is a feedback loop. This effect is keyed on
 * TYPOGRAPHY (`textFitSignature`) and writes only GEOMETRY, two disjoint sets, so a fit cannot
 * trigger a fit. Resizing the canvas window does not re-fit either, and does not need to: the box
 * is normalized, so it already scales with the surface.
 */
export default function TextAutoFit({
  el,
  containerRef,
  enabled,
  onFit,
}: {
  el: TextElement;
  /** The page / cover-face element — the box the element's 0..1 coordinates are relative to. */
  containerRef: React.RefObject<HTMLElement>;
  /**
   * False while something else owns this element's geometry: a live resize gesture (the pointer
   * decides the box, and a fit mid-drag would fight it) or the open inline editor (the words being
   * typed are not in `el.text` yet). Flipping back to true re-runs the fit once, which is how a
   * corner drag ends with a tight box.
   */
  enabled: boolean;
  /** Receives the fitted box. Expected to be an AMEND — a correction, not a new undo entry. */
  onFit: (box: Rect) => void;
}) {
  const sig = textFitSignature(el);

  useEffect(() => {
    if (!enabled || !canAutoFitText(el)) return;
    const container = containerRef.current;
    if (!container) return;

    // `offsetWidth/Height` is the LAYOUT size — the same box container queries resolve `cqw`
    // against. `getBoundingClientRect` would report a transformed size and silently disagree.
    const cw = container.offsetWidth;
    const ch = container.offsetHeight;
    if (!(cw > 0) || !(ch > 0)) return;

    const mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    Object.assign(mirror.style, {
      position: 'absolute',
      left: '-99999px',
      top: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      // `max-content` bounded by the CURRENT box width: one line reports its natural width, and
      // wrapped text reports its widest line without moving a break. See text-fit.ts.
      width: 'max-content',
      maxWidth: `${Math.max(1, el.w * cw)}px`,
      // The typography `textStyle` paints, minus everything that cannot change the metrics
      // (colour, opacity, shadow, decoration).
      fontFamily: fontStack(el.font),
      fontSize: `${textFontPx(el, cw, ch)}px`,
      fontWeight: String(el.weight),
      fontStyle: el.italic ? 'italic' : 'normal',
      letterSpacing: `${el.letterSpacing}em`,
      lineHeight: String(el.lineHeight),
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    } as Partial<CSSStyleDeclaration>);
    // A trailing newline collapses in an empty inline box; a zero-width space keeps the last
    // line's height real so "Hello\n" measures two lines, as it renders.
    mirror.textContent = el.text === '' ? '​' : el.text.endsWith('\n') ? `${el.text}​` : el.text;

    container.appendChild(mirror);
    const rect = mirror.getBoundingClientRect();
    // Round UP: a box a fraction of a pixel short of the ink clips the last glyph.
    const measured = { w: Math.ceil(rect.width), h: Math.ceil(rect.height) };
    container.removeChild(mirror);

    if (!(measured.w > 0) || !(measured.h > 0)) return;

    const next = fitTextBox(el, measured, { w: cw, h: ch });
    if (isMeaningfulFit(el, next)) onFit(next);
    // `sig` IS the dependency — the element object changes identity on every geometry write, and
    // depending on it directly would re-run this after its own correction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, enabled]);

  return null;
}
