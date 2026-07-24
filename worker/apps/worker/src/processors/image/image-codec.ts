/**
 * THE IMAGE CODEC PORT — the narrow, injectable seam between the pipeline STAGES (pure orchestration:
 * validate → decode → orient → measure → normalize → encode) and the concrete image backend (sharp +
 * file-type + exifr + heic-convert). Stages depend only on this interface, so they are unit-tested with
 * a fake codec — no native binary, deterministic, fast — while the real `SharpImageCodec` is the single
 * place the heavy dependencies live.
 *
 * This is the deliberate placement decision: image DECODING/ENCODING is infrastructure (native, I/O-ish,
 * non-deterministic across platforms), so it must NOT live in the pure `packages/` runtime. It belongs
 * behind a port in the processor layer — exactly like the queue/storage/database adapters of Phase I-0.
 */

/** A decoded, auto-oriented raster (raw interleaved pixels + geometry) — the pipeline's canonical intermediate. */
export interface Raster {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
}

export interface JpegOptions {
  /** JPEG quality 1..100. */
  readonly quality: number;
}

export interface ImageCodec {
  /** Magic-byte MIME detection (never trust the client-declared content-type). `null` when unrecognized. */
  detectMime(bytes: Uint8Array): Promise<string | null>;
  /** Decode HEIC/HEIF to a JPEG buffer (sharp's prebuilt binaries don't reliably decode HEIC). */
  heicToJpeg(bytes: Uint8Array): Promise<Uint8Array>;
  /** Read the EXIF capture date from the ORIGINAL bytes (re-encoding strips it). `null` when absent. */
  readCaptureDate(bytes: Uint8Array): Promise<Date | null>;
  /** Cheap, header-only dimension probe (no full decode) — the decompression-bomb pre-check. */
  probeDimensions(bytes: Uint8Array): Promise<{ width: number; height: number }>;
  /** Decode ONCE into an auto-oriented, sRGB, alpha-flattened raster (the single decode all encodes share). */
  decodeOriented(bytes: Uint8Array): Promise<Raster>;
  /** Encode a raster to JPEG at original resolution (the sanitized print master). */
  encodeJpeg(raster: Raster, options: JpegOptions): Promise<Uint8Array>;
  /** Encode a downscaled JPEG thumbnail (longest edge ≤ `maxEdge`, never upscaled). */
  encodeThumbnail(raster: Raster, maxEdge: number, options: JpegOptions): Promise<Uint8Array>;
}

/** Allowed source MIME types (magic-byte validated). */
export const ALLOWED_MIME: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

/** MIME types that must be transcoded to JPEG before sharp can decode them. */
export const HEIC_MIME: ReadonlySet<string> = new Set(['image/heic', 'image/heif']);

/** Decompression-bomb guards — kept generous for real travel photos, strict against crafted inputs. */
export const MAX_PIXELS = 100_000_000; // 100 MP
export const MAX_DIMENSION = 30_000; // px on either edge
/** Defensive byte ceiling (the upload presign already caps at 20 MB; this is belt-and-braces). */
export const MAX_BYTES = 30 * 1024 * 1024;

/** JPEG quality for the sanitized full-resolution master (the print master — high quality, no downscale). */
export const MASTER_QUALITY = 90;
/** JPEG quality + longest-edge for the thumbnail (the only downscaled derivative). */
export const THUMBNAIL_QUALITY = 80;
export const THUMBNAIL_MAX_EDGE = 400;
