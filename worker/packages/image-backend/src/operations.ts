// The IMAGE OPERATION vocabulary — the declarative, deterministic transformations a backend can
// apply, plus pure normalizers/validators for them. An operation is DATA describing a single
// pixel transformation; the backend interprets it. No album/layout/product concepts appear here —
// these are generic raster edits.

import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import type { Channels, ColorSpace } from './model.js';

/** The interpolation filter a resize uses. Both are deterministic. */
export type ResizeFilter = 'nearest' | 'bilinear';

export const RESIZE_FILTERS: readonly ResizeFilter[] = ['nearest', 'bilinear'];

/** Orthogonal rotation only (lossless pixel permutation → deterministic; no interpolation). */
export type RotateDegrees = 90 | 180 | 270;

export interface ResizeOp {
  readonly op: 'resize';
  readonly width: number;
  readonly height: number;
  readonly filter?: ResizeFilter;
}

export interface RotateOp {
  readonly op: 'rotate';
  readonly degrees: RotateDegrees;
}

export interface CropOp {
  readonly op: 'crop';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Convert channel layout and/or colour space (the deterministic ICC-family conversions). */
export interface ConvertOp {
  readonly op: 'convert';
  readonly channels?: Channels;
  readonly colorSpace?: ColorSpace;
}

/** The declarative operation union a caller hands the backend / Pixel Gateway. */
export type ImageOperation = ResizeOp | RotateOp | CropOp | ConvertOp;

/** Validate an operation's parameters in isolation (bounds against an image are checked at apply). */
export function validateOperation(operation: ImageOperation): Result<void, string> {
  switch (operation.op) {
    case 'resize':
      if (!isPositiveInt(operation.width) || !isPositiveInt(operation.height)) {
        return err('resize width/height must be positive integers');
      }
      if (operation.filter !== undefined && !RESIZE_FILTERS.includes(operation.filter)) {
        return err(`resize filter must be one of ${RESIZE_FILTERS.join('/')}`);
      }
      return ok(undefined);
    case 'rotate':
      if (operation.degrees !== 90 && operation.degrees !== 180 && operation.degrees !== 270) {
        return err('rotate degrees must be 90, 180, or 270');
      }
      return ok(undefined);
    case 'crop':
      if (
        !isNonNegativeInt(operation.x) ||
        !isNonNegativeInt(operation.y) ||
        !isPositiveInt(operation.width) ||
        !isPositiveInt(operation.height)
      ) {
        return err('crop x/y must be ≥0 integers and width/height positive integers');
      }
      return ok(undefined);
    case 'convert':
      if (operation.channels !== undefined && ![1, 3, 4].includes(operation.channels)) {
        return err('convert channels must be 1, 3, or 4');
      }
      if (
        operation.colorSpace !== undefined &&
        !['srgb', 'linear', 'gray'].includes(operation.colorSpace)
      ) {
        return err('convert colorSpace must be srgb, linear, or gray');
      }
      if (operation.channels === undefined && operation.colorSpace === undefined) {
        return err('convert must specify channels and/or colorSpace');
      }
      return ok(undefined);
    default:
      return err('unknown operation');
  }
}

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInt(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
