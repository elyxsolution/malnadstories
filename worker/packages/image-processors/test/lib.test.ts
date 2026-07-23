import { describe, it, expect } from 'vitest';
import {
  detectFormat,
  decodeImage,
  extractMetadata,
  parseExif,
  normalizeOrientation,
  orientationCorrection,
} from '@workerv2/image-processors';
import type { OrientationCode } from '@workerv2/image-processors';
import {
  buildPng,
  buildJpeg,
  buildGif,
  buildBmp,
  buildWebpLossless,
  buildWebpExtended,
  buildTiffImage,
} from './fixtures.js';

describe('detectFormat', () => {
  it('recognizes each format by magic bytes', () => {
    expect(detectFormat(buildPng({ width: 2, height: 2 }))).toBe('png');
    expect(detectFormat(buildJpeg({ width: 2, height: 2 }))).toBe('jpeg');
    expect(detectFormat(buildGif(2, 2))).toBe('gif');
    expect(detectFormat(buildBmp(2, 2))).toBe('bmp');
    expect(detectFormat(buildWebpLossless(2, 2))).toBe('webp');
    expect(detectFormat(buildTiffImage(2, 2))).toBe('tiff');
  });

  it('returns null for unrecognized bytes', () => {
    expect(detectFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(detectFormat(new Uint8Array([]))).toBeNull();
  });
});

describe('decodeImage — geometry + pixel format', () => {
  it('decodes PNG dimensions + colour type', () => {
    const d = decodeImage(buildPng({ width: 640, height: 480, colorType: 6 }));
    expect(d).not.toBeNull();
    expect(d).toMatchObject({
      format: 'png',
      width: 640,
      height: 480,
      colorType: 'rgba',
      channels: 4,
      hasAlpha: true,
      bitDepth: 8,
    });
  });

  it('maps every PNG colour type', () => {
    expect(decodeImage(buildPng({ width: 1, height: 1, colorType: 0 }))?.colorType).toBe(
      'grayscale',
    );
    expect(decodeImage(buildPng({ width: 1, height: 1, colorType: 2 }))?.colorType).toBe('rgb');
    expect(decodeImage(buildPng({ width: 1, height: 1, colorType: 3 }))?.colorType).toBe('palette');
    expect(decodeImage(buildPng({ width: 1, height: 1, colorType: 4 }))?.colorType).toBe(
      'grayscale-alpha',
    );
  });

  it('decodes JPEG dimensions + component-derived colour', () => {
    expect(decodeImage(buildJpeg({ width: 800, height: 600, components: 3 }))).toMatchObject({
      format: 'jpeg',
      width: 800,
      height: 600,
      colorType: 'ycbcr',
    });
    expect(decodeImage(buildJpeg({ width: 4, height: 4, components: 1 }))?.colorType).toBe(
      'grayscale',
    );
    expect(decodeImage(buildJpeg({ width: 4, height: 4, components: 4 }))?.colorType).toBe('cmyk');
  });

  it('decodes GIF / BMP / TIFF / WebP dimensions', () => {
    expect(decodeImage(buildGif(320, 240))).toMatchObject({
      format: 'gif',
      width: 320,
      height: 240,
    });
    expect(decodeImage(buildBmp(100, 50, 32))).toMatchObject({
      format: 'bmp',
      width: 100,
      height: 50,
      hasAlpha: true,
    });
    expect(decodeImage(buildTiffImage(120, 90))).toMatchObject({
      format: 'tiff',
      width: 120,
      height: 90,
    });
    expect(decodeImage(buildWebpLossless(70, 40, true))).toMatchObject({
      format: 'webp',
      width: 70,
      height: 40,
      hasAlpha: true,
    });
    expect(decodeImage(buildWebpExtended(2000, 1000, false))).toMatchObject({
      format: 'webp',
      width: 2000,
      height: 1000,
    });
  });

  it('detects an ICC profile in PNG (iCCP) and JPEG (APP2)', () => {
    expect(decodeImage(buildPng({ width: 2, height: 2, icc: 'sRGB IEC61966-2.1' }))?.icc).toEqual({
      present: true,
      name: 'sRGB IEC61966-2.1',
    });
    expect(decodeImage(buildJpeg({ width: 2, height: 2, icc: true }))?.icc.present).toBe(true);
    expect(decodeImage(buildPng({ width: 2, height: 2 }))?.icc.present).toBe(false);
  });

  it('returns null for undecodable / zero-dimension input', () => {
    expect(decodeImage(new Uint8Array([0, 1, 2, 3]))).toBeNull();
    expect(decodeImage(buildPng({ width: 0, height: 10 }))).toBeNull();
  });
});

describe('parseExif', () => {
  it('reads orientation from a JPEG APP1 block', () => {
    for (let o = 1 as OrientationCode; o <= 8; o = (o + 1) as OrientationCode) {
      const jpeg = buildJpeg({ width: 4, height: 4, exif: { orientation: o } });
      expect(parseExif(jpeg, 'jpeg').orientation).toBe(o);
    }
  });

  it('reads make/model (IFD0) and dateTimeOriginal (Exif SubIFD)', () => {
    const jpeg = buildJpeg({
      width: 4,
      height: 4,
      exif: {
        orientation: 3,
        make: 'Canon',
        model: 'EOS',
        dateTimeOriginal: '2026:07:24 10:00:00',
      },
    });
    expect(parseExif(jpeg, 'jpeg')).toEqual({
      orientation: 3,
      make: 'Canon',
      model: 'EOS',
      dateTimeOriginal: '2026:07:24 10:00:00',
    });
  });

  it('reads EXIF from a standalone TIFF and returns {} when absent', () => {
    expect(parseExif(buildTiffImage(4, 4, { orientation: 8 }), 'tiff').orientation).toBe(8);
    expect(parseExif(buildJpeg({ width: 4, height: 4 }), 'jpeg')).toEqual({});
  });

  it('never throws on garbage EXIF bytes', () => {
    expect(
      parseExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 1, 2, 3, 4]), 'jpeg'),
    ).toEqual({});
  });
});

