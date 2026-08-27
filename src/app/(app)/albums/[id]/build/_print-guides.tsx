'use client';

import type { CSSProperties } from 'react';
import { INTERIOR_SAFE_INSET_FRACTION, INTERIOR_TRIM_INSET_FRACTION } from '@/lib/print/spec';

/**
 * PRINT REFERENCE GUIDES for a content pair — the builder's view of what the printer does.
 *
 * ── ONE PAIR IS TWO SHEETS ────────────────────────────────────────────────────────────────────
 *
 * The canvas draws an open pair, but the printer receives two separate 206 × 291 mm sheets and
 * trims each one to 200 × 285 mm. So there are TWO rectangles, one per page half, and every inset
 * is expressed against a HALF rather than against the pair. A single rectangle around the whole
 * spread would tell the customer the gutter edges are safe, which is the opposite of true.
 *
 * ── THE PAGE RECTANGLE IS THE BLEED ───────────────────────────────────────────────────────────
 *
 * The builder's page IS the artwork area: the export scales the design to fill exactly the
 * 206 × 291 mm bleed box. So the trim — the 200 × 285 mm that survives the cut — is a fixed
 * fraction of it, `3/206` across and `3/291` down, and the ring outside the dotted line is the
 * bleed that gets trimmed away.
 *
 * ── NUMBERS COME FROM THE SPECIFICATION, NOT FROM TASTE ───────────────────────────────────────
 *
 * These used to be `inset-[1.5%]`, `left-[4%]`, `top-[6%]` — percentages that corresponded to no
 * physical dimension. Both rectangles now read `lib/print/spec`, the same module the exporter and
 * the worker read, so a guide can never quietly drift from the sheet.
 *
 * ── INERT, ALWAYS ─────────────────────────────────────────────────────────────────────────────
 *
 * `pointer-events-none` and `aria-hidden` on every layer. No id, no entry in `Block`, nothing
 * persisted, nothing exported. A guide cannot be selected, dragged, deleted, or turned into album
 * content, and the print routes never render this file.
 */

/** A page is half of the open pair, so a per-page x-fraction is halved in pair space. */
const HALF = 0.5;

export function pageInsetStyle(
  inset: { readonly x: number; readonly y: number },
  side: 'left' | 'right',
): CSSProperties {
  const x = inset.x * HALF;
  const left = side === 'left' ? x : HALF + x;
  return {
    left: `${left * 100}%`,
    top: `${inset.y * 100}%`,
    width: `${(HALF - inset.x) * 100}%`,
    height: `${(1 - inset.y * 2) * 100}%`,
  };
}

/** The trim boundary — where the paper is actually cut. Always visible. */
export function TrimGuides() {
  return (
    <div aria-hidden data-guide="trim" className="pointer-events-none absolute inset-0 z-[8]">
      {(['left', 'right'] as const).map((side) => (
        <div
          key={side}
          className="absolute border border-dashed border-foreground/45"
          style={pageInsetStyle(INTERIOR_TRIM_INSET_FRACTION, side)}
        />
      ))}
    </div>
  );
}

/**
 * The 15 mm important-content boundary — behind the existing Show guides toggle.
 *
 * Faces, horizons and text should stay inside it, because the gutter and the binding eat the edge.
 * Deliberately a SECOND, quieter rectangle rather than a replacement: the trim answers "what gets
 * cut off", this answers "what might get lost in the binding", and they are different questions.
 */
export function SafeAreaGuides() {
  return (
    <div aria-hidden data-guide="safe" className="pointer-events-none absolute inset-0 z-[8]">
      {(['left', 'right'] as const).map((side) => (
        <div
          key={side}
          className="absolute border border-dashed border-studio/45"
          style={pageInsetStyle(INTERIOR_SAFE_INSET_FRACTION, side)}
        />
      ))}
    </div>
  );
}

/** What the dotted line means. Precise about WHICH boundary — see the note in `_block.tsx`. */
export const TRIM_GUIDE_CAPTION =
  'Only the area inside the dotted line is printed — the rest is trimmed off';
