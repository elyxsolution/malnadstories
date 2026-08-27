import { hostname } from 'node:os';
import { loadRuntimeConfigFromEnv } from '@workerv2/worker-runtime';
import type { RuntimeConfig } from '@workerv2/worker-runtime';
import {
  ConfigError,
  parseBoolean,
  parseEnum,
  parseIntInRange,
  parseMegabytes,
  parsePort,
  parseRatio,
} from './config-error.js';
import { assertConfigValid } from './config-validation.js';
import { infrastructureRequested, loadInfrastructureConfig } from './infra/config.js';
import type { InfrastructureConfig } from './infra/config.js';
import type { ObservabilityConfig } from './observability/index.js';
import { parseLogLevel } from './observability/index.js';
import type { ConcurrencyConfig } from './concurrency.js';
import { DEFAULT_LANE } from './concurrency.js';

/**
 * APPLICATION CONFIGURATION — composed from FIVE orthogonal, separately-owned sections so each
 * concern is configured independently and never leaks into the others:
 *
 *   • `runtime`        — the pure execution engine's config (durable storage kind, retries, diagnostics),
 *                        owned by `@workerv2/worker-runtime` (`loadRuntimeConfigFromEnv`). Unchanged.
 *   • `app`            — the app-process knobs (queue poll interval, optional health port).
 *   • `observability`  — logging/tracing/metrics/monitoring/health thresholds (Phase I-4).
 *   • `infrastructure` — the production I/O adapters (pg-boss / R2 / Supabase); `null` unless opted in.
 *   • `processors`     — which job handlers to register.
 *
 * Configuration is validated in TWO passes and fails fast on either: per-field as it is parsed (type,
 * range, URL shape, enum membership — see `config-error.ts`), then cross-field once assembled (see
 * `config-validation.ts`). A misconfigured worker therefore never half-starts, and the operator always
 * gets the offending variable's name in the message.
 */

/** The deployable worker's own version (the app process); distinct from the runtime library version. */
export const WORKER_VERSION = '0.0.0';
/** The production-runtime library version this app hosts. */
export const RUNTIME_VERSION = '0.0.0';

/** Which worker this process is: a real processor worker, or the in-memory reference worker. */
export type WorkerMode = 'production' | 'reference';

/** App-process knobs (not runtime, not infrastructure, not observability). */
export interface AppProcessConfig {
  /** How often the consume loop polls the queue when idle (ms). */
  readonly pollIntervalMs: number;
  /** HTTP health port (from `PORT`); `null` runs headless (a background worker binds no port). */
  readonly healthPort: number | null;
  /**
   * Ceiling on how long a graceful shutdown waits for in-flight jobs (ms). Past it, the worker stops
   * waiting and exits: unacked jobs return to the broker on their visibility timeout, so abandoning
   * the wait loses nothing — whereas overrunning the orchestrator's grace period earns a SIGKILL,
   * which loses the durable state that shutdown was trying to flush.
   */
  readonly drainTimeoutMs: number;
  /**
   * Bearer token guarding `/diagnostics` and the detailed `/ready` payload. `null` (the default)
   * disables `/diagnostics` and redacts `/ready` — the health port is publicly reachable, so
   * detailed internals are opt-in rather than opt-out.
   */
  readonly diagnosticsToken: string | null;
}

/**
 * Concurrency defaults. `album-pdf` is `heavy` and capped at 1 because a render owns a Chromium page
 * — the memory-dominant operation in this worker. Image hardening gets the widest lane because it is
 * the highest-volume job and mostly waits on network I/O.
 */
export function loadConcurrencyConfig(
  env: Readonly<Record<string, string | undefined>>,
): ConcurrencyConfig {
  return {
    maxInFlight: parseIntInRange(env['WV2_MAX_IN_FLIGHT'], 4, 1, 64, 'WV2_MAX_IN_FLIGHT'),
    defaultLane: DEFAULT_LANE,
    lanes: {
      'image-hardening': {
        min: 1,
        max: parseIntInRange(env['WV2_IMAGE_CONCURRENCY'], 3, 1, 32, 'WV2_IMAGE_CONCURRENCY'),
      },
      'album-pdf': {
        min: 1,
        max: parseIntInRange(env['WV2_PDF_CONCURRENCY'], 1, 1, 8, 'WV2_PDF_CONCURRENCY'),
        heavy: true,
      },
      'r2-cleanup': {
        min: 1,
        max: parseIntInRange(env['WV2_CLEANUP_CONCURRENCY'], 2, 1, 16, 'WV2_CLEANUP_CONCURRENCY'),
      },
    },
    recoveryQuietFraction: parseRatio(
      env['WV2_RECOVERY_QUIET_FRACTION'],
      0.5,
      'WV2_RECOVERY_QUIET_FRACTION',
    ),
  };
}

