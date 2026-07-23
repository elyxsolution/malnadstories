import { describe, it, expect } from 'vitest';
import { createReferenceBackend, solidRaster, makeRaster } from '@workerv2/image-backend';
import { fitRaster, toRgba } from '@workerv2/composition';

const backend = createReferenceBackend();

describe('toRgba', () => {
  it('converts any raster to 8-bit sRGB RGBA', () => {
    const gray = solidRaster(2, 2, [128], 'gray');
    const rgba = toRgba(backend, gray);
    expect(rgba).toMatchObject({ channels: 4, colorSpace: 'srgb' });
    expect(Array.from(rgba.data.subarray(0, 4))).toEqual([128, 128, 128, 255]);
  });
});

describe('fitRaster', () => {
  it('fill stretches to the exact destination', () => {
    const out = fitRaster(backend, solidRaster(4, 4, [1, 2, 3]), 2, 6, 'fill');
    expect(out).toMatchObject({ width: 2, height: 6, channels: 4 });
  });

  it('cover fills the destination fully (no transparent padding)', () => {
    const src = makeRaster(4, 2, new Array(4 * 2 * 3).fill(200), 'srgb', 3);
    const out = fitRaster(backend, src, 2, 2, 'cover');
    expect(out).toMatchObject({ width: 2, height: 2 });
    // Every pixel is fully opaque (cover leaves no gaps).
    for (let p = 0; p < 4; p += 1) expect(out.data[p * 4 + 3]).toBe(255);
  });

  it('contain fits inside and pads transparently', () => {
    const src = makeRaster(4, 2, new Array(4 * 2 * 3).fill(200), 'srgb', 3);
    const out = fitRaster(backend, src, 2, 2, 'contain');
    expect(out).toMatchObject({ width: 2, height: 2 });
    // 4x2 into 2x2 scales to 2x1, centred → the bottom row is transparent padding.
    expect(out.data[(1 * 2 + 0) * 4 + 3]).toBe(0);
  });
});
