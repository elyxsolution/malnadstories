import type { ImageContext, ImageStage, StageDeps } from './image-context.js';
import { PermanentImageError, TransientImageError } from './errors.js';
import { derivedKeys } from './keys.js';
import {
  ALLOWED_MIME,
  HEIC_MIME,
  MASTER_QUALITY,
  MAX_BYTES,
  MAX_DIMENSION,
  MAX_PIXELS,
  THUMBNAIL_MAX_EDGE,
  THUMBNAIL_QUALITY,
} from './image-codec.js';

/**
 * THE IMAGE PIPELINE STAGES — nine small, independent, individually-testable steps. Each receives a
 * context and returns an augmented one; none holds hidden state. They compose the V1 behavior (validate →
 * decode → orient → measure → normalize → encode master + thumb → persist → finalize) into discrete,
 * reorderable/insertable units, while the single expensive DECODE happens exactly once (in `NormalizeStage`)
 * and both encodes reuse its raster.
 *
 * Orientation + colourspace/alpha normalization are intrinsic to that one decode, so they live together in
 * `NormalizeStage` rather than as separate re-decoding steps — the cleaner placement (explained in the ADR).
 */

// --- 1. Load: fetch the raw upload from R2 ---
export class LoadStage implements ImageStage {
  readonly name = 'loading' as const;
  async run(ctx: ImageContext, deps: StageDeps): Promise<ImageContext> {
    const bytes = await deps.objectStore.read(ctx.rawKey);
    if (bytes === null) {
      // The row exists but the object is not readable yet (or transiently gone) — retry, don't reject.
      throw new TransientImageError(`raw object not readable: ${ctx.rawKey}`);
    }
    return { ...ctx, rawBytes: bytes };
  }
}

// --- 2. Validate: size + magic-byte format (never trust the declared content-type) ---
export class ValidateStage implements ImageStage {
  readonly name = 'validating' as const;
  async run(ctx: ImageContext, deps: StageDeps): Promise<ImageContext> {
    const raw = required(ctx.rawBytes, 'rawBytes');
    if (raw.byteLength === 0) throw new PermanentImageError('empty file');
    if (raw.byteLength > MAX_BYTES)
      throw new PermanentImageError(`file too large: ${raw.byteLength} bytes`);
    const mime = await deps.codec.detectMime(raw);
    if (mime === null || !ALLOWED_MIME.has(mime)) {
      throw new PermanentImageError(`unsupported or spoofed file type: ${mime ?? 'unknown'}`);
    }
    return { ...ctx, mime };
  }
}

// --- 3. Decode: transcode HEIC/HEIF to JPEG (sharp cannot decode them); else pass through ---
export class DecodeStage implements ImageStage {
  readonly name = 'decoding' as const;
  async run(ctx: ImageContext, deps: StageDeps): Promise<ImageContext> {
    const raw = required(ctx.rawBytes, 'rawBytes');
    const mime = required(ctx.mime, 'mime');
    if (!HEIC_MIME.has(mime)) return { ...ctx, decodable: raw };
    try {
      return { ...ctx, decodable: await deps.codec.heicToJpeg(raw) };
    } catch (error) {
      throw new PermanentImageError(`HEIC decode failed: ${message(error)}`);
    }
  }
}

// --- 4. Metadata: EXIF capture date (from ORIGINAL bytes) + decompression-bomb pre-check ---
export class MetadataStage implements ImageStage {
  readonly name = 'metadata' as const;
  async run(ctx: ImageContext, deps: StageDeps): Promise<ImageContext> {
    const raw = required(ctx.rawBytes, 'rawBytes');
    const decodable = required(ctx.decodable, 'decodable');
    const takenAt = await deps.codec.readCaptureDate(raw);
    let dims: { width: number; height: number };
    try {
      dims = await deps.codec.probeDimensions(decodable);
    } catch (error) {
      throw new PermanentImageError(`undecodable image: ${message(error)}`);
    }
    guardDimensions(dims.width, dims.height);
    return { ...ctx, takenAt };
  }
}

// --- 5. Normalize: THE single decode → auto-oriented, sRGB, alpha-flattened raster ---
export class NormalizeStage implements ImageStage {
  readonly name = 'normalizing' as const;
  async run(ctx: ImageContext, deps: StageDeps): Promise<ImageContext> {
    const decodable = required(ctx.decodable, 'decodable');
    let raster;
    try {
      raster = await deps.codec.decodeOriented(decodable);
    } catch (error) {
      throw new PermanentImageError(`decode failed: ${message(error)}`);
    }
    guardDimensions(raster.width, raster.height); // post-orient dims are authoritative
    return { ...ctx, raster, width: raster.width, height: raster.height };
  }
}

