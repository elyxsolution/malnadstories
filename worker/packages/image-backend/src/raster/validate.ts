// OUTPUT VALIDATION — the gate a producer runs on a raster before it becomes an Artifact. Checks
// internal consistency (positive integer dimensions, a legal channel/colour-space pairing, and a
// `data` length that exactly matches the geometry). A raster that fails this is never encoded or
// produced, so no malformed pixel Artifact can be created.

import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';
import type { RasterImage } from '../model.js';
import { expectedByteLength } from '../model.js';

export interface RasterLimits {
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly maxPixels?: number;
}

/** Validate a raster's internal consistency (+ optional size limits). */
export function validateRaster(
  image: RasterImage,
  limits: RasterLimits = {},
): Result<void, ValidationError> {
  if (!Number.isInteger(image.width) || image.width <= 0) {
    return fail('raster width must be a positive integer', { width: image.width });
  }
  if (!Number.isInteger(image.height) || image.height <= 0) {
    return fail('raster height must be a positive integer', { height: image.height });
  }
  if (image.channels !== 1 && image.channels !== 3 && image.channels !== 4) {
    return fail('raster channels must be 1, 3, or 4', { channels: image.channels });
  }
  if (image.bitDepth !== 8) {
    return fail('raster bit depth must be 8', { bitDepth: image.bitDepth });
  }
  if (!channelsMatchColorSpace(image.channels, image.colorSpace)) {
    return fail('channel count is incompatible with the colour space', {
      channels: image.channels,
      colorSpace: image.colorSpace,
    });
  }
  const expected = expectedByteLength(image);
  if (image.data.length !== expected) {
    return fail('raster data length does not match its geometry', {
      actual: image.data.length,
      expected,
    });
  }
  if (limits.maxWidth !== undefined && image.width > limits.maxWidth) {
    return fail('raster exceeds the maximum width', { width: image.width, max: limits.maxWidth });
  }
  if (limits.maxHeight !== undefined && image.height > limits.maxHeight) {
    return fail('raster exceeds the maximum height', {
      height: image.height,
      max: limits.maxHeight,
    });
  }
  if (limits.maxPixels !== undefined && image.width * image.height > limits.maxPixels) {
    return fail('raster exceeds the maximum pixel count', {
      pixels: image.width * image.height,
      max: limits.maxPixels,
    });
  }
  return ok(undefined);
}

/** A single channel count (1) pairs with `gray`; 3/4 pair with `srgb`/`linear`. */
function channelsMatchColorSpace(channels: number, colorSpace: string): boolean {
  if (colorSpace === 'gray') return channels === 1;
  return channels === 3 || channels === 4; // srgb / linear
}

function fail(message: string, context: Record<string, unknown>): Result<void, ValidationError> {
  return err(new ValidationError(message, { context: context as never }));
}
