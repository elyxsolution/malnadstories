// Deterministic CROP — extract an axis-aligned sub-rectangle. A pure pixel copy: no interpolation,
// no rounding, so it is exactly reproducible. Out-of-bounds rectangles are rejected.

import type { RasterImage } from '../model.js';
import type { CropOp } from '../operations.js';
import { BackendError } from '../errors.js';

export function cropImage(image: RasterImage, op: CropOp): RasterImage {
  const { x, y, width, height } = op;
  if (x + width > image.width || y + height > image.height) {
    throw new BackendError('Crop rectangle exceeds the image bounds', {
      crop: { x, y, width, height },
      image: { width: image.width, height: image.height },
    });
  }
  const c = image.channels;
  const out = new Uint8Array(width * height * c);
  for (let row = 0; row < height; row += 1) {
    const srcStart = ((y + row) * image.width + x) * c;
    const srcEnd = srcStart + width * c;
    out.set(image.data.subarray(srcStart, srcEnd), row * width * c);
  }
  return { ...image, width, height, data: out };
}
