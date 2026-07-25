import type { StructuredLogger } from '@workerv2/worker-runtime';
import { CancellationSource } from './cancellation.js';
import type { CancellationToken } from './cancellation.js';

/**
 * PERIODIC SCHEDULER — runs a task on a jittered interval WITHOUT busy-looping (each run schedules the
 * next via a single `setTimeout`). It supports configurable interval, random jitter (so multiple workers
 * don't sweep in lockstep), exponential backoff on consecutive failures, cancellation, and graceful
 * shutdown (the in-flight run is cancelled + awaited before `stop()` resolves). The task never overlaps
 * itself — the next run is scheduled only after the current one settles.
 */

export interface SchedulerOptions {
  /** Base delay between runs (ms). */
  readonly intervalMs: number;
  /** Random extra delay added per run, 0..jitterMs (ms). */
  readonly jitterMs?: number;
  /** Multiplier applied per consecutive failure (delay grows up to `maxBackoffMs`). */
  readonly backoffFactor?: number;
  readonly maxBackoffMs?: number;
  readonly logger: StructuredLogger;
  /** Injectable delay (tests). Resolves after `ms`; must reject/resolve early is not required. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Read-only scheduler state. EXPOSED, not logged: the scheduler reports what it is doing and the
 * observability layer's `recoverySchedulerProbe` decides what that means for health (repeated
 * failures ⇒ `degraded`). Structurally compatible with `probes.ts`'s `SchedulerStats`, without the
 * recovery layer having to depend on the observability layer.
 */
export interface SchedulerStats {
  readonly running: boolean;
  readonly consecutiveFailures: number;
  /** ISO-8601 time the last run finished, or `null` before the first run. */
  readonly lastRunAt: string | null;
  readonly lastError: string | null;
}

export class PeriodicScheduler {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> = Promise.resolve();
  private consecutiveFailures = 0;
  private lastRunAt: string | null = null;
  private lastError: string | null = null;
  private source: CancellationSource | null = null;
  private readonly jitterMs: number;
  private readonly backoffFactor: number;
  private readonly maxBackoffMs: number;

  constructor(
    private readonly task: (token: CancellationToken) => Promise<void>,
    private readonly opts: SchedulerOptions,
  ) {
    this.jitterMs = opts.jitterMs ?? 0;
    this.backoffFactor = opts.backoffFactor ?? 2;
    this.maxBackoffMs = opts.maxBackoffMs ?? opts.intervalMs * 10;
  }

  /** Current scheduler state, for the health probe + diagnostics. */
  get stats(): SchedulerStats {
    return {
      running: this.running,
      consecutiveFailures: this.consecutiveFailures,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
    };
  }

  /** Begin scheduling. The first run fires after one interval (+jitter). Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  /** Stop scheduling: cancel the in-flight run, clear the timer, and await the run's completion. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.source?.cancel();
    await this.inFlight;
  }

  private scheduleNext(): void {
    if (!this.running) return;
    const delay = this.nextDelay();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.inFlight = this.runOnce();
    }, delay);
    // Don't keep the event loop alive solely for the sweep timer.
    this.timer.unref?.();
  }

  private async runOnce(): Promise<void> {
    if (!this.running) return;
    const source = new CancellationSource();
    this.source = source;
    try {
      await this.task(source.token);
      this.consecutiveFailures = 0;
      this.lastError = null;
    } catch (error) {
      this.consecutiveFailures += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.opts.logger.log({
        level: 'warning',
        message: 'scheduler.task_failed',
        detail: { consecutiveFailures: this.consecutiveFailures, error: this.lastError },
      });
    } finally {
      this.lastRunAt = new Date().toISOString();
      this.source = null;
      this.scheduleNext(); // no overlap: schedule the next only after this settles
    }
  }

  private nextDelay(): number {
    const backoff =
      this.consecutiveFailures === 0
        ? this.opts.intervalMs
        : Math.min(
            this.opts.intervalMs * this.backoffFactor ** this.consecutiveFailures,
            this.maxBackoffMs,
          );
    return backoff + Math.floor(Math.random() * (this.jitterMs + 1));
  }
}