export interface AppConfig {
  readonly runtime: RuntimeConfig;
  readonly app: AppProcessConfig;
  /** Per-job-type concurrency lanes + the global in-flight ceiling (Phase I-5). */
  readonly concurrency: ConcurrencyConfig;
  readonly observability: ObservabilityConfig;
  /** Production infrastructure config, or `null` when infrastructure is not enabled. */
  readonly infrastructure: InfrastructureConfig | null;
  /**
   * `production` when the concrete processors are wired to real infrastructure; `reference` when the
   * worker is running its in-memory album path and will consume no production jobs. Derived, not
   * configured — it exists so startup can state the mode in one word instead of leaving a developer
   * to infer it from three unrelated fields.
   */
  readonly mode: WorkerMode;
  /** Non-fatal configuration warnings surfaced by the startup report + the `configuration` probe. */
  readonly warnings: readonly string[];
}

/** Build the observability section from the environment. Every knob is bounded + defaulted. */
export function loadObservabilityConfig(
  env: Readonly<Record<string, string | undefined>>,
): ObservabilityConfig {
  return {
    workerId: env['WV2_WORKER_ID'] ?? env['RENDER_INSTANCE_ID'] ?? safeHostname(),
    level: parseLogLevel(env['WV2_LOG_LEVEL'], 'info'),
    format: parseEnum(
      env['WV2_LOG_FORMAT'],
      ['json', 'console'] as const,
      'json',
      'WV2_LOG_FORMAT',
    ),
    tracing: parseBoolean(env['WV2_TRACING'], true, 'WV2_TRACING'),
    traceSampleRatio: parseRatio(env['WV2_TRACE_SAMPLE'], 1, 'WV2_TRACE_SAMPLE'),
    // Reuses the runtime's existing metrics switch so ONE variable governs both layers.
    metrics: parseBoolean(env['WV2_METRICS'], true, 'WV2_METRICS'),
    monitorIntervalMs: parseIntInRange(
      env['WV2_MONITOR_INTERVAL_MS'],
      30_000,
      1_000,
      3_600_000,
      'WV2_MONITOR_INTERVAL_MS',
    ),
    memorySoftLimitBytes: parseMegabytes(
      env['WV2_MEMORY_SOFT_LIMIT_MB'],
      768,
      'WV2_MEMORY_SOFT_LIMIT_MB',
    ),
    memoryHardLimitBytes: parseMegabytes(
      env['WV2_MEMORY_HARD_LIMIT_MB'],
      1_536,
      'WV2_MEMORY_HARD_LIMIT_MB',
    ),
    recentCapacity: parseIntInRange(
      env['WV2_DIAGNOSTICS_BUFFER'],
      200,
      10,
      5_000,
      'WV2_DIAGNOSTICS_BUFFER',
    ),
  };
}

/** Load + validate the full application configuration from environment variables. */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const runtime = loadRuntimeConfigFromEnv(env);

  if (runtime.storage.kind === 'filesystem' && !runtime.storage.root) {
    throw new ConfigError('WV2_STORAGE=filesystem requires WV2_STORAGE_ROOT to be set');
  }

  const app: AppProcessConfig = {
    pollIntervalMs: parseIntInRange(
      env['WV2_POLL_INTERVAL_MS'],
      1_000,
      1,
      3_600_000,
      'WV2_POLL_INTERVAL_MS',
    ),
    healthPort: env['PORT'] === undefined ? null : parsePort(env['PORT']),
    drainTimeoutMs: parseIntInRange(
      env['WV2_DRAIN_TIMEOUT_MS'],
      30_000,
      100,
      600_000,
      'WV2_DRAIN_TIMEOUT_MS',
    ),
    diagnosticsToken: emptyToNull(env['WV2_DIAGNOSTICS_TOKEN']),
  };

  const infrastructure = loadInfrastructureConfig(env);
  const assembled: AppConfig = {
    runtime,
    app,
    concurrency: loadConcurrencyConfig(env),
    observability: loadObservabilityConfig(env),
    infrastructure,
    mode: infrastructure === null ? 'reference' : 'production',
    warnings: [],
  };

  // Cross-field pass: throws on contradictions, returns the non-fatal warnings.
  return { ...assembled, warnings: assertConfigValid(assembled) };
}

