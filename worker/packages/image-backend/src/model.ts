// @workerv2/image-backend — the pixel MODEL. The in-memory raster representation the backend
// transforms, plus the small colour/format vocabulary. Everything here is DATA + plain math over
// bytes: no I/O, no album/render/PDF/product knowledge, no coordinator awareness. 8-bit per
// channel throughout (higher bit depths are a native-backend concern, reserved behind the same
// contracts).

/** The colour space a raster is encoded in. `gray` is single-channel; `srgb`/`linear` are RGB(A). */
export type ColorSpace = 'srgb' | 'linear' | 'gray';

export const COLOR_SPACES: readonly ColorSpace[] = ['srgb', 'linear', 'gray'];

/** The supported channel counts: 1 (gray), 3 (RGB), 4 (RGBA). */
export type Channels = 1 | 3 | 4;

export const BIT_DEPTH = 8;

/**
 * A decoded raster IMAGE — the currency every backend operation consumes and produces. `data` is a
 * tightly-packed, row-major `Uint8Array` of exactly `width * height * channels` bytes (no row
 * padding), so a raster's bytes are a deterministic function of its pixels alone.
 */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  readonly channels: Channels;
  readonly colorSpace: ColorSpace;
  readonly bitDepth: typeof BIT_DEPTH;
  readonly data: Uint8Array;
}

/** Whether a raster carries an alpha channel. */
export function hasAlpha(image: Pick<RasterImage, 'channels'>): boolean {
  return image.channels === 4;
}

/** The number of pixels a raster contains. */
export function pixelCount(image: Pick<RasterImage, 'width' | 'height'>): number {
  return image.width * image.height;
}

/** The exact byte length a raster's `data` must have for its dimensions + channels. */
export function expectedByteLength(
  image: Pick<RasterImage, 'width' | 'height' | 'channels'>,
): number {
  return image.width * image.height * image.channels;
}

// --- Descriptor (a JSON-safe, content-addressable summary of a produced raster) ---

export const RASTER_DESCRIPTOR_SCHEMA = 'workerv2.image-backend.raster/1';

/** Backend identity: pinned so a produced raster records which engine (+ version) made it. */
export interface BackendInfo {
  readonly id: string;
  readonly version: string;
  /** True when the backend guarantees byte-identical output across supported platforms. */
  readonly deterministic: boolean;
}

/** A JSON-safe summary of a raster Artifact — geometry, format, size, and provenance. */
export interface RasterDescriptor {
  readonly schema: typeof RASTER_DESCRIPTOR_SCHEMA;
  readonly width: number;
  readonly height: number;
  readonly channels: Channels;
  readonly colorSpace: ColorSpace;
  readonly bitDepth: number;
  readonly byteLength: number;
  readonly backend: BackendInfo;
}
