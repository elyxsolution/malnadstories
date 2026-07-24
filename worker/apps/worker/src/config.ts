import { loadRuntimeConfigFromEnv } from '@workerv2/worker-runtime';
import type { RuntimeConfig } from '@workerv2/worker-runtime';

/**
 * APPLICATION CONFIGURATION — a thin wrapper that reuses the runtime's EXISTING configuration system
 * (`loadRuntimeConfigFromEnv`) and adds only the app-process knobs (queue polling interval, optional
 * health port). It duplicates NO runtime configuration logic. It validates the required config up
 * front and FAILS FAST with a useful error, so a misconfigured worker never half-starts.
 */

/** The deployable worker's own version (the app process); distinct from the runtime library version. */
export const WORKER_VERSION = '0.0.0';
/** The production-runtime library version this app hosts. */
export const RUNTIME_VERSION = '0.0.0';

export interface AppConfig {
  readonly runtime: RuntimeConfig;
  /** How often the consume loop polls the queue when idle (ms). */
  readonly pollIntervalMs: number;
  /** HTTP health port (from `PORT`); `null` runs headless (a background worker binds no port). */
  readonly healthPort: number | null;
}

/** Load + validate the application configuration from environment variables. */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const runtime = loadRuntimeConfigFromEnv(env);

  if (runtime.storage.kind === 'filesystem' && !runtime.storage.root) {
    throw new ConfigError('WV2_STORAGE=filesystem requires WV2_STORAGE_ROOT to be set');
  }

  const pollIntervalMs = parsePositiveInt(
    env['WV2_POLL_INTERVAL_MS'],
    1000,
    'WV2_POLL_INTERVAL_MS',
  );
  const healthPort = env['PORT'] === undefined ? null : parsePort(env['PORT']);

  return { runtime, pollIntervalMs, healthPort };
}

/** A one-line, human-readable summary of the resolved config (for the startup log). */
export function summarizeConfig(config: AppConfig): Record<string, unknown> {
  return {
    storage: config.runtime.storage.kind,
    storageRoot: config.runtime.storage.root ?? null,
    backendId: config.runtime.backendId,
    structuredLogging: config.runtime.diagnostics.structuredLogging,
    metrics: config.runtime.diagnostics.metrics,
    pollIntervalMs: config.pollIntervalMs,
    healthPort: config.healthPort,
  };
}

/** A configuration failure — thrown before startup so the process exits with a clear message. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(`${name} must be a positive integer (got "${value}")`);
  }
  return n;
}

function parsePort(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new ConfigError(`PORT must be an integer in 1..65535 (got "${value}")`);
  }
  return n;
}
