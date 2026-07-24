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
