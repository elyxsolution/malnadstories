/**
 * CONFIGURATION PRIMITIVES — the shared error type + env parsers used by both the app-process config
 * (`config.ts`) and the infrastructure config (`infra/config.ts`). Extracted into a dependency-free
 * leaf module so those two can share it without an import cycle. Pure: no I/O, no globals.
 */

/** A configuration failure — thrown before startup so the process exits with a clear message. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Read a required env var, or throw a `ConfigError` naming it. */
export function requireEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new ConfigError(`${name} is required`);
  }
  return value;
}

/** Parse a positive integer env var, falling back to `fallback` when unset. */
export function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(`${name} must be a positive integer (got "${value}")`);
  }
  return n;
}

/** Parse a TCP port env var (1..65535). */
export function parsePort(value: string, name = 'PORT'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new ConfigError(`${name} must be an integer in 1..65535 (got "${value}")`);
  }
  return n;
}

/**
 * Parse an integer env var constrained to an inclusive range. Bounded parsing is what turns a
 * typo like `WV2_POLL_INTERVAL_MS=100000000` (a worker that appears hung) into a startup error.
 */
export function parseIntInRange(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be an integer in ${min}..${max} (got "${value}")`);
  }
  return n;
}

/** Parse a `on|off|true|false|1|0` flag. Anything else is a configuration error, not a silent false. */
export function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['on', 'true', '1', 'yes'].includes(normalized)) return true;
  if (['off', 'false', '0', 'no'].includes(normalized)) return false;
  throw new ConfigError(`${name} must be one of on|off|true|false|1|0 (got "${value}")`);
}

/** Parse a ratio in `[0, 1]` (sampling rates). */
export function parseRatio(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new ConfigError(`${name} must be a number in 0..1 (got "${value}")`);
  }
  return n;
}

/** Parse a value constrained to a fixed set of allowed strings. */
export function parseEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  name: string,
): T {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase() as T;
  if (!allowed.includes(normalized)) {
    throw new ConfigError(`${name} must be one of ${allowed.join('|')} (got "${value}")`);
  }
  return normalized;
}

/**
 * Parse an absolute `http`/`https` URL and return it without a trailing slash. Validating URL SHAPE
 * at startup is what stops a mis-set `APP_URL` from surfacing as a mystifying Chromium navigation
 * failure minutes later, on the first PDF job.
 */
export function parseUrl(value: string | undefined, fallback: string, name: string): string {
  const raw = (value ?? fallback).trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError(`${name} must be an absolute URL (got "${raw}")`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError(`${name} must use http or https (got "${parsed.protocol}//")`);
  }
  return raw.replace(/\/+$/, '');
}

/** Parse a megabyte-denominated size into bytes. */
export function parseMegabytes(
  value: string | undefined,
  fallbackMb: number,
  name: string,
): number {
  const mb = parseIntInRange(value, fallbackMb, 1, 1_048_576, name);
  return mb * 1024 * 1024;
}