describe('metadata extraction', () => {
  it('surfaces format, dimensions, and EXIF together', () => {
    const jpeg = buildJpeg({ width: 12, height: 8, exif: { orientation: 6, make: 'Fuji' } });
    const meta = extractMetadata(jpeg);
    expect(meta).toMatchObject({
      format: 'jpeg',
      dimensions: { width: 12, height: 8 },
      hasExif: true,
      exif: { orientation: 6, make: 'Fuji' },
    });
  });

  it('reports no EXIF for a PNG', () => {
    const meta = extractMetadata(buildPng({ width: 3, height: 3 }));
    expect(meta?.hasExif).toBe(false);
    expect(meta?.exif).toEqual({});
  });
});

describe('orientation math', () => {
  it('swaps dimensions for the 90/270 orientations only', () => {
    expect(normalizeOrientation(1, 100, 200)).toMatchObject({
      width: 100,
      height: 200,
      swapsDimensions: false,
    });
    expect(normalizeOrientation(6, 100, 200)).toMatchObject({
      width: 200,
      height: 100,
      swapsDimensions: true,
      appliedTransform: { rotate: 90, flipHorizontal: false },
    });
    expect(normalizeOrientation(8, 100, 200).appliedTransform).toEqual({
      rotate: 270,
      flipHorizontal: false,
    });
    expect(normalizeOrientation(2, 10, 20).appliedTransform).toEqual({
      rotate: 0,
      flipHorizontal: true,
    });
  });

  it('always normalizes to orientation 1', () => {
    for (let o = 1 as OrientationCode; o <= 8; o = (o + 1) as OrientationCode) {
      expect(normalizeOrientation(o, 5, 7).normalizedOrientation).toBe(1);
    }
  });

  it('exposes the correction transform', () => {
    expect(orientationCorrection(3)).toEqual({
      transform: { rotate: 180, flipHorizontal: false },
      swaps: false,
    });
  });
});
