// BACKEND TEST HARNESS — reusable, infrastructure-free scaffolding for exercising the backend +
// Pixel Gateway. An in-memory, content-addressed `ArtifactBytesPort` double (write-once,
// identical-bytes → identical key) and deterministic raster fixture builders. Ships in `src` (no
// test framework imported) so future image processors reuse the same doubles; the vitest CONTRACT
// SUITE that every backend must pass lives alongside the tests.

import type { StorageKey } from '@workerv2/infra-contracts';
import type { ArtifactBytesMeta, ArtifactBytesPort } from './contracts.js';
import type { Channels, ColorSpace, RasterImage } from './model.js';
import { BIT_DEPTH } from './model.js';

/**
 * An in-memory, content-addressed `ArtifactBytesPort`. Uses a deterministic, dependency-free FNV
 * address (`mem:<hex>`) — a TEST double, not sha256; a real host wires the platform's
 * content-addressed store. Write-once: identical bytes collapse to the same key.
 */
export class InMemoryArtifactBytesStore implements ArtifactBytesPort {
  private readonly blobs = new Map<string, Uint8Array>();

  async read(key: StorageKey): Promise<Uint8Array> {
    const value = this.blobs.get(key);
    if (value === undefined) throw new Error(`No artifact for key "${key}"`);
    return new Uint8Array(value);
  }

  async write(content: Uint8Array, _meta?: ArtifactBytesMeta): Promise<StorageKey> {
    const key = memAddress(content);
    if (!this.blobs.has(key)) this.blobs.set(key, new Uint8Array(content));
    return key;
  }

  /** Seed bytes as if written, returning the content address (for gateway tests). */
  seed(content: Uint8Array): StorageKey {
    const key = memAddress(content);
    if (!this.blobs.has(key)) this.blobs.set(key, new Uint8Array(content));
    return key;
  }

  get count(): number {
    return this.blobs.size;
  }
}

/** A deterministic, dependency-free content address for the in-memory store double. */
export function memAddress(data: Uint8Array): StorageKey {
  let h1 = 0x811c9dc5;
  let h2 = (0x811c9dc5 ^ 0x9e3779b9) >>> 0;
  for (const byte of data) {
    h1 = Math.imul(h1 ^ byte, 0x01000193) >>> 0;
    h2 = Math.imul((h2 + byte) >>> 0, 0x85ebca77) >>> 0;
  }
  h1 = (h1 ^ data.length) >>> 0;
  const hex = h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  return `mem:${hex}` as StorageKey;
}

// --- Raster fixture builders ---

const CHANNELS_FOR: Readonly<Record<ColorSpace, Channels>> = { gray: 1, srgb: 3, linear: 3 };

/** Build a raster from explicit per-pixel channel bytes (row-major). */
export function makeRaster(
  width: number,
  height: number,
  data: number[],
  colorSpace: ColorSpace = 'srgb',
  channels?: Channels,
): RasterImage {
  const c = channels ?? CHANNELS_FOR[colorSpace];
  return {
    width,
    height,
    channels: c,
    colorSpace,
    bitDepth: BIT_DEPTH,
    data: new Uint8Array(data),
  };
}

/** A solid-colour raster (every pixel = `pixel`). */
export function solidRaster(
  width: number,
  height: number,
  pixel: readonly number[],
  colorSpace: ColorSpace = 'srgb',
): RasterImage {
  const c = pixel.length as Channels;
  const data = new Uint8Array(width * height * c);
  for (let p = 0; p < width * height; p += 1) {
    for (let k = 0; k < c; k += 1) data[p * c + k] = pixel[k] as number;
  }
  return { width, height, channels: c, colorSpace, bitDepth: BIT_DEPTH, data };
}

/**
 * A deterministic RGB gradient raster — pixel (x,y) = (x·stepX mod 256, y·stepY mod 256, (x+y) mod
 * 256). Useful for asserting transforms move/interpolate pixels predictably.
 */
export function gradientRaster(width: number, height: number): RasterImage {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = (y * width + x) * 3;
      data[d] = (x * 17) & 0xff;
      data[d + 1] = (y * 23) & 0xff;
      data[d + 2] = (x + y) & 0xff;
    }
  }
  return { width, height, channels: 3, colorSpace: 'srgb', bitDepth: BIT_DEPTH, data };
}
