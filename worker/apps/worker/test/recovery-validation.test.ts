import { describe, it, expect } from 'vitest';
import { noopLogger } from '@workerv2/worker-runtime';
import { RecoveryCoordinator } from '../src/recovery/coordinator.js';
import { PeriodicScheduler } from '../src/recovery/scheduler.js';
import { CancellationError, CancellationSource } from '../src/recovery/cancellation.js';
import type { CancellationToken } from '../src/recovery/cancellation.js';
import type {
  RecoverableProcessor,
  RecoveryItem,
  RecoveryResult,
} from '../src/recovery/recoverable.js';
import type { ProcessorEvent, ProcessorEventSink } from '../src/processors/pipeline/events.js';
import { ConcurrencyController, DEFAULT_LANE } from '../src/concurrency.js';
import { IMAGE, PDF, sleep } from '../src/testing/index.js';

/**
 * RECOVERY VALIDATION — the self-healing layer under stress.
 *
 * The properties that matter operationally: recovery is BOUNDED (a huge backlog cannot turn one
 * sweep into a full scan), IDEMPOTENT (two coordinators, or a re-run after a crash, heal the same
 * item safely), INTERRUPTIBLE (shutdown does not wait for a sweep to finish), and DEFERENTIAL (it
 * yields to live customer work rather than competing with it).
 */

class RecordingSink implements ProcessorEventSink {
  readonly events: ProcessorEvent[] = [];
  emit(event: ProcessorEvent): void {
    this.events.push(event);
  }
  typesFor(prefix: string): string[] {
    return this.events.filter((e) => e.type.startsWith(prefix)).map((e) => e.type);
  }
}

/** A recoverable processor over a shared pool of stale ids, healing idempotently. */
class PooledRecoverable implements RecoverableProcessor {
  detectCalls = 0;
  readonly healed: string[] = [];
  /** Ids healed by ANY coordinator — shared, so idempotency across coordinators is observable. */
  constructor(
    readonly name: string,
    private readonly stale: Set<string>,
    private readonly healedGlobally: Set<string> = new Set(),
    private readonly perItemDelayMs = 0,
  ) {}

  async detectStale(limit: number, token: CancellationToken): Promise<readonly RecoveryItem[]> {
    this.detectCalls += 1;
    token.throwIfCancelled();
    // BOUNDED by construction: never more than `limit`, whatever the backlog.
    return [...this.stale].slice(0, limit).map((id) => ({ kind: 'stale', id }));
  }

  async recover(item: RecoveryItem, token: CancellationToken): Promise<RecoveryResult> {
    token.throwIfCancelled();
    if (this.perItemDelayMs > 0) await sleep(this.perItemDelayMs);
    token.throwIfCancelled();
    if (this.healedGlobally.has(item.id)) return { outcome: 'already-healed' };
    this.healedGlobally.add(item.id);
    this.healed.push(item.id);
    this.stale.delete(item.id);
    return { outcome: 'recovered' };
  }
}

describe('recovery at scale', () => {
  it('bounds each sweep, so thousands of stale items never become a full scan', async () => {
    const stale = new Set(Array.from({ length: 5_000 }, (_, i) => `photo-${i}`));
    const sink = new RecordingSink();
    const processor = new PooledRecoverable(IMAGE, stale);
    const coordinator = new RecoveryCoordinator({ events: sink, batchSize: 100 });
    coordinator.register(processor);

    const summary = await coordinator.runOnce(new CancellationSource().token);

    expect(summary.recovered).toBe(100); // exactly the batch, not 5,000
    expect(stale.size).toBe(4_900);
    expect(coordinator.backlog).toBe(100);
  });

  it('drains a large backlog across repeated sweeps', async () => {
    const stale = new Set(Array.from({ length: 1_000 }, (_, i) => `photo-${i}`));
    const processor = new PooledRecoverable(IMAGE, stale);
    const coordinator = new RecoveryCoordinator({ events: new RecordingSink(), batchSize: 100 });
    coordinator.register(processor);

    for (let sweep = 0; sweep < 10; sweep += 1) {
      await coordinator.runOnce(new CancellationSource().token);
    }

    expect(stale.size).toBe(0);
    expect(processor.healed).toHaveLength(1_000);
    expect(new Set(processor.healed).size).toBe(1_000); // each healed exactly once
  });

  it('repeated sweeps over an ALREADY healed pool are cheap no-ops', async () => {
    const stale = new Set(['a', 'b', 'c']);
    const coordinator = new RecoveryCoordinator({ events: new RecordingSink(), batchSize: 50 });
    coordinator.register(new PooledRecoverable(IMAGE, stale));

    await coordinator.runOnce(new CancellationSource().token);
    const second = await coordinator.runOnce(new CancellationSource().token);

    expect(second.recovered).toBe(0);
    expect(second.alreadyHealed + second.skipped).toBe(0); // nothing left to detect
    expect(coordinator.backlog).toBe(0);
  });
});

