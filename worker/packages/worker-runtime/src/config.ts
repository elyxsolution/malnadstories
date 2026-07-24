import type { ManifestPolicies, RetryPolicy } from '@workerv2/worker-host';

/**
 * RUNTIME CONFIGURATION — the EXTERNAL, injectable operational config. It lives entirely in the
 * runtime (never in a core package) and selects durable infrastructure, backend, worker limits,
 * retry overrides, diagnostics, and feature flags. `resolveRuntimeConfig` fills deterministic
 * defaults; `loadRuntimeConfigFromEnv` shows one external source (env vars). Config never changes
 * processing semantics — it only chooses how the runtime is wired + operated.
 */

export type StorageKind = 'memory' | 'filesystem';

export interface StorageConfig {
  readonly kind: StorageKind;
  /** Root directory for the filesystem backend (required when `kind === 'filesystem'`). */
  readonly root?: string;
}

export interface WorkerLimits {
  /** Safety bound on effect-loop sweeps per run. */
  readonly maxSweeps?: number;
  /** Declarative max concurrent nodes advice for the scheduler. */
  readonly maxInFlight?: number;
}

export interface RetryOverrides {
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
}

export interface DiagnosticsConfig {
  readonly structuredLogging: boolean;
  readonly metrics: boolean;
}

export interface RuntimeConfig {
  readonly storage: StorageConfig;
  readonly backendId: string;
  readonly workerLimits: WorkerLimits;
  readonly retryOverrides?: RetryOverrides;
  readonly diagnostics: DiagnosticsConfig;
  readonly features: Readonly<Record<string, boolean>>;
  readonly clockStart: string;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  storage: { kind: 'memory' },
  backendId: 'reference',
  workerLimits: {},
  diagnostics: { structuredLogging: true, metrics: true },
  features: {},
  clockStart: '2026-01-01T00:00:00.000Z',
};

/** Fill any omitted config with deterministic defaults. */
export function resolveRuntimeConfig(config: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    storage: config.storage ?? DEFAULT_RUNTIME_CONFIG.storage,
    backendId: config.backendId ?? DEFAULT_RUNTIME_CONFIG.backendId,
    workerLimits: config.workerLimits ?? {},
    ...(config.retryOverrides === undefined ? {} : { retryOverrides: config.retryOverrides }),
    diagnostics: config.diagnostics ?? DEFAULT_RUNTIME_CONFIG.diagnostics,
    features: config.features ?? {},
    clockStart: config.clockStart ?? DEFAULT_RUNTIME_CONFIG.clockStart,
  };
}

/** Build a runtime config from environment-style variables (one external source). */
export function loadRuntimeConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeConfig {
  const kind: StorageKind = env['WV2_STORAGE'] === 'filesystem' ? 'filesystem' : 'memory';
  const storage: StorageConfig =
    kind === 'filesystem' && env['WV2_STORAGE_ROOT'] !== undefined
      ? { kind, root: env['WV2_STORAGE_ROOT'] }
      : { kind };
  return resolveRuntimeConfig({
    storage,
    ...(env['WV2_BACKEND'] === undefined ? {} : { backendId: env['WV2_BACKEND'] }),
    diagnostics: {
      structuredLogging: env['WV2_LOGGING'] !== 'off',
      metrics: env['WV2_METRICS'] !== 'off',
    },
  });
}

/** Translate the config's retry overrides into declarative manifest policies (or none). */
export function retryPolicies(config: RuntimeConfig): ManifestPolicies | undefined {
  const overrides = config.retryOverrides;
  if (overrides === undefined) return undefined;
  const delay = overrides.backoffMs ?? 0;
  const retry: RetryPolicy = {
    maxAttempts: overrides.maxAttempts ?? 1,
    backoff: delay > 0 ? 'fixed' : 'none',
    initialDelayMs: delay,
  };
  return { retry };
}
