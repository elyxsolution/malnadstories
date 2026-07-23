import { describe, it, expect } from 'vitest';
import { compositePixel, fillRgba, clampByte, WHITE, TRANSPARENT } from '@workerv2/composition';

function pixel(rgba: number[]): Uint8Array {
  return new Uint8Array(rgba);
}

describe('clampByte', () => {
  it('clamps and rounds to a 0..255 byte', () => {
    expect(clampByte(-5)).toBe(0);
    expect(clampByte(300)).toBe(255);
    expect(clampByte(127.6)).toBe(128);
  });
});

describe('fillRgba', () => {
  it('fills a buffer with a solid colour', () => {
    const buf = new Uint8Array(8);
    fillRgba(buf, { r: 10, g: 20, b: 30, a: 40 });
    expect(Array.from(buf)).toEqual([10, 20, 30, 40, 10, 20, 30, 40]);
  });
});

describe('compositePixel', () => {
  it('normal over: full opacity replaces the destination colour', () => {
    const dst = pixel([0, 0, 0, 255]);
    compositePixel('normal', dst, 0, 200, 100, 50, 1);
    expect(Array.from(dst)).toEqual([200, 100, 50, 255]);
  });

  it('half opacity blends halfway', () => {
    const dst = pixel([0, 0, 0, 255]);
    compositePixel('normal', dst, 0, 200, 200, 200, 0.5);
    expect(Array.from(dst.subarray(0, 3))).toEqual([100, 100, 100]);
  });

  it('zero alpha is a no-op', () => {
    const dst = pixel([1, 2, 3, 4]);
    compositePixel('normal', dst, 0, 255, 255, 255, 0);
    expect(Array.from(dst)).toEqual([1, 2, 3, 4]);
  });

  it('multiply darkens', () => {
    const dst = pixel([100, 100, 100, 255]);
    compositePixel('multiply', dst, 0, 200, 200, 200, 1);
    // 200*100/255 = 78.4 → 78
    expect(dst[0]).toBe(78);
  });

  it('screen lightens', () => {
    const dst = pixel([100, 100, 100, 255]);
    compositePixel('screen', dst, 0, 200, 200, 200, 1);
    // 255 - (55*155)/255 = 221.57 → 222
    expect(dst[0]).toBe(222);
  });

  it('accumulates alpha when compositing onto transparency', () => {
    const dst = pixel([0, 0, 0, 0]);
    compositePixel('normal', dst, 0, 255, 0, 0, 0.5);
    expect(dst[3]).toBe(128); // 0.5 over 0 → 0.5 → 128
  });
});

describe('presets', () => {
  it('exposes opaque white and full transparency', () => {
    expect(WHITE).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(TRANSPARENT).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});
