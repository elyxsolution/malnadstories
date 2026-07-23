// Deterministic ROTATE — orthogonal (90/180/270°) rotations only. Each is a lossless pixel
// permutation (no interpolation, no rounding), so output bytes are an exact function of input
// bytes. 90/270 swap the dimensions. Clockwise degrees.

import type { RasterImage } from '../model.js';
import type { RotateOp } from '../operations.js';

export function rotateImage(image: RasterImage, op: RotateOp): RasterImage {
  switch (op.degrees) {
    case 180:
      return rotate180(image);
    case 90:
      return rotateQuarter(image, true);
    case 270:
      return rotateQuarter(image, false);
    default:
      return image;
  }
}

function rotate180(image: RasterImage): RasterImage {
  const { width, height, channels: c, data } = image;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * c;
      const dst = ((height - 1 - y) * width + (width - 1 - x)) * c;
      for (let k = 0; k < c; k += 1) out[dst + k] = data[src + k] as number;
    }
  }
  return { ...image, data: out };
}

/** Quarter turn: `clockwise` = 90° CW, otherwise 90° CCW (= 270° CW). Dimensions swap. */
function rotateQuarter(image: RasterImage, clockwise: boolean): RasterImage {
  const { width, height, channels: c, data } = image;
  const outW = height;
  const outH = width;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * c;
      const dx = clockwise ? height - 1 - y : y;
      const dy = clockwise ? x : width - 1 - x;
      const dst = (dy * outW + dx) * c;
      for (let k = 0; k < c; k += 1) out[dst + k] = data[src + k] as number;
    }
  }
  return { ...image, width: outW, height: outH, data: out };
}
