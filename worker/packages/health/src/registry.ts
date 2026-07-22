import type { HealthCheck, HealthReport, HealthCheckResult, HealthStatus } from './types.js';
import { STATUS_SEVERITY } from './types.js';

/** The worse (more severe) of two statuses. */
export function worseStatus(a: HealthStatus, b: HealthStatus): HealthStatus {
  return STATUS_SEVERITY[a] >= STATUS_SEVERITY[b] ? a : b;
}

/**
 * Generic registry that runs registered health checks and aggregates them. The aggregate
 * status is the worst individual status (empty registry ⇒ `healthy`). A check that throws is
 * treated as `unhealthy` rather than crashing the report.
 */
export class HealthRegistry {
  private readonly checks = new Map<string, HealthCheck>();

  /** Register (or replace) a check by its unique name. */
  register(check: HealthCheck): void {
    this.checks.set(check.name, check);
  }

  /** Remove a check by name. Returns whether one was present. */
  unregister(name: string): boolean {
    return this.checks.delete(name);
  }

  get size(): number {
    return this.checks.size;
  }

  /** Run all checks (in parallel) and produce an aggregate report. */
  async run(): Promise<HealthReport> {
    const entries = [...this.checks.values()];
    const results = await Promise.all(
      entries.map(async (c): Promise<{ name: string } & HealthCheckResult> => {
        try {
          const r = await c.check();
          return { name: c.name, ...r };
        } catch (cause) {
          return {
            name: c.name,
            status: 'unhealthy',
            detail: cause instanceof Error ? cause.message : 'check threw',
          };
        }
      }),
    );
    const status = results.reduce<HealthStatus>((acc, r) => worseStatus(acc, r.status), 'healthy');
    return { status, checks: results };
  }
}
