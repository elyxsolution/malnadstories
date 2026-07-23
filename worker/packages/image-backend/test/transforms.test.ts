import { describe, it, expect } from 'vitest';
import {
  createReferenceBackend,
  makeRaster,
  solidRaster,
  gradientRaster,
} from '@workerv2/image-backend';
import { BackendError } from '@workerv2/image-backend';

const backend = createReferenceBackend();

// A 2x2 RGB raster with four distinct pixels for permutation checks.
//  (0,0)=A  (1,0)=B
//  (0,1)=C  (1,1)=D
const A = [10, 11, 12];
const B = [20, 21, 22];
const C = [30, 31, 32];
const D = [40, 41, 42];
const quad = makeRaster(2, 2, [...A, ...B, ...C, ...D]);

describe('crop', () => {
  it('extracts an in-bounds sub-rectangle', () => {
    const out = backend.crop(quad, { op: 'crop', x: 1, y: 0, width: 1, height: 2 });
    expect(out).toMatchObject({ width: 1, height: 2 });
    expect(Array.from(out.data)).toEqual([...B, ...D]);
  });

  it('rejects an out-of-bounds rectangle', () => {
    expect(() => backend.crop(quad, { op: 'crop', x: 1, y: 1, width: 2, height: 2 })).toThrow(
      BackendError,
    );
  });
});

describe('rotate', () => {
  it('rotates 90° clockwise (dimensions swap; top-left → top-right)', () => {
    const out = backend.rotate(quad, { op: 'rotate', degrees: 90 });
    expect(out).toMatchObject({ width: 2, height: 2 });
    // 90° CW: new(0,0)=C, new(1,0)=A, new(0,1)=D, new(1,1)=B
    expect(Array.from(out.data)).toEqual([...C, ...A, ...D, ...B]);
  });

  it('rotates 180°', () => {
    const out = backend.rotate(quad, { op: 'rotate', degrees: 180 });
    expect(Array.from(out.data)).toEqual([...D, ...C, ...B, ...A]);
  });

  it('270° is the inverse of 90°', () => {
    const ninety = backend.rotate(quad, { op: 'rotate', degrees: 90 });
    const back = backend.rotate(ninety, { op: 'rotate', degrees: 270 });
    expect(Array.from(back.data)).toEqual(Array.from(quad.data));
  });

  it('swaps dimensions for a non-square image', () => {
    const wide = gradientRaster(4, 2);
    expect(backend.rotate(wide, { op: 'rotate', degrees: 90 })).toMatchObject({
      width: 2,
      height: 4,
    });
  });
});

describe('resize', () => {
  it('nearest-neighbour upscales by pixel replication', () => {
    const out = backend.resize(quad, { op: 'resize', width: 4, height: 4, filter: 'nearest' });
    expect(out).toMatchObject({ width: 4, height: 4 });
    // Each source pixel maps to a 2x2 block; top-left block is A.
    expect(Array.from(out.data.subarray(0, 3))).toEqual(A);
    expect(Array.from(out.data.subarray(3, 6))).toEqual(A);
  });

  it('a same-size resize is an identity copy', () => {
    const out = backend.resize(quad, { op: 'resize', width: 2, height: 2 });
    expect(Array.from(out.data)).toEqual(Array.from(quad.data));
    expect(out.data).not.toBe(quad.data); // copied, not aliased
  });

  it('bilinear downscale stays within channel bounds and is deterministic', () => {
    const src = gradientRaster(8, 8);
    const a = backend.resize(src, { op: 'resize', width: 3, height: 3, filter: 'bilinear' });
    const b = backend.resize(src, { op: 'resize', width: 3, height: 3, filter: 'bilinear' });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(a.data.length).toBe(3 * 3 * 3);
  });
});

describe('colour convert', () => {
  it('grayscale uses Rec.601 luma and collapses to 1 channel', () => {
    const white = solidRaster(1, 1, [255, 255, 255]);
    expect(Array.from(backend.convert(white, { op: 'convert', colorSpace: 'gray' }).data)).toEqual([
      255,
    ]);
    const red = solidRaster(1, 1, [255, 0, 0]);
    // round(0.299*255) = 76
    expect(Array.from(backend.convert(red, { op: 'convert', channels: 1 }).data)).toEqual([76]);
  });

  it('gray → rgb replicates the channel', () => {
    const gray = solidRaster(1, 1, [128], 'gray');
    const rgb = backend.convert(gray, { op: 'convert', channels: 3 });
    expect(rgb).toMatchObject({ channels: 3, colorSpace: 'srgb' });
    expect(Array.from(rgb.data)).toEqual([128, 128, 128]);
  });

  it('adds and drops alpha', () => {
    const rgb = solidRaster(1, 1, [1, 2, 3]);
    const rgba = backend.convert(rgb, { op: 'convert', channels: 4 });
    expect(Array.from(rgba.data)).toEqual([1, 2, 3, 255]);
    expect(Array.from(backend.convert(rgba, { op: 'convert', channels: 3 }).data)).toEqual([
      1, 2, 3,
    ]);
  });

  it('sRGB↔linear is a real transfer curve (0 and 255 are fixed points)', () => {
    const src = solidRaster(1, 1, [0, 128, 255]);
    const linear = backend.convert(src, { op: 'convert', colorSpace: 'linear' });
    expect(linear.colorSpace).toBe('linear');
    // Endpoints are invariant; the midtone darkens going to linear.
    expect(linear.data[0]).toBe(0);
    expect(linear.data[2]).toBe(255);
    expect(linear.data[1]).toBeLessThan(128);
    // Round-tripping back to sRGB restores the endpoints exactly.
    const back = backend.convert(linear, { op: 'convert', colorSpace: 'srgb' });
    expect(back.data[0]).toBe(0);
    expect(back.data[2]).toBe(255);
  });
});