// --- 6. Resize (production master): original resolution, high-quality JPEG ---
export class MasterStage implements ImageStage {
  readonly name = 'resizing' as const;
  async run(ctx: ImageContext, deps: StageDeps): Promise<ImageContext> {
    const raster = required(ctx.raster, 'raster');
    const masterBytes = await deps.codec.encodeJpeg(raster, { quality: MASTER_QUALITY });
    return { ...ctx, masterBytes };
  }
}

// --- 7. Thumbnail: the only downscaled derivative ---
export class ThumbnailStage implements ImageStage {
  readonly name = 'thumbnail' as const;
  async run(ctx: ImageContext, deps: StageDeps): Promise<ImageContext> {
    const raster = required(ctx.raster, 'raster');
    const thumbBytes = await deps.codec.encodeThumbnail(raster, THUMBNAIL_MAX_EDGE, {
      quality: THUMBNAIL_QUALITY,
    });
    return { ...ctx, thumbBytes };
  }
}

// --- 8. Persist: upload both derivatives under DETERMINISTIC keys (overwrite-safe = idempotent) ---
export class PersistStage implements ImageStage {
  readonly name = 'persisting' as const;
  async run(ctx: ImageContext, deps: StageDeps): Promise<ImageContext> {
    const masterBytes = required(ctx.masterBytes, 'masterBytes');
    const thumbBytes = required(ctx.thumbBytes, 'thumbBytes');
    const { sanitizedKey, thumbKey } = derivedKeys(ctx.rawKey);
    await deps.objectStore.write(sanitizedKey, masterBytes, { contentType: 'image/jpeg' });
    await deps.objectStore.write(thumbKey, thumbBytes, { contentType: 'image/jpeg' });
    return { ...ctx, sanitizedKey, thumbKey };
  }
}

// --- 9. Finalize: mark ready, THEN delete the raw + clear its key (crash-safe ordering) ---
export class FinalizeStage implements ImageStage {
  readonly name = 'finalizing' as const;
  async run(ctx: ImageContext, deps: StageDeps): Promise<ImageContext> {
    const sanitizedKey = required(ctx.sanitizedKey, 'sanitizedKey');
    const thumbKey = required(ctx.thumbKey, 'thumbKey');
    const width = required(ctx.width, 'width');
    const height = required(ctx.height, 'height');

    // Point the row at the derivatives FIRST (keeping r2_key), so "ready" never precedes the outputs.
    await deps.photos.markReady(ctx.photoId, {
      sanitizedKey,
      thumbKey,
      width,
      height,
      takenAt: ctx.takenAt ?? null,
    });

    // Then remove the raw and clear its key — BEST-EFFORT. The photo is already usable; if cleanup
    // fails (or the worker crashes here), the row is left `ready` with `r2_key` set, and the Recovery
    // Coordinator's `orphan-raw` sweep finishes it. So a cleanup blip never fails an otherwise-done job.
    try {
      await deps.objectStore.delete(ctx.rawKey);
      await deps.photos.clearRawKey(ctx.photoId);
    } catch (error) {
      deps.logger.log({
        level: 'warning',
        message: 'image.raw_cleanup_deferred',
        detail: {
          photoId: ctx.photoId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
    return ctx;
  }
}

/** The default, ordered image pipeline. New stages are inserted here without touching the runtime. */
export function defaultImageStages(): readonly ImageStage[] {
  return [
    new LoadStage(),
    new ValidateStage(),
    new DecodeStage(),
    new MetadataStage(),
    new NormalizeStage(),
    new MasterStage(),
    new ThumbnailStage(),
    new PersistStage(),
    new FinalizeStage(),
  ];
}

function guardDimensions(width: number, height: number): void {
  if (width <= 0 || height <= 0) throw new PermanentImageError('could not read image dimensions');
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new PermanentImageError(`image dimensions too large: ${width}x${height}`);
  }
}

function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    // A missing precondition means stages ran out of order — a composition bug, not input data.
    throw new Error(`image pipeline invariant violated: "${field}" missing`);
  }
  return value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
