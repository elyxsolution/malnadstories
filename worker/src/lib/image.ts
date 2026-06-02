import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import exifr from 'exifr';
import heicConvert from 'heic-convert';

/**
 * Permanent failure: the bytes aren't a real allowed image, or are an abusive
 * (decompression-bomb) size. The caller marks the photo 'rejected' and does NOT
 * retry — retrying a malformed file is pointless and a retry storm is its own risk.
 */
export class InvalidImageError extends Error {}

export type Processed = {
  full: Buffer; // sanitized full-res master — ORIGINAL resolution, JPEG ~q90
  thumb: Buffer; // ~400px JPEG thumbnail (the ONLY downscaled derivative)
  width: number;
  height: number;
  takenAt: Date | null;
};

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

// Decompression-bomb guard. We keep sharp's input pixel limit (never pass
// limitInputPixels:false) AND reject absurd dimensions up front so a crafted image
// can't OOM the worker. 100 MP / 30k px is generous for real travel photos.
const MAX_PIXELS = 100_000_000;
const MAX_DIM = 30_000;

/**
 * Validate → extract EXIF date → re-encode to a sanitized master + thumbnail.
 * Throws InvalidImageError for permanent problems (spoofed type, undecodable, bomb).
 * Any other throw (e.g. transient) bubbles up so pg-boss can retry.
 */
export async function hardenImage(raw: Buffer): Promise<Processed> {
  // 1. Magic-byte validation — never trust the upload's declared content-type.
  const ft = await fileTypeFromBuffer(raw);
  if (!ft || !ALLOWED_MIME.has(ft.mime)) {
    throw new InvalidImageError(`Unsupported or spoofed file type: ${ft?.mime ?? 'unknown'}`);
  }

  // 2. EXIF capture date (read from the ORIGINAL bytes — re-encoding strips it).
  let takenAt: Date | null = null;
  try {
    const exif = await exifr.parse(raw, { pick: ['DateTimeOriginal', 'CreateDate'] });
    const d = exif?.DateTimeOriginal ?? exif?.CreateDate ?? null;
    takenAt = d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  } catch {
    takenAt = null; // a missing/corrupt EXIF block is not a failure
  }

  // 3. HEIC/HEIF → JPEG first: sharp's prebuilt binaries don't reliably decode HEIC.
  let decodable = raw;
  if (ft.mime === 'image/heic' || ft.mime === 'image/heif') {
    try {
      // @types/heic-convert types buffer as ArrayBuffer; the lib accepts a Buffer
      // at runtime. Cast to satisfy the (overly strict) type.
      const out = await heicConvert({ buffer: raw as unknown as ArrayBuffer, format: 'JPEG', quality: 1 });
      decodable = Buffer.from(out);
    } catch (err) {
      throw new InvalidImageError(`HEIC decode failed: ${(err as Error).message}`);
    }
  }

  // 4. Dimension guard before any heavy decode work.
  let meta;
  try {
    meta = await sharp(decodable, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch (err) {
    throw new InvalidImageError(`Undecodable image: ${(err as Error).message}`);
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw new InvalidImageError('Could not read image dimensions');
  if (w > MAX_DIM || h > MAX_DIM || w * h > MAX_PIXELS) {
    throw new InvalidImageError(`Image dimensions too large: ${w}x${h}`);
  }

  // 5. Sanitized full-res MASTER: auto-orient per EXIF, strip all other metadata,
  //    KEEP original resolution (no resize), high-quality JPEG. This is the print
  //    master and the raw is deleted, so it must not lose resolution.
  const full = await sharp(decodable, { limitInputPixels: MAX_PIXELS })
    .rotate() // applies+clears EXIF orientation; sharp drops other metadata by default
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  const fullMeta = await sharp(full).metadata();

  // 6. Thumbnail — the only downscaled derivative.
  const thumb = await sharp(decodable, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  return { full, thumb, width: fullMeta.width ?? w, height: fullMeta.height ?? h, takenAt };
}