/**
 * A human-readable summary of the resolved config, for the startup log, the `configuration` health
 * probe, and `/diagnostics`.
 *
 * SECURITY: this reports SHAPE, never VALUES — `storage: 'filesystem'`, `infrastructure: 'enabled'`.
 * No connection string, bucket credential, or token is included, so the summary is safe to expose on
 * the diagnostics endpoint and safe to ship to a log aggregator.
 */
export function summarizeConfig(config: AppConfig): Record<string, unknown> {
  return {
    storage: config.runtime.storage.kind,
    storageRoot: config.runtime.storage.root ?? null,
    backendId: config.runtime.backendId,
    structuredLogging: config.runtime.diagnostics.structuredLogging,
    pollIntervalMs: config.app.pollIntervalMs,
    healthPort: config.app.healthPort,
    drainTimeoutMs: config.app.drainTimeoutMs,
    // Reports WHETHER the endpoints are protected, never the token itself.
    diagnosticsProtected: config.app.diagnosticsToken !== null,
    maxInFlight: config.concurrency.maxInFlight,
    lanes: Object.fromEntries(
      Object.entries(config.concurrency.lanes).map(([type, lane]) => [
        type,
        `${lane.min}..${lane.max}${lane.heavy === true ? ' (heavy)' : ''}`,
      ]),
    ),
    workerId: config.observability.workerId,
    logLevel: config.observability.level,
    logFormat: config.observability.format,
    tracing: config.observability.tracing,
    traceSampleRatio: config.observability.traceSampleRatio,
    metrics: config.observability.metrics,
    monitorIntervalMs: config.observability.monitorIntervalMs,
    memorySoftLimitMb: Math.round(config.observability.memorySoftLimitBytes / 1024 / 1024),
    memoryHardLimitMb: Math.round(config.observability.memoryHardLimitBytes / 1024 / 1024),
    infrastructure: config.infrastructure === null ? 'disabled' : 'enabled',
    recovery:
      config.infrastructure === null
        ? 'n/a'
        : config.infrastructure.recovery.enabled
          ? `every ${config.infrastructure.recovery.intervalMs}ms (batch ${config.infrastructure.recovery.batchSize})`
          : 'disabled',
    appUrl: config.infrastructure?.render.appUrl ?? null,
    // WHERE the render URL came from — a defaulted localhost and a configured one are the same
    // string, and only one of them is a misconfiguration. See infra/config.ts.
    appUrlSource: config.infrastructure?.render.appUrlSource ?? null,
    warnings: config.warnings.length,
  };
}

/**
 * Why infrastructure is disabled, phrased so a developer can act on it without reading any code.
 * `null` when it IS enabled.
 *
 * This exists because "infrastructure: disabled" on its own is a symptom, not a diagnosis — it does
 * not say whether the switch is unset, or set to something unrecognised, or which variables are
 * missing.
 */
export function infrastructureDisabledReason(
  config: AppConfig,
  env: Readonly<Record<string, string | undefined>> = process.env,
): { readonly reason: string; readonly expected: string } | null {
  if (config.infrastructure !== null) return null;
  const raw = env['WV2_INFRA'];
  if (raw === undefined || raw.trim().length === 0) {
    return { reason: 'WV2_INFRA is not set', expected: 'WV2_INFRA=on' };
  }
  // A recognised-but-false value: the operator turned it off deliberately.
  return { reason: `WV2_INFRA is set to "${raw}" (disabled)`, expected: 'WV2_INFRA=on' };
}

/** Whether production mode was ASKED for, whatever the outcome. Re-exported for startup reporting. */
export { infrastructureRequested };

function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value.trim().length === 0 ? null : value;
}

function safeHostname(): string {
  try {
    return hostname();
  } catch {
    return 'worker'; // hostname() can fail in minimal containers — never block startup on it
  }
}

export { ConfigError };
