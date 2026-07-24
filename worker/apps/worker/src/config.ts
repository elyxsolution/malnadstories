import { loadRuntimeConfigFromEnv } from '@workerv2/worker-runtime';
import type { RuntimeConfig } from '@workerv2/worker-runtime';
import { ConfigError, parsePositiveInt, parsePort } from './config-error.js';
import { loadInfrastructureConfig, loadProcessorConfig } from './infra/config.js';
import type { InfrastructureConfig, ProcessorConfig } from './infra/config.js';

/**
 * APPLICATION CONFIGURATION — composed from FOUR orthogonal, separately-owned sections so each concern
 * is configured independently and never leaks into the others:
 *
 *   • `runtime`        — the pure execution engine's config (durable storage kind, retries, diagnostics),
 *                        owned by `@workerv2/worker-runtime` (`loadRuntimeConfigFromEnv`). Unchanged.
 *   • `app`            — the app-process knobs (queue poll interval, optional health port).
 *   • `infrastructure` — the production I/O adapters (pg-boss / R2 / Supabase); `null` unless opted in.
 *   • `processors`     — which job handlers to register (empty in Phase I-0 — the worker stays idle).
 *
 * It duplicates NO runtime configuration logic, validates required config up front, and FAILS FAST with
 * a useful error so a misconfigured worker never half-starts.
 */

/** The deployable worker's own version (the app process); distinct from the runtime library version. */
export const WORKER_VERSION = '0.0.0';
/** The production-runtime library version this app hosts. */
export const RUNTIME_VERSION = '0.0.0';

/** App-process knobs (not runtime, not infrastructure). */
export interface AppProcessConfig {
  /** How often the consume loop polls the queue when idle (ms). */
  readonly pollIntervalMs: number;
  /** HTTP health port (from `PORT`); `null` runs headless (a background worker binds no port). */
  readonly healthPort: number | null;
}

export interface AppConfig {
  readonly runtime: RuntimeConfig;
  readonly app: AppProcessConfig;
  /** Production infrastructure config, or `null` when infrastructure is disabled (`WV2_INFRA` != `on`). */
  readonly infrastructure: InfrastructureConfig | null;
  readonly processors: ProcessorConfig;
}

/** Load + validate the full application configuration from environment variables. */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const runtime = loadRuntimeConfigFromEnv(env);

  if (runtime.storage.kind === 'filesystem' && !runtime.storage.root) {
    throw new ConfigError('WV2_STORAGE=filesystem requires WV2_STORAGE_ROOT to be set');
  }

  const app: AppProcessConfig = {
    pollIntervalMs: parsePositiveInt(env['WV2_POLL_INTERVAL_MS'], 1000, 'WV2_POLL_INTERVAL_MS'),
    healthPort: env['PORT'] === undefined ? null : parsePort(env['PORT']),
  };

  return {
    runtime,
    app,
    infrastructure: loadInfrastructureConfig(env),
    processors: loadProcessorConfig(env),
  };
}

/** A one-line, human-readable summary of the resolved config (for the startup log). */
export function summarizeConfig(config: AppConfig): Record<string, unknown> {
  return {
    storage: config.runtime.storage.kind,
    storageRoot: config.runtime.storage.root ?? null,
    backendId: config.runtime.backendId,
    structuredLogging: config.runtime.diagnostics.structuredLogging,
    metrics: config.runtime.diagnostics.metrics,
    pollIntervalMs: config.app.pollIntervalMs,
    healthPort: config.app.healthPort,
    infrastructure: config.infrastructure === null ? 'disabled' : 'enabled',
    processors: config.processors.enabled.length,
  };
}

export { ConfigError };
