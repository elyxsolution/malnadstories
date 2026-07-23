// Structural DECODE — read an encoded container's intrinsic geometry + pixel-format facts in pure
// TypeScript, deterministically and cross-platform. This is NOT a pixel decode (that needs a
// native codec, deferred behind the same processor contract); it is the header-level truth about
// what the raster is: dimensions, bit depth, channel layout, colour type, alpha, ICC presence.
//
// Supported header parsing: PNG, JPEG, GIF, BMP, WebP, TIFF. HEIC is recognized and its `ispe`
// box is read best-effort. A container we cannot parse yields `null` → a permanent processor
// failure (unparseable input cannot be fixed by a retry).

import { ByteReader } from './bytes.js';
import { detectFormat } from './format.js';
import type { ColorType, DecodedImage, IccInfo, ImageFormat } from '../model.js';
import { DECODED_SCHEMA, IMAGE_ENGINE_VERSION } from '../model.js';

/** The geometry + pixel-format core a per-format parser returns (assembled into a `DecodedImage`). */
interface Raster {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly channels: number;
  readonly hasAlpha: boolean;
  readonly colorType: ColorType;
}

/** Decode a container to its structural descriptor, or `null` if it cannot be parsed. */
export function decodeImage(data: Uint8Array): DecodedImage | null {
  const format = detectFormat(data);
  if (format === null) return null;
  const raster = readRaster(data, format);
  if (raster === null) return null;
  if (!Number.isInteger(raster.width) || !Number.isInteger(raster.height)) return null;
  if (raster.width <= 0 || raster.height <= 0) return null;
  return {
    schema: DECODED_SCHEMA,
    engineVersion: IMAGE_ENGINE_VERSION,
    format,
    width: raster.width,
    height: raster.height,
    bitDepth: raster.bitDepth,
    channels: raster.channels,
    hasAlpha: raster.hasAlpha,
    colorType: raster.colorType,
    icc: detectIcc(data, format),
    byteLength: data.length,
  };
}

