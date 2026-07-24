import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import exifr from 'exifr';
import heicConvert from 'heic-convert';
import type { ImageCodec, JpegOptions, Raster } from './image-codec.js';
import { MAX_PIXELS } from './image-codec.js';

/**
 * THE SHARP IMAGE CODEC — the single concrete `ImageCodec`, and the ONLY module that imports the native
 * image stack (sharp + file-type + exifr + heic-convert). It is loaded lazily (only when infrastructure
 * is enabled), so the default self-contained worker never pulls in the native binary.
 *
 * `decodeOriented` is the performance keystone: it decodes the input EXACTLY ONCE into an auto-oriented,
 * sRGB, alpha-flattened raster; the master and thumbnail encodes then reuse that raster, so a photo is
 * never decoded twice. `limitInputPixels` stays enabled throughout (decompression-bomb defense is never
 * disabled).
 */
export class SharpImageCodec implements ImageCodec {
  async detectMime(bytes: Uint8Array): Promise<string | null> {
    const ft = await fileTypeFromBuffer(bytes);
    return ft?.mime ?? null;
  }

  async heicToJpeg(bytes: Uint8Array): Promise<Uint8Array> {
    // @types/heic-convert types the buffer as ArrayBuffer; the lib accepts a Uint8Array at runtime.
    const out = await heicConvert({
      buffer: bytes as unknown as ArrayBuffer,
      format: 'JPEG',
      quality: 1,
    });
    return new Uint8Array(out);
  }

  async readCaptureDate(bytes: Uint8Array): Promise<Date | null> {
    try {
      const exif = (await exifr.parse(bytes, { pick: ['DateTimeOriginal', 'CreateDate'] })) as
        { DateTimeOriginal?: unknown; CreateDate?: unknown } | undefined;
      const raw = exif?.DateTimeOriginal ?? exif?.CreateDate ?? null;
      return raw instanceof Date && !Number.isNaN(raw.getTime()) ? raw : null;
    } catch {
      // A missing or corrupt EXIF block is not a failure — capture date is optional.
      return null;
    }
  }

  async probeDimensions(bytes: Uint8Array): Promise<{ width: number; height: number }> {
    const meta = await sharp(Buffer.from(bytes), { limitInputPixels: MAX_PIXELS }).metadata();
    return { width: meta.width ?? 0, height: meta.height ?? 0 };
  }

  async decodeOriented(bytes: Uint8Array): Promise<Raster> {
    const { data, info } = await sharp(Buffer.from(bytes), { limitInputPixels: MAX_PIXELS })
      .rotate() // apply + clear EXIF orientation
      .flatten({ background: '#ffffff' }) // composite any alpha onto white (JPEG has no alpha)
      .toColourspace('srgb') // normalize colourspace
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      data: new Uint8Array(data),
      width: info.width,
      height: info.height,
      channels: info.channels,
    };
  }

  async encodeJpeg(raster: Raster, options: JpegOptions): Promise<Uint8Array> {
    const out = await sharp(Buffer.from(raster.data), { raw: rawInfo(raster) })
      .jpeg({ quality: options.quality, mozjpeg: true })
      .toBuffer();
    return new Uint8Array(out);
  }

  async encodeThumbnail(
    raster: Raster,
    maxEdge: number,
    options: JpegOptions,
  ): Promise<Uint8Array> {
    const out = await sharp(Buffer.from(raster.data), { raw: rawInfo(raster) })
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: options.quality, mozjpeg: true })
      .toBuffer();
    return new Uint8Array(out);
  }
}

function rawInfo(raster: Raster): { width: number; height: number; channels: 1 | 2 | 3 | 4 } {
  return { width: raster.width, height: raster.height, channels: raster.channels as 1 | 2 | 3 | 4 };
}

/** Construct the production image codec. */
export function createSharpImageCodec(): ImageCodec {
  return new SharpImageCodec();
}
