// Orientation MATH — the pure mapping from an EXIF orientation code (1..8) to the geometric
// transform that brings the raster to the canonical display orientation, and the resulting
// (possibly axis-swapped) dimensions. No pixels are moved here; a later native backend applies the
// transform. Deterministic by construction.

import type { OrientationCode, OrientationTransform, OrientedImage } from '../model.js';
import { IMAGE_ENGINE_VERSION, ORIENTED_SCHEMA } from '../model.js';

interface Correction {
  readonly transform: OrientationTransform;
  readonly swaps: boolean;
}

// Rotation is clockwise degrees; the horizontal flip is applied before the rotation. Together the
// eight rows cover the full dihedral group the EXIF orientation tag encodes.
const CORRECTIONS: Readonly<Record<OrientationCode, Correction>> = {
  1: { transform: { rotate: 0, flipHorizontal: false }, swaps: false },
  2: { transform: { rotate: 0, flipHorizontal: true }, swaps: false },
  3: { transform: { rotate: 180, flipHorizontal: false }, swaps: false },
  4: { transform: { rotate: 180, flipHorizontal: true }, swaps: false },
  5: { transform: { rotate: 90, flipHorizontal: true }, swaps: true },
  6: { transform: { rotate: 90, flipHorizontal: false }, swaps: true },
  7: { transform: { rotate: 270, flipHorizontal: true }, swaps: true },
  8: { transform: { rotate: 270, flipHorizontal: false }, swaps: true },
};

/** The correction transform for an orientation code. */
export function orientationCorrection(orientation: OrientationCode): Correction {
  return CORRECTIONS[orientation];
}

/**
 * Normalize a raster of `width`×`height` stored at `orientation` onto the canonical display
 * orientation (1), returning the applied transform and the post-transform dimensions.
 */
export function normalizeOrientation(
  orientation: OrientationCode,
  width: number,
  height: number,
): OrientedImage {
  const { transform, swaps } = CORRECTIONS[orientation];
  return {
    schema: ORIENTED_SCHEMA,
    engineVersion: IMAGE_ENGINE_VERSION,
    sourceOrientation: orientation,
    appliedTransform: transform,
    swapsDimensions: swaps,
    width: swaps ? height : width,
    height: swaps ? width : height,
    normalizedOrientation: 1,
  };
}
