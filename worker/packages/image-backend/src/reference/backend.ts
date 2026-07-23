// The DETERMINISTIC REFERENCE BACKEND — a pure-TypeScript `ImageBackend`. It is the invariant-
// preserving default: every operation is byte-identical across supported platforms (no native
// codec, no SIMD, no ambient rounding modes, no randomness, no I/O). A native/GPU backend
// (sharp/libvips) is a reserved drop-in behind this SAME contract, trading byte-determinism for
// throughput where that is acceptable. This backend knows nothing of albums, pages, PDFs, or
// products — it transforms rasters, full stop.

import type { Result } from '@workerv2/contracts';
import type { ValidationError } from '@workerv2/errors';
import { assertNever } from '@workerv2/utils';
import type { BackendInfo, RasterImage } from '../model.js';
import type { ImageBackend } from '../contracts.js';
import type { ConvertOp, CropOp, ImageOperation, ResizeOp, RotateOp } from '../operations.js';
import { decodeRaster, encodeRaster, isRasterContainer } from '../raster/container.js';
import { decodeBmp, isBmp } from '../raster/bmp.js';
import { validateRaster } from '../raster/validate.js';
import type { RasterLimits } from '../raster/validate.js';
import { BackendError } from '../errors.js';
import { resizeImage } from './resize.js';
import { rotateImage } from './rotate.js';
import { cropImage } from './crop.js';
import { convertImage } from './color.js';

export const REFERENCE_BACKEND_ID = 'reference';
export const REFERENCE_BACKEND_VERSION = '1.0.0';

export class ReferenceImageBackend implements ImageBackend {
  readonly info: BackendInfo = {
    id: REFERENCE_BACKEND_ID,
    version: REFERENCE_BACKEND_VERSION,
    deterministic: true,
  };

  constructor(private readonly limits: RasterLimits = {}) {}

  decode(bytes: Uint8Array): RasterImage {
    if (isRasterContainer(bytes)) return decodeRaster(bytes);
    if (isBmp(bytes)) return decodeBmp(bytes);
    throw new BackendError('Unsupported encoded format for the reference backend', {
      hint: 'reference backend decodes the WV2R container or an uncompressed BMP; other formats are a native-backend concern',
    });
  }

  encode(image: RasterImage): Uint8Array {
    return encodeRaster(image);
  }

  resize(image: RasterImage, op: ResizeOp): RasterImage {
    return resizeImage(image, op);
  }

  rotate(image: RasterImage, op: RotateOp): RasterImage {
    return rotateImage(image, op);
  }

  crop(image: RasterImage, op: CropOp): RasterImage {
    return cropImage(image, op);
  }

  convert(image: RasterImage, op: ConvertOp): RasterImage {
    return convertImage(image, op);
  }

  apply(image: RasterImage, operation: ImageOperation): RasterImage {
    switch (operation.op) {
      case 'resize':
        return this.resize(image, operation);
      case 'rotate':
        return this.rotate(image, operation);
      case 'crop':
        return this.crop(image, operation);
      case 'convert':
        return this.convert(image, operation);
      default:
        return assertNever(operation);
    }
  }

  validate(image: RasterImage): Result<void, ValidationError> {
    return validateRaster(image, this.limits);
  }
}

/** Construct the reference backend (optionally with output size limits). */
export function createReferenceBackend(limits?: RasterLimits): ReferenceImageBackend {
  return new ReferenceImageBackend(limits);
}
