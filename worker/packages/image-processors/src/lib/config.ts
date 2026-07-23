// Pure processor CONFIG parsers. Config schemas stay OUT of the SDK (the SDK provides only the
// `requireConfig` gate), so each processor's config is validated here as a pure
// `Result<T, string>`: a bad config is a `permanent` failure (retrying cannot fix it). Defaults
// are conservative and deterministic; nothing here reads ambient state.

import type { JsonObject, JsonValue, Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import type { ImageFormat, TargetFormat } from '../model.js';
import { IMAGE_FORMATS } from '../model.js';

// --- Validation config ---

export interface ValidationLimits {
  readonly maxBytes: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  /** Decompression-bomb guard: reject anything whose width×height exceeds this. */
  readonly maxPixels: number;
  /** The allowed input formats; defaults to every recognized format. */
  readonly allowedFormats: readonly ImageFormat[];
}

/** Conservative defaults (mirror the platform's historical hardening guards). */
export const DEFAULT_LIMITS: ValidationLimits = {
  maxBytes: 50 * 1024 * 1024, // 50 MB
  maxWidth: 30_000,
  maxHeight: 30_000,
  maxPixels: 100_000_000, // 100 MP
  allowedFormats: IMAGE_FORMATS,
};

export function parseValidationConfig(config: JsonObject): Result<ValidationLimits, string> {
  const maxBytes = positiveIntOr(config['maxBytes'], DEFAULT_LIMITS.maxBytes);
  if (!maxBytes.ok) return err(`maxBytes: ${maxBytes.error}`);
  const maxWidth = positiveIntOr(config['maxWidth'], DEFAULT_LIMITS.maxWidth);
  if (!maxWidth.ok) return err(`maxWidth: ${maxWidth.error}`);
  const maxHeight = positiveIntOr(config['maxHeight'], DEFAULT_LIMITS.maxHeight);
  if (!maxHeight.ok) return err(`maxHeight: ${maxHeight.error}`);
  const maxPixels = positiveIntOr(config['maxPixels'], DEFAULT_LIMITS.maxPixels);
  if (!maxPixels.ok) return err(`maxPixels: ${maxPixels.error}`);
  const allowedFormats = parseFormats(config['allowedFormats']);
  if (!allowedFormats.ok) return err(`allowedFormats: ${allowedFormats.error}`);

  return ok({
    maxBytes: maxBytes.value,
    maxWidth: maxWidth.value,
    maxHeight: maxHeight.value,
    maxPixels: maxPixels.value,
    allowedFormats: allowedFormats.value,
  });
}

// --- Format-normalization config ---

export interface FormatOptions {
  /** Force a canonical target instead of deriving it from alpha. */
  readonly forceTarget?: TargetFormat;
}

export function parseFormatConfig(config: JsonObject): Result<FormatOptions, string> {
  const value = config['forceTarget'];
  if (value === undefined) return ok({});
  if (value !== 'jpeg' && value !== 'png') {
    return err("forceTarget must be 'jpeg' or 'png'");
  }
  return ok({ forceTarget: value });
}

// --- Helpers ---

function positiveIntOr(value: JsonValue | undefined, fallback: number): Result<number, string> {
  if (value === undefined) return ok(fallback);
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return err('must be a positive integer');
  }
  return ok(value);
}

function parseFormats(value: JsonValue | undefined): Result<readonly ImageFormat[], string> {
  if (value === undefined) return ok(DEFAULT_LIMITS.allowedFormats);
  if (!Array.isArray(value) || value.length === 0) {
    return err('must be a non-empty array of format names');
  }
  const out: ImageFormat[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !isImageFormat(item)) {
      return err(`unknown format "${String(item)}"`);
    }
    if (!out.includes(item)) out.push(item);
  }
  return ok(out);
}

function isImageFormat(value: string): value is ImageFormat {
  return (IMAGE_FORMATS as readonly string[]).includes(value);
}
