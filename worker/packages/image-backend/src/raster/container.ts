// The canonical raster CONTAINER (`WV2R`) — a tiny, self-describing, deterministic binary wrapper
// around raw 8-bit pixels. It is the backend's own encode/decode format: byte order is fixed
// (big-endian geometry), there is no compression and no row padding, so a raster's encoded bytes
// are a pure function of its pixels + format. That determinism is what makes a produced raster
// Artifact content-addressable and reproducible across platforms.
//
// Layout (16-byte header, then packed pixel data):
//   "WV2R" (4) · version u8 · colorSpace u8 · channels u8 · bitDepth u8 · width u32be · height u32be

import type { Channels, ColorSpace, RasterImage } from '../model.js';
import { BIT_DEPTH, expectedByteLength } from '../model.js';
import { BackendError } from '../errors.js';

const MAGIC = [0x57, 0x56, 0x32, 0x52]; // "WV2R"
const VERSION = 1;
const HEADER_SIZE = 16;

const COLOR_SPACE_CODES: Readonly<Record<ColorSpace, number>> = { gray: 0, srgb: 1, linear: 2 };
const CODE_COLOR_SPACES: Readonly<Record<number, ColorSpace>> = {
  0: 'gray',
  1: 'srgb',
  2: 'linear',
};

/** True when `bytes` begins with the canonical container magic. */
export function isRasterContainer(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === MAGIC[0] &&
    bytes[1] === MAGIC[1] &&
    bytes[2] === MAGIC[2] &&
    bytes[3] === MAGIC[3]
  );
}

/** Encode a raster to canonical container bytes (deterministic; identical pixels → identical bytes). */
export function encodeRaster(image: RasterImage): Uint8Array {
  const out = new Uint8Array(HEADER_SIZE + image.data.length);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  out[5] = COLOR_SPACE_CODES[image.colorSpace];
  out[6] = image.channels;
  out[7] = image.bitDepth;
  writeU32be(out, 8, image.width);
  writeU32be(out, 12, image.height);
  out.set(image.data, HEADER_SIZE);
  return out;
}

/** Decode canonical container bytes back to a raster (validating header + data length). */
export function decodeRaster(bytes: Uint8Array): RasterImage {
  if (!isRasterContainer(bytes) || bytes.length < HEADER_SIZE) {
    throw new BackendError('Not a WV2R raster container');
  }
  const version = at(bytes, 4);
  if (version !== VERSION) throw new BackendError(`Unsupported raster version ${version}`);
  const colorSpace = CODE_COLOR_SPACES[at(bytes, 5)];
  if (colorSpace === undefined) throw new BackendError('Unknown colour-space code');
  const channels = at(bytes, 6);
  if (channels !== 1 && channels !== 3 && channels !== 4) {
    throw new BackendError(`Unsupported channel count ${channels}`);
  }
  const bitDepth = at(bytes, 7);
  if (bitDepth !== BIT_DEPTH) throw new BackendError(`Unsupported bit depth ${bitDepth}`);
  const width = readU32be(bytes, 8);
  const height = readU32be(bytes, 12);
  const expected = expectedByteLength({ width, height, channels: channels as Channels });
  const data = bytes.subarray(HEADER_SIZE);
  if (data.length !== expected) {
    throw new BackendError('Raster data length does not match header geometry', {
      actual: data.length,
      expected,
    });
  }
  return {
    width,
    height,
    channels: channels as Channels,
    colorSpace,
    bitDepth: BIT_DEPTH,
    data: new Uint8Array(data), // detach from the source buffer
  };
}

function at(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined) throw new BackendError(`Truncated raster header at ${index}`);
  return value;
}

function writeU32be(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function readU32be(bytes: Uint8Array, offset: number): number {
  return (
    at(bytes, offset) * 0x1000000 +
    (at(bytes, offset + 1) << 16) +
    (at(bytes, offset + 2) << 8) +
    at(bytes, offset + 3)
  );
}
