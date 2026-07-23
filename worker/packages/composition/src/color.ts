// Deterministic COLOUR + BLEND math. Straight alpha compositing (source-over) with the minimal
// blend modes, all in integer sRGB space with `Math.round` on IEEE-754 arithmetic — so a
// composited pixel is a byte-exact function of its inputs on every platform. Alpha is normalized
// to [0,1] for the maths, colours stay 0..255.

import type { BlendMode, Rgba } from './model.js';

/** Clamp a value to a valid 0..255 byte. */
export function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

/** Blend a single colour channel of source over destination under a blend mode (pre-alpha). */
function blendChannel(mode: BlendMode, src: number, dst: number): number {
  switch (mode) {
    case 'multiply':
      return (src * dst) / 255;
    case 'screen':
      return 255 - ((255 - src) * (255 - dst)) / 255;
    case 'normal':
    default:
      return src;
  }
}

/**
 * Composite one RGBA source pixel over an RGBA destination pixel IN PLACE in `dst` at `di`. The
 * effective source alpha is `srcA01` (already folded with mask + layer opacity, in [0,1]). Uses
 * source-over: `out = blended·a + dst·(1−a)`, with the canvas alpha accumulated the same way.
 */
export function compositePixel(
  mode: BlendMode,
  dst: Uint8Array,
  di: number,
  sr: number,
  sg: number,
  sb: number,
  srcA01: number,
): void {
  if (srcA01 <= 0) return;
  const dr = dst[di] as number;
  const dg = dst[di + 1] as number;
  const db = dst[di + 2] as number;
  const da01 = (dst[di + 3] as number) / 255;

  // Blend the source colour against the destination colour first (blend mode), then alpha-over.
  const br = blendChannel(mode, sr, dr);
  const bg = blendChannel(mode, sg, dg);
  const bb = blendChannel(mode, sb, db);

  const outA01 = srcA01 + da01 * (1 - srcA01);
  dst[di] = clampByte(br * srcA01 + dr * (1 - srcA01));
  dst[di + 1] = clampByte(bg * srcA01 + dg * (1 - srcA01));
  dst[di + 2] = clampByte(bb * srcA01 + db * (1 - srcA01));
  dst[di + 3] = clampByte(outA01 * 255);
}

/** Fill an RGBA buffer with a solid colour. */
export function fillRgba(buffer: Uint8Array, color: Rgba): void {
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = clampByte(color.r);
    buffer[i + 1] = clampByte(color.g);
    buffer[i + 2] = clampByte(color.b);
    buffer[i + 3] = clampByte(color.a);
  }
}

/** Opaque white / fully-transparent presets used as deterministic defaults. */
export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };
export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };
