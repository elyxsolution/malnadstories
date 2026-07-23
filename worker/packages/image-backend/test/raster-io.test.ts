import { describe, it, expect } from 'vitest';
import {
  encodeRaster,
  decodeRaster,
  isRasterContainer,
  decodeBmp,
  isBmp,
  validateRaster,
  createReferenceBackend,
  solidRaster,
  gradientRaster,
  BackendError,
} from '@workerv2/image-backend';
import type { RasterImage } from '@workerv2/image-backend';
import { buildBmp24, buildBmp32 } from './fixtures.js';

describe('WV2R container', () => {
  it('round-trips a raster to bytes and back (byte-exact)', () => {
    const image = gradientRaster(7, 5);
    const bytes = encodeRaster(image);
    expect(isRasterContainer(bytes)).toBe(true);
    const decoded = decodeRaster(bytes);
    expect(decoded).toStrictEqual(image);
  });

  it('encodes identical rasters to identical bytes (deterministic / content-addressable)', () => {
    const a = encodeRaster(gradientRaster(4, 4));
    const b = encodeRaster(gradientRaster(4, 4));
    expect(a).toStrictEqual(b);
  });

  it('preserves colour space + channels through the header', () => {
    const gray = solidRaster(2, 2, [128], 'gray');
    expect(decodeRaster(encodeRaster(gray))).toStrictEqual(gray);
    const rgba = solidRaster(2, 2, [1, 2, 3, 4], 'srgb');
    expect(decodeRaster(encodeRaster(rgba)).channels).toBe(4);
  });

  it('rejects a truncated / non-container buffer', () => {
    expect(() => decodeRaster(new Uint8Array([1, 2, 3]))).toThrow(BackendError);
    expect(isRasterContainer(new Uint8Array([0, 0, 0, 0]))).toBe(false);
  });

  it('rejects a header whose geometry mismatches the data length', () => {
    const bytes = encodeRaster(solidRaster(2, 2, [10, 20, 30]));
    const truncated = bytes.subarray(0, bytes.length - 3);
    expect(() => decodeRaster(truncated)).toThrow(/data length/);
  });
});

describe('BMP decode', () => {
  it('decodes a 24-bit BMP with BGR→RGB reorder and bottom-up rows', () => {
    // 2x2 image; top row red,green; bottom row blue,white.
    const bmp = buildBmp24(2, 2, [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
    ]);
    expect(isBmp(bmp)).toBe(true);
    const image = decodeBmp(bmp);
    expect(image).toMatchObject({ width: 2, height: 2, channels: 3, colorSpace: 'srgb' });
    expect(Array.from(image.data)).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  });

  it('decodes a 32-bit BMP preserving alpha', () => {
    const bmp = buildBmp32(1, 2, [
      [10, 20, 30, 40],
      [50, 60, 70, 80],
    ]);
    const image = decodeBmp(bmp);
    expect(image.channels).toBe(4);
    expect(Array.from(image.data)).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
  });

  it('is a real encoded format the backend can decode', () => {
    const backend = createReferenceBackend();
    const bmp = buildBmp24(1, 1, [[7, 8, 9]]);
    expect(backend.decode(bmp)).toMatchObject({ width: 1, height: 1, colorSpace: 'srgb' });
  });
});

describe('output validation', () => {
  const base = solidRaster(2, 2, [1, 2, 3]);

  it('accepts a consistent raster', () => {
    expect(validateRaster(base).ok).toBe(true);
  });

  it('rejects a data-length mismatch', () => {
    const bad: RasterImage = { ...base, data: new Uint8Array(5) };
    expect(validateRaster(bad).ok).toBe(false);
  });

  it('rejects an incompatible channel/colour-space pairing', () => {
    const bad: RasterImage = { ...base, colorSpace: 'gray' }; // 3 channels but gray
    expect(validateRaster(bad).ok).toBe(false);
  });

  it('enforces optional size limits', () => {
    expect(validateRaster(base, { maxPixels: 2 }).ok).toBe(false);
    expect(validateRaster(base, { maxWidth: 1 }).ok).toBe(false);
  });
});
