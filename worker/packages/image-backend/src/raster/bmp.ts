// Deterministic BMP DECODE — an uncompressed (BI_RGB) 24/32-bit BMP is raw pixels plus a header,
// so it decodes to a raster in pure TypeScript with no codec. This gives the reference backend a
// real, common encoded format to ingest (beyond its own container). BGR(A) → RGB(A) reorder,
// bottom-up rows handled. Compressed / palettized / <24-bit BMPs are rejected (a native backend
// covers those). Fully bounds-checked and deterministic.

import type { Channels, RasterImage } from '../model.js';
import { BIT_DEPTH } from '../model.js';
import { BackendError } from '../errors.js';

/** True when `bytes` looks like a BMP ("BM"). */
export function isBmp(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d;
}

/** Decode an uncompressed 24/32-bit BMP to an sRGB raster. */
export function decodeBmp(bytes: Uint8Array): RasterImage {
  if (!isBmp(bytes)) throw new BackendError('Not a BMP');
  if (bytes.length < 54) throw new BackendError('Truncated BMP header');

  const dataOffset = readU32le(bytes, 10);
  const dibSize = readU32le(bytes, 14);
  if (dibSize < 40) throw new BackendError('Unsupported BMP DIB header');
  const width = readI32le(bytes, 18);
  const rawHeight = readI32le(bytes, 22);
  const bitCount = readU16le(bytes, 28);
  const compression = readU32le(bytes, 30);

  if (compression !== 0) throw new BackendError('Only uncompressed (BI_RGB) BMP is supported');
  if (bitCount !== 24 && bitCount !== 32) {
    throw new BackendError('Only 24- or 32-bit BMP is supported', { bitCount });
  }
  if (width <= 0 || rawHeight === 0) throw new BackendError('Invalid BMP dimensions');

  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  const srcChannels = bitCount / 8; // 3 or 4
  const rowStride = ((bitCount * width + 31) >> 5) * 4; // padded to a 4-byte boundary
  if (dataOffset + rowStride * height > bytes.length) {
    throw new BackendError('BMP pixel data is truncated');
  }

  const outChannels: Channels = srcChannels === 4 ? 4 : 3;
  const out = new Uint8Array(width * height * outChannels);

  for (let y = 0; y < height; y += 1) {
    const srcRow = topDown ? y : height - 1 - y; // bottom-up unless height is negative
    const rowBase = dataOffset + srcRow * rowStride;
    for (let x = 0; x < width; x += 1) {
      const s = rowBase + x * srcChannels;
      const d = (y * width + x) * outChannels;
      // BMP stores BGR(A); reorder to RGB(A).
      out[d] = byteAt(bytes, s + 2); // R
      out[d + 1] = byteAt(bytes, s + 1); // G
      out[d + 2] = byteAt(bytes, s); // B
      if (outChannels === 4) out[d + 3] = byteAt(bytes, s + 3); // A
    }
  }

  return {
    width,
    height,
    channels: outChannels,
    colorSpace: 'srgb',
    bitDepth: BIT_DEPTH,
    data: out,
  };
}

function byteAt(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined) throw new BackendError(`BMP read out of range at ${index}`);
  return value;
}

function readU16le(bytes: Uint8Array, offset: number): number {
  return byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8);
}

function readU32le(bytes: Uint8Array, offset: number): number {
  return (
    (byteAt(bytes, offset) +
      (byteAt(bytes, offset + 1) << 8) +
      (byteAt(bytes, offset + 2) << 16) +
      byteAt(bytes, offset + 3) * 0x1000000) >>>
    0
  );
}

function readI32le(bytes: Uint8Array, offset: number): number {
  return readU32le(bytes, offset) | 0;
}