describe('multiple coordinators (horizontal scaling of recovery)', () => {
  it('two coordinators over the same backlog heal each item exactly once', async () => {
    const stale = new Set(Array.from({ length: 200 }, (_, i) => `photo-${i}`));
    const healedGlobally = new Set<string>();

    const build = (): RecoveryCoordinator => {
      const coordinator = new RecoveryCoordinator({
        events: new RecordingSink(),
        batchSize: 200,
      });
      coordinator.register(new PooledRecoverable(IMAGE, stale, healedGlobally));
      return coordinator;
    };

    const [a, b] = await Promise.all([
      build().runOnce(new CancellationSource().token),
      build().runOnce(new CancellationSource().token),
    ]);

    // Between them they heal all 200, and the overlap is reported as `already-healed` rather than
    // being healed twice — the idempotency contract holding under concurrency.
    expect(healedGlobally.size).toBe(200);
    expect(a.recovered + b.recovered).toBe(200);
    expect(a.recovered + a.alreadyHealed + b.recovered + b.alreadyHealed).toBeGreaterThanOrEqual(
      200,
    );
  });

  it('a failing processor never aborts the sweep for the others', async () => {
    const sink = new RecordingSink();
    const healthy = new PooledRecoverable(PDF, new Set(['album-1']));
    const broken: RecoverableProcessor = {
      name: IMAGE,
      detectStale: async () => {
        throw new Error('database unreachable');
      },
      recover: async () => ({ outcome: 'skipped' }),
    };
    const coordinator = new RecoveryCoordinator({ events: sink, batchSize: 10 });
    coordinator.register(broken).register(healthy);

    const summary = await coordinator.runOnce(new CancellationSource().token);

    expect(summary.recovered).toBe(1); // the healthy processor still ran
    expect(
      sink.events.some((e) => e.type === 'recovery.failed' && e.detail?.['phase'] === 'detect'),
    ).toBe(true);
  });
});

