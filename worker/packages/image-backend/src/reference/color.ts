// Deterministic COLOUR conversion — channel-layout changes (gray↔rgb, add/drop alpha, grayscale)
// and the sRGB↔linear transfer function (the deterministic ICC-family transform: sRGB is an ICC
// profile, and its EOTF/OETF is a fixed, standard curve). Precomputed 256-entry LUTs make the
// transfer both fast and exactly reproducible. True arbitrary-ICC-LUT transforms (AdobeRGB, CMYK,
// embedded profiles) require the profile data and belong to the native backend, behind the same
// `convert` contract — the reference covers the sRGB/linear/gray family.

import type { Channels, ColorSpace, RasterImage } from '../model.js';
import type { ConvertOp } from '../operations.js';

// Rec.601 luma weights (integer-stable via round on IEEE-754 arithmetic).
const R_WEIGHT = 0.299;
const G_WEIGHT = 0.587;
const B_WEIGHT = 0.114;

const SRGB_TO_LINEAR = buildLut(srgbToLinearByte);
const LINEAR_TO_SRGB = buildLut(linearToSrgbByte);

/** Apply a channel and/or colour-space conversion (colour space first, then channel layout). */
export function convertImage(image: RasterImage, op: ConvertOp): RasterImage {
  let current = image;
  if (op.colorSpace !== undefined && op.colorSpace !== current.colorSpace) {
    current = applyColorSpace(current, op.colorSpace);
  }
  if (op.channels !== undefined && op.channels !== current.channels) {
    current = applyChannels(current, op.channels);
  }
  return current;
}

function applyColorSpace(image: RasterImage, target: ColorSpace): RasterImage {
  if (target === 'gray') return toGrayscale(image);
  if (image.colorSpace === 'gray') return { ...grayToRgb(image), colorSpace: target };
  // Both are RGB-family (srgb ↔ linear): apply the transfer LUT to colour channels only.
  const lut = target === 'linear' ? SRGB_TO_LINEAR : LINEAR_TO_SRGB;
  const c = image.channels;
  const out = new Uint8Array(image.data.length);
  for (let i = 0; i < image.data.length; i += c) {
    out[i] = lut[image.data[i] as number] as number;
    out[i + 1] = lut[image.data[i + 1] as number] as number;
    out[i + 2] = lut[image.data[i + 2] as number] as number;
    if (c === 4) out[i + 3] = image.data[i + 3] as number; // alpha is linear-neutral
  }
  return { ...image, colorSpace: target, data: out };
}

function applyChannels(image: RasterImage, target: Channels): RasterImage {
  const from = image.channels;
  if (from === target) return image;
  if (target === 1) return toGrayscale(image);
  if (from === 1) {
    const rgb = grayToRgb(image);
    return target === 4 ? addAlpha(rgb) : rgb;
  }
  if (from === 3 && target === 4) return addAlpha(image);
  if (from === 4 && target === 3) return dropAlpha(image);
  return image;
}

function toGrayscale(image: RasterImage): RasterImage {
  if (image.channels === 1) return { ...image, colorSpace: 'gray' };
  const c = image.channels;
  const px = image.width * image.height;
  const out = new Uint8Array(px);
  for (let p = 0; p < px; p += 1) {
    const s = p * c;
    const r = image.data[s] as number;
    const g = image.data[s + 1] as number;
    const b = image.data[s + 2] as number;
    out[p] = Math.round(R_WEIGHT * r + G_WEIGHT * g + B_WEIGHT * b);
  }
  return { ...image, channels: 1, colorSpace: 'gray', data: out };
}

function grayToRgb(image: RasterImage): RasterImage {
  const px = image.width * image.height;
  const out = new Uint8Array(px * 3);
  for (let p = 0; p < px; p += 1) {
    const v = image.data[p] as number;
    const d = p * 3;
    out[d] = v;
    out[d + 1] = v;
    out[d + 2] = v;
  }
  return { ...image, channels: 3, colorSpace: 'srgb', data: out };
}

function addAlpha(image: RasterImage): RasterImage {
  const px = image.width * image.height;
  const out = new Uint8Array(px * 4);
  for (let p = 0; p < px; p += 1) {
    const s = p * 3;
    const d = p * 4;
    out[d] = image.data[s] as number;
    out[d + 1] = image.data[s + 1] as number;
    out[d + 2] = image.data[s + 2] as number;
    out[d + 3] = 255;
  }
  return { ...image, channels: 4, data: out };
}

function dropAlpha(image: RasterImage): RasterImage {
  const px = image.width * image.height;
  const out = new Uint8Array(px * 3);
  for (let p = 0; p < px; p += 1) {
    const s = p * 4;
    const d = p * 3;
    out[d] = image.data[s] as number;
    out[d + 1] = image.data[s + 1] as number;
    out[d + 2] = image.data[s + 2] as number;
  }
  return { ...image, channels: 3, data: out };
}

function buildLut(fn: (v: number) => number): Uint8Array {
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v += 1) lut[v] = fn(v);
  return lut;
}

function srgbToLinearByte(v: number): number {
  const c = v / 255;
  const lin = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return Math.round(clamp01(lin) * 255);
}

function linearToSrgbByte(v: number): number {
  const c = v / 255;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(clamp01(s) * 255);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
