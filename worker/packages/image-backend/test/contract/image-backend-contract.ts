import { describe, expect, it } from 'vitest';
import type { ImageBackend } from '@workerv2/image-backend';
import { gradientRaster, solidRaster } from '@workerv2/image-backend';

/**
 * REUSABLE CONTRACT SUITE for any `ImageBackend`. A future native/GPU backend (sharp/libvips)
 * imports this and passes its own factory — the deterministic-family guarantees (encode/decode
 * round-trip, geometry-correct transforms, output validation, and — for backends that claim it —
 * byte-identical determinism) must hold for EVERY backend, which is what makes the backend a true
 * drop-in behind the same contracts. Backends that do not claim determinism skip the byte-identity
 * assertion but must still satisfy shape + validation.
 */
export function runImageBackendContract(name: string, makeBackend: () => ImageBackend): void {
  describe(`${name} — ImageBackend contract`, () => {
    it('round-trips a raster through encode → decode', () => {
      const backend = makeBackend();
      const image = gradientRaster(5, 4);
      const decoded = backend.decode(backend.encode(image));
      expect(decoded.width).toBe(5);
      expect(decoded.height).toBe(4);
      expect(Array.from(decoded.data)).toEqual(Array.from(image.data));
    });

    it('resize produces the requested geometry and a valid raster', () => {
      const backend = makeBackend();
      const out = backend.resize(gradientRaster(8, 8), { op: 'resize', width: 4, height: 3 });
      expect(out).toMatchObject({ width: 4, height: 3 });
      expect(backend.validate(out).ok).toBe(true);
    });

    it('rotate 90° swaps dimensions and stays valid', () => {
      const backend = makeBackend();
      const out = backend.rotate(gradientRaster(6, 4), { op: 'rotate', degrees: 90 });
      expect(out).toMatchObject({ width: 4, height: 6 });
      expect(backend.validate(out).ok).toBe(true);
    });

    it('crop yields the sub-rectangle and stays valid', () => {
      const backend = makeBackend();
      const out = backend.crop(gradientRaster(8, 8), {
        op: 'crop',
        x: 2,
        y: 2,
        width: 3,
        height: 3,
      });
      expect(out).toMatchObject({ width: 3, height: 3 });
      expect(backend.validate(out).ok).toBe(true);
    });

    it('convert to grayscale collapses to one channel and stays valid', () => {
      const backend = makeBackend();
      const out = backend.convert(gradientRaster(4, 4), { op: 'convert', colorSpace: 'gray' });
      expect(out).toMatchObject({ channels: 1, colorSpace: 'gray' });
      expect(backend.validate(out).ok).toBe(true);
    });

    it('validate rejects a raster whose data length is inconsistent', () => {
      const backend = makeBackend();
      const bad = { ...solidRaster(2, 2, [1, 2, 3]), data: new Uint8Array(2) };
      expect(backend.validate(bad).ok).toBe(false);
    });

    it('deterministic backends encode identical rasters to identical bytes', () => {
      const backend = makeBackend();
      if (!backend.info.deterministic) return;
      const image = gradientRaster(7, 7);
      const a = backend.encode(backend.resize(image, { op: 'resize', width: 3, height: 5 }));
      const b = backend.encode(backend.resize(image, { op: 'resize', width: 3, height: 5 }));
      expect(Array.from(a)).toEqual(Array.from(b));
    });
  });
}