function readRaster(data: Uint8Array, format: ImageFormat): Raster | null {
  const r = new ByteReader(data);
  try {
    switch (format) {
      case 'png':
        return readPng(r);
      case 'jpeg':
        return readJpeg(r);
      case 'gif':
        return readGif(r);
      case 'bmp':
        return readBmp(r);
      case 'webp':
        return readWebp(r);
      case 'tiff':
        return readTiff(r);
      case 'heic':
        return readHeic(r);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// --- PNG ---

function readPng(r: ByteReader): Raster | null {
  // IHDR is always the first chunk: 8-byte signature, then length(4)+type(4)+data(13).
  if (!r.matchesAt(12, [0x49, 0x48, 0x44, 0x52])) return null; // "IHDR"
  const width = r.u32be(16);
  const height = r.u32be(20);
  const bitDepth = r.u8(24);
  const pngColor = r.u8(25);
  const map = pngColorType(pngColor);
  if (map === null) return null;
  return { width, height, bitDepth, ...map };
}

function pngColorType(code: number): Pick<Raster, 'channels' | 'hasAlpha' | 'colorType'> | null {
  switch (code) {
    case 0:
      return { channels: 1, hasAlpha: false, colorType: 'grayscale' };
    case 2:
      return { channels: 3, hasAlpha: false, colorType: 'rgb' };
    case 3:
      return { channels: 1, hasAlpha: false, colorType: 'palette' };
    case 4:
      return { channels: 2, hasAlpha: true, colorType: 'grayscale-alpha' };
    case 6:
      return { channels: 4, hasAlpha: true, colorType: 'rgba' };
    default:
      return null;
  }
}

// --- JPEG ---

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function readJpeg(r: ByteReader): Raster | null {
  let offset = 2; // skip SOI
  while (offset + 4 <= r.length) {
    if (r.u8(offset) !== 0xff) return null;
    const marker = r.u8(offset + 1);
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segLength = r.u16be(offset + 2);
    if (segLength < 2) return null;
    if (JPEG_SOF_MARKERS.has(marker)) {
      const precision = r.u8(offset + 4);
      const height = r.u16be(offset + 5);
      const width = r.u16be(offset + 7);
      const components = r.u8(offset + 9);
      const color = jpegColorType(components);
      return { width, height, bitDepth: precision, ...color };
    }
    if (marker === 0xda) return null; // start of scan without an SOF
    offset += 2 + segLength;
  }
  return null;
}

function jpegColorType(components: number): Pick<Raster, 'channels' | 'hasAlpha' | 'colorType'> {
  if (components === 1) return { channels: 1, hasAlpha: false, colorType: 'grayscale' };
  if (components === 4) return { channels: 4, hasAlpha: false, colorType: 'cmyk' };
  return { channels: 3, hasAlpha: false, colorType: 'ycbcr' };
}

// --- GIF ---

function readGif(r: ByteReader): Raster | null {
  const width = r.u16le(6);
  const height = r.u16le(8);
  return { width, height, bitDepth: 8, channels: 1, hasAlpha: false, colorType: 'palette' };
}

// --- BMP ---

function readBmp(r: ByteReader): Raster | null {
  const dibSize = r.u32le(14);
  if (dibSize < 12) return null;
  // BITMAPCOREHEADER (12) uses u16 dims; everything modern (>=40) uses signed u32.
  const width = dibSize === 12 ? r.u16le(18) : Math.abs(toI32(r.u32le(18)));
  const height = dibSize === 12 ? r.u16le(20) : Math.abs(toI32(r.u32le(22)));
  const bitCount = dibSize === 12 ? r.u16le(22) : r.u16le(28);
  const color = bmpColorType(bitCount);
  return { width, height, bitDepth: 8, ...color };
}

function bmpColorType(bitCount: number): Pick<Raster, 'channels' | 'hasAlpha' | 'colorType'> {
  if (bitCount === 32) return { channels: 4, hasAlpha: true, colorType: 'rgba' };
  if (bitCount === 24) return { channels: 3, hasAlpha: false, colorType: 'rgb' };
  return { channels: 1, hasAlpha: false, colorType: 'palette' };
}

function toI32(u: number): number {
  return u | 0;
}

// --- WebP ---

function readWebp(r: ByteReader): Raster | null {
  const fourcc = r.ascii(12, 4);
  if (fourcc === 'VP8 ') {
    // Lossy: 3-byte frame tag, 3-byte start code (9d 01 2a), then 14-bit width/height.
    if (!r.matchesAt(23, [0x9d, 0x01, 0x2a])) return null;
    const width = r.u16le(26) & 0x3fff;
    const height = r.u16le(28) & 0x3fff;
    return { width, height, bitDepth: 8, channels: 3, hasAlpha: false, colorType: 'rgb' };
  }
  if (fourcc === 'VP8L') {
    if (r.u8(20) !== 0x2f) return null;
    const b0 = r.u8(21);
    const b1 = r.u8(22);
    const b2 = r.u8(23);
    const b3 = r.u8(24);
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    const hasAlpha = ((b3 >> 4) & 1) === 1;
    return {
      width,
      height,
      bitDepth: 8,
      channels: hasAlpha ? 4 : 3,
      hasAlpha,
      colorType: hasAlpha ? 'rgba' : 'rgb',
    };
  }
  if (fourcc === 'VP8X') {
    const flags = r.u8(20);
    const hasAlpha = ((flags >> 4) & 1) === 1;
    const width = 1 + u24le(r, 24);
    const height = 1 + u24le(r, 27);
    return {
      width,
      height,
      bitDepth: 8,
      channels: hasAlpha ? 4 : 3,
      hasAlpha,
      colorType: hasAlpha ? 'rgba' : 'rgb',
    };
  }
  return null;
}

function u24le(r: ByteReader, offset: number): number {
  return r.u8(offset) | (r.u8(offset + 1) << 8) | (r.u8(offset + 2) << 16);
}

// --- TIFF ---

const TIFF_TAG_WIDTH = 0x0100;
const TIFF_TAG_LENGTH = 0x0101;
const TIFF_TAG_BITS_PER_SAMPLE = 0x0102;
const TIFF_TAG_SAMPLES_PER_PIXEL = 0x0115;
const TIFF_TYPE_SIZES: Readonly<Record<number, number>> = { 1: 1, 3: 2, 4: 4 };

function readTiff(r: ByteReader): Raster | null {
  const le = r.u16be(0) === 0x4949;
  const ifd = r.u32(4, le);
  if (ifd + 2 > r.length) return null;
  const count = r.u16(ifd, le);
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let samples = 3;

  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > r.length) break;
    const tag = r.u16(entry, le);
    const type = r.u16(entry + 2, le);
    const size = TIFF_TYPE_SIZES[type];
    if (size === undefined) continue;
    const value = size <= 2 ? r.u16(entry + 8, le) : r.u32(entry + 8, le);
    if (tag === TIFF_TAG_WIDTH) width = value;
    else if (tag === TIFF_TAG_LENGTH) height = value;
    else if (tag === TIFF_TAG_BITS_PER_SAMPLE && size <= 2) bitDepth = value;
    else if (tag === TIFF_TAG_SAMPLES_PER_PIXEL) samples = value;
  }
  if (width <= 0 || height <= 0) return null;
  const color = tiffColorType(samples);
  return { width, height, bitDepth, ...color };
}

function tiffColorType(samples: number): Pick<Raster, 'channels' | 'hasAlpha' | 'colorType'> {
  if (samples >= 4) return { channels: 4, hasAlpha: true, colorType: 'rgba' };
  if (samples === 2) return { channels: 2, hasAlpha: true, colorType: 'grayscale-alpha' };
  if (samples === 1) return { channels: 1, hasAlpha: false, colorType: 'grayscale' };
  return { channels: 3, hasAlpha: false, colorType: 'rgb' };
}

// --- HEIC (best-effort: scan for the `ispe` box carrying the canvas dimensions) ---

function readHeic(r: ByteReader): Raster | null {
  const ispe = findFourcc(r, [0x69, 0x73, 0x70, 0x65]); // "ispe"
  if (ispe === null) return null;
  // ispe payload: version/flags(4), width(4 BE), height(4 BE).
  const width = r.u32be(ispe + 4 + 4);
  const height = r.u32be(ispe + 4 + 8);
  if (width <= 0 || height <= 0) return null;
  return { width, height, bitDepth: 8, channels: 3, hasAlpha: false, colorType: 'ycbcr' };
}

/** Return the offset just past a four-byte tag's first occurrence, or `null`. */
function findFourcc(r: ByteReader, tag: readonly number[]): number | null {
  for (let i = 0; i + tag.length <= r.length; i += 1) {
    if (r.matchesAt(i, tag)) return i + tag.length;
  }
  return null;
}

// --- ICC profile presence ---

function detectIcc(data: Uint8Array, format: ImageFormat): IccInfo {
  const r = new ByteReader(data);
  try {
    if (format === 'png') {
      // "iCCP" chunk carries a NUL-terminated profile name then the compressed profile.
      const at = findFourcc(r, [0x69, 0x43, 0x43, 0x50]); // "iCCP"
      if (at === null) return { present: false };
      const name = readCString(r, at, 79);
      return name.length > 0 ? { present: true, name } : { present: true };
    }
    if (format === 'jpeg') {
      // APP2 segment beginning with "ICC_PROFILE\0".
      const at = findFourcc(r, [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46]); // "ICC_PROF"
      return { present: at !== null };
    }
    return { present: false };
  } catch {
    return { present: false };
  }
}

function readCString(r: ByteReader, offset: number, maxLength: number): string {
  let out = '';
  for (let i = 0; i < maxLength && offset + i < r.length; i += 1) {
    const b = r.u8(offset + i);
    if (b === 0) break;
    out += String.fromCharCode(b);
  }
  return out.trim();
}
