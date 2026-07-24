import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { createSharpImageCodec } from '../src/processors/image/sharp-image-codec.js';

/**
 * Integration test of the REAL image backend (sharp + file-type). It generates fixtures with sharp,
 * then exercises the codec end to end — proving actual decode/encode/orient/measure/thumbnail behavior
 * on this platform. (HEIC decode is delegated to heic-convert and covered via the branch in the pipeline
 * test; generating a real HEIC fixture requires a HEIF encoder not present in the prebuilt sharp.)
 */

const codec = createSharpImageCodec();

async function jpeg(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 60, b: 30 } },
  })
    .jpeg()
    .toBuffer();
  return new Uint8Array(buf);
}

describe('SharpImageCodec (real sharp)', () => {
  it('detects MIME from magic bytes (jpeg + png)', async () => {
    const png = new Uint8Array(
      await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
        .png()
        .toBuffer(),
    );
    expect(await codec.detectMime(await jpeg(8, 8))).toBe('image/jpeg');
    expect(await codec.detectMime(png)).toBe('image/png');
    expect(await codec.detectMime(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  });

  it('probes dimensions without a full decode', async () => {
    expect(await codec.probeDimensions(await jpeg(24, 16))).toEqual({ width: 24, height: 16 });
  });

  it('throws on undecodable bytes (mapped to a permanent rejection upstream)', async () => {
    await expect(codec.probeDimensions(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow();
  });

  it('decodes to an oriented, 3-channel raster and flattens alpha', async () => {
    const rgba = new Uint8Array(
      await sharp({
        create: { width: 10, height: 6, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .png()
        .toBuffer(),
    );
    const raster = await codec.decodeOriented(rgba);
    expect(raster.width).toBe(10);
    expect(raster.height).toBe(6);
    expect(raster.channels).toBe(3); // alpha flattened away
    expect(raster.data.byteLength).toBe(10 * 6 * 3);
  });

  it('encodes a full-resolution JPEG master from a raster', async () => {
    const raster = await codec.decodeOriented(await jpeg(32, 20));
    const master = await codec.encodeJpeg(raster, { quality: 90 });
    expect(master[0]).toBe(0xff); // JPEG SOI
    expect(master[1]).toBe(0xd8);
    const meta = await sharp(Buffer.from(master)).metadata();
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(20);
  });

  it('encodes a downscaled thumbnail bounded by the longest edge', async () => {
    const raster = await codec.decodeOriented(await jpeg(40, 20));
    const thumb = await codec.encodeThumbnail(raster, 8, { quality: 80 });
    const meta = await sharp(Buffer.from(thumb)).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(8);
    expect(meta.width).toBe(8); // 40:20 → 8:4
    expect(meta.height).toBe(4);
  });

  it('returns null capture date when there is no EXIF block', async () => {
    expect(await codec.readCaptureDate(await jpeg(8, 8))).toBeNull();
  });
});
