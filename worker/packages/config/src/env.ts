import { ConfigError } from '@workerv2/errors';

/** A read-only environment source. Defaults to `process.env` but is always injectable. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Read a required env var. Throws `ConfigError` if missing or empty/whitespace. */
export function requireEnv(source: EnvSource, key: string): string {
  const raw = source[key];
  if (raw === undefined || raw.trim() === '') {
    throw new ConfigError(`Missing required environment variable: ${key}`, {
      context: { key },
    });
  }
  return raw;
}

/** Read an optional env var, returning `fallback` (default `undefined`) when absent/empty. */
export function optionalEnv(source: EnvSource, key: string, fallback?: string): string | undefined {
  const raw = source[key];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

/** Parse a boolean env var (`1/true/yes/on` → true; `0/false/no/off` → false). */
export function boolEnv(source: EnvSource, key: string, fallback: boolean): boolean {
  const raw = source[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  throw new ConfigError(`Environment variable ${key} is not a valid boolean: "${raw}"`, {
    context: { key, value: raw },
  });
}
