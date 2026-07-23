// Deterministic RESIZE — nearest-neighbour or bilinear, to an exact target width×height. Both
// filters use fixed, center-aligned sampling and `Math.round` on IEEE-754 arithmetic, so the same
// input + target produces byte-identical output on every platform. No SIMD, no ambient rounding
// modes — determinism over raw throughput (throughput is the native backend's concern).

import type { RasterImage } from '../model.js';
import type { ResizeOp } from '../operations.js';

export function resizeImage(image: RasterImage, op: ResizeOp): RasterImage {
  const filter = op.filter ?? 'bilinear';
  if (op.width === image.width && op.height === image.height) {
    return { ...image, data: new Uint8Array(image.data) };
  }
  return filter === 'nearest' ? resizeNearest(image, op) : resizeBilinear(image, op);
}

function resizeNearest(image: RasterImage, op: ResizeOp): RasterImage {
  const { width: sw, height: sh, channels: c, data } = image;
  const { width: dw, height: dh } = op;
  const out = new Uint8Array(dw * dh * c);
  for (let dy = 0; dy < dh; dy += 1) {
    const sy = clamp(Math.floor(((dy + 0.5) * sh) / dh), 0, sh - 1);
    for (let dx = 0; dx < dw; dx += 1) {
      const sx = clamp(Math.floor(((dx + 0.5) * sw) / dw), 0, sw - 1);
      const src = (sy * sw + sx) * c;
      const dst = (dy * dw + dx) * c;
      for (let k = 0; k < c; k += 1) out[dst + k] = data[src + k] as number;
    }
  }
  return { ...image, width: dw, height: dh, data: out };
}

function resizeBilinear(image: RasterImage, op: ResizeOp): RasterImage {
  const { width: sw, height: sh, channels: c, data } = image;
  const { width: dw, height: dh } = op;
  const out = new Uint8Array(dw * dh * c);
  for (let dy = 0; dy < dh; dy += 1) {
    const fy = clampF(((dy + 0.5) * sh) / dh - 0.5, 0, sh - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, sh - 1);
    const wy = fy - y0;
    for (let dx = 0; dx < dw; dx += 1) {
      const fx = clampF(((dx + 0.5) * sw) / dw - 0.5, 0, sw - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, sw - 1);
      const wx = fx - x0;
      const p00 = (y0 * sw + x0) * c;
      const p10 = (y0 * sw + x1) * c;
      const p01 = (y1 * sw + x0) * c;
      const p11 = (y1 * sw + x1) * c;
      const dst = (dy * dw + dx) * c;
      for (let k = 0; k < c; k += 1) {
        const top = lerp(data[p00 + k] as number, data[p10 + k] as number, wx);
        const bottom = lerp(data[p01 + k] as number, data[p11 + k] as number, wx);
        out[dst + k] = Math.round(lerp(top, bottom, wy));
      }
    }
  }
  return { ...image, width: dw, height: dh, data: out };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function clampF(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
