// @workerv2/image-processors — the Image Foundation Processors. The first CONCRETE processors,
// built with the Processor SDK, that perform GENERIC image normalization + metadata extraction
// while staying independent of album rendering. Six single-transformation processors that consume
// and produce immutable, content-addressed Artifacts, deterministically and cross-platform:
//
//   image.validate            raw bytes → validation report (format/decodability/size/bomb guard)
//   image.decode              raw bytes → structural DecodedImage (geometry + pixel format)
//   image.metadata            raw bytes → ImageMetadata (format + dimensions + EXIF)
//   image.exif-orientation    decoded + metadata → OrientedImage (orientation correction)
//   image.color-normalize     decoded → NormalizedColor (sRGB target plan)
//   image.format-normalize    decoded → NormalizedFormat (canonical container decision)
//
// Pure TypeScript container parsing — NO native codec, NO storage/R2 implementation, NO album
// knowledge, NO page composition, NO PDF, NO layout. Heavy pixel transcoding is a native backend
// deferred behind the SAME processor contract.

import { createProcessor } from '@workerv2/processor-sdk';
import type { ProcessorDependencies, ProcessorSpec } from '@workerv2/processor-sdk';
import type { Processor } from '@workerv2/processing';

// --- Model (descriptor shapes + vocabulary) ---
export type {
  ImageFormat,
  ColorType,
  OrientationCode,
  IccInfo,
  DecodedImage,
  ExifData,
  ImageMetadata,
  OrientationTransform,
  OrientedImage,
  TargetColorSpace,
  NormalizedColor,
  TargetFormat,
  NormalizedFormat,
  ValidationReport,
} from './model.js';
export {
  IMAGE_ENGINE_VERSION,
  IMAGE_FORMATS,
  FORMAT_CONTENT_TYPES,
  DECODED_SCHEMA,
  METADATA_SCHEMA,
  ORIENTED_SCHEMA,
  COLOR_SCHEMA,
  FORMAT_SCHEMA,
  VALIDATION_SCHEMA,
} from './model.js';

// --- Pure library (reusable, deterministic parsers + math) ---
export { detectFormat } from './lib/format.js';
export { decodeImage } from './lib/decode.js';
export { extractMetadata } from './lib/metadata.js';
export { parseExif } from './lib/exif.js';
export { normalizeOrientation, orientationCorrection } from './lib/orientation.js';
export { DEFAULT_LIMITS, parseValidationConfig, parseFormatConfig } from './lib/config.js';
export type { ValidationLimits, FormatOptions } from './lib/config.js';

// --- Processor specs + per-processor factories ---
export { imageValidationSpec, createImageValidationProcessor } from './processors/validate.js';
export { imageDecodeSpec, createImageDecodeProcessor } from './processors/decode.js';
export { imageMetadataSpec, createImageMetadataProcessor } from './processors/metadata.js';
export {
  imageExifOrientationSpec,
  createImageExifOrientationProcessor,
} from './processors/exif-orientation.js';
export {
  imageColorNormalizeSpec,
  createImageColorNormalizeProcessor,
} from './processors/color-normalize.js';
export {
  imageFormatNormalizeSpec,
  createImageFormatNormalizeProcessor,
} from './processors/format-normalize.js';
export { SLOT } from './processors/common.js';

import { imageValidationSpec } from './processors/validate.js';
import { imageDecodeSpec } from './processors/decode.js';
import { imageMetadataSpec } from './processors/metadata.js';
import { imageExifOrientationSpec } from './processors/exif-orientation.js';
import { imageColorNormalizeSpec } from './processors/color-normalize.js';
import { imageFormatNormalizeSpec } from './processors/format-normalize.js';

/** Every image-foundation processor spec, in dependency order (validate → decode/metadata → …). */
export const imageFoundationProcessorSpecs: readonly ProcessorSpec[] = [
  imageValidationSpec,
  imageDecodeSpec,
  imageMetadataSpec,
  imageExifOrientationSpec,
  imageColorNormalizeSpec,
  imageFormatNormalizeSpec,
];

/**
 * Build every image-foundation `Processor` wired to one host's dependencies — the registration
 * surface a host hands to the execution adapter's `ProcessorResolver`.
 */
export function createImageFoundationProcessors(deps: ProcessorDependencies): readonly Processor[] {
  return imageFoundationProcessorSpecs.map((spec) => createProcessor(spec, deps));
}
