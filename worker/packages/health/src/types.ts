import type { JsonObject } from '@workerv2/contracts';

/** Aggregate/individual health state, ordered best→worst by `STATUS_SEVERITY`. */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export const STATUS_SEVERITY: Readonly<Record<HealthStatus, number>> = {
  healthy: 0,
  degraded: 1,
  unhealthy: 2,
};

/** Outcome of a single check. */
export interface HealthCheckResult {
  readonly status: HealthStatus;
  /** Optional human/diagnostic note (sanitized — no secrets/PII). */
  readonly detail?: string;
  /** Optional JSON-safe diagnostic data. */
  readonly data?: JsonObject;
}

/** A named, generic health check. Implementations must not throw — return `unhealthy`. */
export interface HealthCheck {
  readonly name: string;
  check(): Promise<HealthCheckResult> | HealthCheckResult;
}

/** Aggregate report over all registered checks. */
export interface HealthReport {
  readonly status: HealthStatus;
  readonly checks: ReadonlyArray<{ readonly name: string } & HealthCheckResult>;
}
