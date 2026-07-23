// @workerv2/image-processors — shared MODEL. The deterministic, JSON-safe descriptor shapes the
// six image foundation processors read and produce, plus the small vocabulary (formats,
// orientation, colour) they agree on. Everything here is DATA: no I/O, no rendering, no album
// knowledge. Each descriptor is content-addressable because it is serialized canonically before
// it becomes an Artifact (see `descriptor.ts`).

/**
 * The version of the image foundation engine. Frozen per the version-freezing discipline (INV-11):
 * every produced descriptor stamps it, and every processor descriptor uses it as its
 * implementation version, so a run can pin exactly which image engine produced its outputs.
 */
export const IMAGE_ENGINE_VERSION = '1.0.0';

/** The raster container formats the foundation processors recognize (by magic bytes). */
export type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp' | 'tiff' | 'heic';

export const IMAGE_FORMATS: readonly ImageFormat[] = [
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tiff',
  'heic',
];

/** The canonical IANA content type for each recognized format. */
export const FORMAT_CONTENT_TYPES: Readonly<Record<ImageFormat, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  heic: 'image/heic',
};

/** A storage-neutral classification of an image's pixel layout. */
export type ColorType =
  'grayscale' | 'grayscale-alpha' | 'rgb' | 'rgba' | 'palette' | 'ycbcr' | 'cmyk' | 'unknown';

/** EXIF orientation codes 1..8 (the eight legal camera orientations). */
export type OrientationCode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** ICC colour-profile presence (name kept only when the container declares one). */
export interface IccInfo {
  readonly present: boolean;
  readonly name?: string;
}

// --- Decoded image (structural decode of the container: geometry + pixel format) ---

export const DECODED_SCHEMA = 'workerv2.image.decoded/1';

/**
 * The DECODED IMAGE descriptor — the deterministic structural decode of an encoded container:
 * intrinsic geometry and pixel-format facts (dimensions, bit depth, channel layout, colour type,
 * alpha, ICC presence). It is NOT a pixel buffer; a full pixel decode is a native backend
 * deferred behind the same processor contract. This is what downstream normalization reasons over.
 */
export interface DecodedImage {
  readonly schema: typeof DECODED_SCHEMA;
  readonly engineVersion: string;
  readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly channels: number;
  readonly hasAlpha: boolean;
  readonly colorType: ColorType;
  readonly icc: IccInfo;
  readonly byteLength: number;
}

// --- Embedded metadata (EXIF + ancillary the file declares about itself) ---

export const METADATA_SCHEMA = 'workerv2.image.metadata/1';

/** The EXIF facts the metadata extractor surfaces (all optional; absent unless present). */
export interface ExifData {
  readonly orientation?: OrientationCode;
  readonly dateTimeOriginal?: string;
  readonly make?: string;
  readonly model?: string;
}

/**
 * The IMAGE METADATA descriptor — the metadata the file declares about itself (format, byte size,
 * intrinsic dimensions if the header exposes them, and EXIF camera/orientation/capture facts).
 * Distinct from `DecodedImage`: decode = pixel facts of the raster; metadata = what the file says.
 */
export interface ImageMetadata {
  readonly schema: typeof METADATA_SCHEMA;
  readonly engineVersion: string;
  readonly format: ImageFormat;
  readonly byteLength: number;
  readonly dimensions: { readonly width: number; readonly height: number } | null;
  readonly hasExif: boolean;
  readonly exif: ExifData;
}

// --- Orientation normalization ---

export const ORIENTED_SCHEMA = 'workerv2.image.oriented/1';

/** The geometric transform that maps a stored orientation onto the display (identity) orientation. */
export interface OrientationTransform {
  readonly rotate: 0 | 90 | 180 | 270;
  readonly flipHorizontal: boolean;
}

/**
 * The ORIENTED IMAGE descriptor — the correction that maps the source EXIF orientation onto the
 * canonical display orientation (1), the resulting (possibly axis-swapped) dimensions, and the
 * transform a later pixel backend would apply. Pure geometry; no pixels are moved here.
 */
export interface OrientedImage {
  readonly schema: typeof ORIENTED_SCHEMA;
  readonly engineVersion: string;
  readonly sourceOrientation: OrientationCode;
  readonly appliedTransform: OrientationTransform;
  readonly swapsDimensions: boolean;
  readonly width: number;
  readonly height: number;
  readonly normalizedOrientation: 1;
}

// --- Colour-profile normalization ---

export const COLOR_SCHEMA = 'workerv2.image.color/1';

export type TargetColorSpace = 'srgb';

/**
 * The NORMALIZED COLOUR descriptor — the plan to bring a raster into the canonical working colour
 * space (sRGB) with a canonical channel layout, and whether a conversion is actually required.
 */
export interface NormalizedColor {
  readonly schema: typeof COLOR_SCHEMA;
  readonly engineVersion: string;
  readonly sourceColorType: ColorType;
  readonly sourceChannels: number;
  readonly sourceHasAlpha: boolean;
  readonly sourceIcc: IccInfo;
  readonly targetColorSpace: TargetColorSpace;
  readonly targetChannels: 3 | 4;
  readonly requiresConversion: boolean;
}

// --- Format normalization ---

export const FORMAT_SCHEMA = 'workerv2.image.format/1';

/** The canonical delivery formats the foundation normalizes toward. */
export type TargetFormat = 'jpeg' | 'png';

/**
 * The NORMALIZED FORMAT descriptor — the canonical container the raster should be delivered in and
 * whether a transcode is required to get there. Alpha-bearing sources normalize to PNG (lossless,
 * alpha-preserving); everything else to JPEG. The decision is deterministic; transcoding itself is
 * a deferred native backend behind the same processor contract.
 */
export interface NormalizedFormat {
  readonly schema: typeof FORMAT_SCHEMA;
  readonly engineVersion: string;
  readonly sourceFormat: ImageFormat;
  readonly targetFormat: TargetFormat;
  readonly requiresTranscode: boolean;
  readonly contentType: string;
}

// --- Validation report ---

export const VALIDATION_SCHEMA = 'workerv2.image.validation/1';

/**
 * The VALIDATION REPORT descriptor — the record a successful validation produces: the accepted
 * format, geometry, byte size, and pixel count (the decompression-bomb dimension the guard checked).
 * A failed validation is a `permanent` processor failure, not a report — invalid input cannot be
 * fixed by a retry.
 */
export interface ValidationReport {
  readonly schema: typeof VALIDATION_SCHEMA;
  readonly engineVersion: string;
  readonly ok: true;
  readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly byteLength: number;
}
