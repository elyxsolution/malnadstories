import type { WorkerLogger } from './logging.js';
import { errorMessage } from './model.js';

/**
 * STARTUP DIAGNOSTICS — one ordered pass of validation checks producing ONE startup report, and a
 * hard stop on any critical failure.
 *
 * Before this phase, startup validation was scattered: config threw from `loadAppConfig`, the
 * infrastructure preflight logged three separate lines and threw its own error type, processor and
 * recovery registration were silent, and Chromium was never checked at all — so a misconfigured
 * deployment failed in pieces, at different times, with different shapes. Here every check is a
 * uniform `StartupCheck`, they run in a deterministic order, and the operator gets a single
 * structured record listing every check with its outcome and duration.
 *
 * FAIL FAST, BUT ONLY ON WHAT MATTERS. A `critical` check that fails aborts the boot — a worker
 * that cannot reach Postgres must not sit in a crash loop pretending to be healthy. A non-critical
 * check that fails downgrades the report to `warn` and the worker starts anyway: Chromium missing
 * means PDF rendering is unavailable, NOT that image hardening should stop working. That is the
 * graceful-degradation policy, stated declaratively at the point of composition.
 *
 * Checks run SEQUENTIALLY and stop at the first critical failure. Connectivity checks have side
 * effects (opening pools, declaring queues) whose ordering matters, and there is no value in
 * probing R2 when the database was already unreachable.
 */

export type StartupOutcome = 'pass' | 'warn' | 'fail';

export interface StartupCheckResult {
  readonly status: StartupOutcome;
  /** Short operator-facing note. Sanitized — never secrets. */
  readonly detail?: string;
  /** Small JSON-safe diagnostic bag. */
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface StartupCheck {
  readonly name: string;
  /** A failing critical check aborts startup; a failing non-critical one only warns. */
  readonly critical: boolean;
  run(): Promise<StartupCheckResult> | StartupCheckResult;
}

export interface StartupCheckReport extends StartupCheckResult {
  readonly name: string;
  readonly critical: boolean;
  readonly durationMs: number;
}

export interface StartupReport {
  /** Worst outcome across all checks. */
  readonly overall: StartupOutcome;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly checks: readonly StartupCheckReport[];
}

/** Thrown when a critical startup check fails. The process exits on it. */
export class StartupError extends Error {
  constructor(
    readonly check: string,
    detail: string,
    readonly report: StartupReport,
  ) {
    super(`Startup check "${check}" failed: ${detail}`);
    this.name = 'StartupError';
  }
}

/** Convenience results, so check bodies stay one-liners. */
export const PASS: StartupCheckResult = { status: 'pass' };
export function pass(data?: Record<string, unknown>): StartupCheckResult {
  return data === undefined ? PASS : { status: 'pass', data };
}
export function warn(detail: string, data?: Record<string, unknown>): StartupCheckResult {
  return { status: 'warn', detail, ...(data === undefined ? {} : { data }) };
}
export function fail(detail: string, data?: Record<string, unknown>): StartupCheckResult {
  return { status: 'fail', detail, ...(data === undefined ? {} : { data }) };
}

const SEVERITY: Readonly<Record<StartupOutcome, number>> = { pass: 0, warn: 1, fail: 2 };

/** Collects checks, runs them in registration order, and reports once. */
export class StartupDiagnostics {
  private readonly checks: StartupCheck[] = [];

  constructor(
    private readonly logger: WorkerLogger,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Register a check. Order is significant — connectivity checks have ordering side effects. */
  add(check: StartupCheck): this {
    this.checks.push(check);
    return this;
  }

  /**
   * Add a check from a plain probe function. A thrown error becomes a failure with its message, so
   * a check body never needs its own try/catch.
   */
  check(
    name: string,
    critical: boolean,
    run: () => Promise<StartupCheckResult> | StartupCheckResult,
  ): this {
    return this.add({ name, critical, run });
  }

  /** The registered check names, in run order (used by tests + the diagnostics report). */
  get names(): readonly string[] {
    return this.checks.map((c) => c.name);
  }

  /**
   * Run every check in order, emit ONE structured `worker.startup.report` record, and return it.
   * Throws `StartupError` on the first critical failure — the report is attached to the error, so
   * the failure log still shows everything that ran before it.
   */
  async run(): Promise<StartupReport> {
    const begin = this.clock();
    const startedAt = new Date(begin).toISOString();
    const results: StartupCheckReport[] = [];
    let failure: { check: string; detail: string } | null = null;

    for (const check of this.checks) {
      const checkStart = this.clock();
      let result: StartupCheckResult;
      try {
        result = await check.run();
      } catch (error) {
        result = fail(errorMessage(error));
      }
      const report: StartupCheckReport = {
        name: check.name,
        critical: check.critical,
        status: result.status,
        ...(result.detail === undefined ? {} : { detail: result.detail }),
        ...(result.data === undefined ? {} : { data: result.data }),
        durationMs: Math.max(0, this.clock() - checkStart),
      };
      results.push(report);

      if (result.status === 'fail' && check.critical) {
        failure = { check: check.name, detail: result.detail ?? 'check failed' };
        break; // stop: later checks would probe infrastructure we already know is unreachable
      }
    }

    // A non-critical failure must not poison the overall verdict past `warn` — the worker starts.
    const overall = results.reduce<StartupOutcome>((worst, r) => {
      const effective: StartupOutcome = r.status === 'fail' && !r.critical ? 'warn' : r.status;
      return SEVERITY[effective] > SEVERITY[worst] ? effective : worst;
    }, 'pass');

    const report: StartupReport = {
      overall,
      startedAt,
      durationMs: Math.max(0, this.clock() - begin),
      checks: results,
    };

    this.logger.log(
      overall === 'fail' ? 'fatal' : overall === 'warn' ? 'warn' : 'info',
      'worker.startup.report',
      {
        overall,
        durationMs: report.durationMs,
        checks: results.map((r) => ({
          name: r.name,
          status: r.status,
          durationMs: r.durationMs,
          ...(r.detail === undefined ? {} : { detail: r.detail }),
        })),
      },
    );

    if (failure !== null) throw new StartupError(failure.check, failure.detail, report);
    return report;
  }
}