describe('recovery interruption + restart', () => {
  it('stops promptly when cancelled mid-sweep, leaving the rest for the next pass', async () => {
    const stale = new Set(Array.from({ length: 50 }, (_, i) => `p${i}`));
    const processor = new PooledRecoverable(IMAGE, stale, new Set(), 2);
    const coordinator = new RecoveryCoordinator({ events: new RecordingSink(), batchSize: 50 });
    coordinator.register(processor);

    const source = new CancellationSource();
    setTimeout(() => source.cancel(), 15);
    const summary = await coordinator.runOnce(source.token);

    expect(summary.recovered).toBeGreaterThan(0); // some progress made
    expect(summary.recovered).toBeLessThan(50); // aborted early
    expect(stale.size).toBeGreaterThan(0); // the remainder is simply still stale

    // A restart picks up exactly where it left off, with no special resume logic: the next sweep
    // heals precisely the items the cancelled one did not reach.
    const remaining = stale.size;
    const resumed = await coordinator.runOnce(new CancellationSource().token);
    expect(resumed.recovered).toBe(remaining);
    expect(stale.size).toBe(0);
    expect(processor.healed).toHaveLength(50);
    expect(new Set(processor.healed).size).toBe(50); // nothing healed twice across the interruption
  }, 20_000);

  it('a cancelled sweep is reported, not swallowed', async () => {
    const sink = new RecordingSink();
    const coordinator = new RecoveryCoordinator({ events: sink, batchSize: 10 });
    coordinator.register(new PooledRecoverable(IMAGE, new Set(['a', 'b']), new Set(), 5));

    const source = new CancellationSource();
    source.cancel();
    await coordinator.runOnce(source.token);

    const sweep = sink.events.find((e) => e.type === 'recovery.sweep');
    expect(sweep?.detail).toMatchObject({ cancelled: true });
  });

  it('the scheduler cancels and awaits an in-flight sweep on stop (no orphaned work)', async () => {
    const stale = new Set(Array.from({ length: 100 }, (_, i) => `p${i}`));
    const processor = new PooledRecoverable(IMAGE, stale, new Set(), 2);
    const coordinator = new RecoveryCoordinator({ events: new RecordingSink(), batchSize: 100 });
    coordinator.register(processor);

    let settled = false;
    const scheduler = new PeriodicScheduler(
      async (token) => {
        await coordinator.runOnce(token);
        settled = true;
      },
      { intervalMs: 5, jitterMs: 0, logger: noopLogger },
    );

    scheduler.start();
    await sleep(30); // let a sweep get going
    await scheduler.stop(); // must cancel AND await

    expect(settled).toBe(true); // the run completed rather than being orphaned
    expect(scheduler.stats.running).toBe(false);
  }, 20_000);

  it('a sweep that throws is recorded and backs off without stopping the scheduler', async () => {
    let attempts = 0;
    const scheduler = new PeriodicScheduler(
      async () => {
        attempts += 1;
        throw new Error('sweep exploded');
      },
      { intervalMs: 5, jitterMs: 0, logger: noopLogger },
    );
    scheduler.start();
    await sleep(60);
    await scheduler.stop();

    expect(attempts).toBeGreaterThan(0);
    expect(scheduler.stats.consecutiveFailures).toBeGreaterThan(0);
    expect(scheduler.stats.lastError).toBe('sweep exploded');
  }, 20_000);
});

describe('recovery under production load', () => {
  const config = {
    maxInFlight: 4,
    defaultLane: DEFAULT_LANE,
    lanes: { [IMAGE]: { min: 1, max: 4 } },
    recoveryQuietFraction: 0.5,
  };

  it('DEFERS sweeps while the worker is busy, and resumes when it quietens', async () => {
    const controller = new ConcurrencyController({ config, pressure: () => 'normal' });
    let sweeps = 0;
    const scheduler = new PeriodicScheduler(
      async () => {
        if (!controller.allowRecovery()) return; // the production throttle, verbatim
        sweeps += 1;
      },
      { intervalMs: 3, jitterMs: 0, logger: noopLogger },
    );

    // Saturate the worker: 3 of 4 slots busy is above the 50% quiet threshold.
    controller.acquire(IMAGE);
    controller.acquire(IMAGE);
    controller.acquire(IMAGE);

    scheduler.start();
    await sleep(40);
    const duringLoad = sweeps;

    controller.release(IMAGE);
    controller.release(IMAGE);
    controller.release(IMAGE);
    await sleep(40);
    await scheduler.stop();

    expect(duringLoad).toBe(0); // never competed with live work
    expect(sweeps).toBeGreaterThan(0); // resumed on its own once load dropped
  }, 20_000);

  it('recovery and processing can run together when there is headroom', async () => {
    const controller = new ConcurrencyController({ config, pressure: () => 'normal' });
    controller.acquire(IMAGE); // 1 of 4 — comfortably quiet
    expect(controller.allowRecovery()).toBe(true);
    expect(controller.admits(IMAGE)).toBe(true); // and the worker still takes new jobs
  });
});

describe('recovery cancellation semantics', () => {
  it('a cancelled recover() surfaces CancellationError, not a spurious failure', async () => {
    const source = new CancellationSource();
    source.cancel();
    const processor = new PooledRecoverable(IMAGE, new Set(['a']));
    await expect(
      processor.recover({ kind: 'stale', id: 'a' }, source.token),
    ).rejects.toBeInstanceOf(CancellationError);
  });
});
