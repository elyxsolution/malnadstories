import { describe, it, expect, vi } from 'vitest';
import { RecordingLogger } from '@workerv2/worker-runtime';
import { CancellationSource, CancellationError } from '../src/recovery/cancellation.js';
import { RecordingMetricsSink, METRICS } from '../src/recovery/metrics.js';
import { PeriodicScheduler } from '../src/recovery/scheduler.js';
import { RecoveryCoordinator } from '../src/recovery/coordinator.js';
import type {
  RecoverableProcessor,
  RecoveryItem,
  RecoveryOutcome,
} from '../src/recovery/recoverable.js';
import type { ProcessorEvent, ProcessorEventSink } from '../src/processors/pipeline/events.js';

class RecordingSink implements ProcessorEventSink {
  readonly events: ProcessorEvent[] = [];
  emit(event: ProcessorEvent): void {
    this.events.push(event);
  }
  typesFor(prefix: string): string[] {
    return this.events.filter((e) => e.type.startsWith(prefix)).map((e) => e.type);
  }
}

class FakeRecoverable implements RecoverableProcessor {
  constructor(
    readonly name: string,
    private readonly items: RecoveryItem[],
    private readonly outcomes: Record<string, RecoveryOutcome> = {},
    private readonly throwOn?: string,
  ) {}
  async detectStale(): Promise<readonly RecoveryItem[]> {
    return this.items;
  }
  async recover(item: RecoveryItem): Promise<{ outcome: RecoveryOutcome }> {
    if (item.id === this.throwOn) throw new Error('recover boom');
    return { outcome: this.outcomes[item.id] ?? 'recovered' };
  }
}

describe('CancellationSource', () => {
  it('flips cancelled, throws on demand, and fires callbacks', () => {
    const src = new CancellationSource();
    let fired = 0;
    src.token.onCancel(() => (fired += 1));
    expect(src.token.cancelled).toBe(false);
    src.token.throwIfCancelled(); // no throw
    src.cancel();
    expect(src.token.cancelled).toBe(true);
    expect(() => src.token.throwIfCancelled()).toThrow(CancellationError);
    expect(fired).toBe(1);
    // onCancel after cancellation fires immediately; cancel is idempotent
    src.token.onCancel(() => (fired += 1));
    src.cancel();
    expect(fired).toBe(2);
  });
});

describe('RecordingMetricsSink', () => {
  it('accumulates counters (with tags) and records observations', () => {
    const m = new RecordingMetricsSink();
    m.increment(METRICS.jobsRecovered, 1, { processor: 'image-hardening' });
    m.increment(METRICS.jobsRecovered, 2, { processor: 'image-hardening' });
    m.increment(METRICS.jobsRecovered, 1, { processor: 'album-pdf' });
    m.observe(METRICS.sweepDurationMs, 42);
    expect(m.counter(METRICS.jobsRecovered, { processor: 'image-hardening' })).toBe(3);
    expect(m.counter(METRICS.jobsRecovered, { processor: 'album-pdf' })).toBe(1);
    expect(m.observations).toContainEqual({ name: METRICS.sweepDurationMs, value: 42 });
  });
});

describe('PeriodicScheduler', () => {
  it('runs the task periodically (jittered, no busy-loop) and stops gracefully', async () => {
    vi.useFakeTimers();
    try {
      let runs = 0;
      const scheduler = new PeriodicScheduler(
        async () => {
          runs += 1;
        },
        { intervalMs: 1000, jitterMs: 0, logger: new RecordingLogger() },
      );
      scheduler.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(runs).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(runs).toBe(2);
      await scheduler.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(runs).toBe(2); // no runs after stop
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RecoveryCoordinator', () => {
  // Phase I-4: the coordinator takes ONLY an event sink. Its metrics + logger dependencies are gone
  // — the observability layer derives both from this one stream (see observability-events.test.ts).
  function build(): { coordinator: RecoveryCoordinator; sink: RecordingSink } {
    const sink = new RecordingSink();
    const coordinator = new RecoveryCoordinator({ events: sink, batchSize: 100 });
    return { coordinator, sink };
  }

  it('detects + heals each item, emitting the full event stream', async () => {
    const { coordinator, sink } = build();
    coordinator.register(
      new FakeRecoverable('image-hardening', [
        { kind: 'stale-pending', id: 'p1' },
        { kind: 'orphan-raw', id: 'p2' },
      ]),
    );
    const source = new CancellationSource();
    const summary = await coordinator.runOnce(source.token);

    expect(summary.recovered).toBe(2);
    expect(sink.typesFor('recovery.')).toEqual([
      'recovery.started',
      'recovery.completed',
      'recovery.started',
      'recovery.completed',
      'recovery.sweep', // Phase I-4: one sweep-level event carrying the aggregate totals
    ]);
    // The per-item outcome now travels on the event, which is what the metrics are derived from.
    const completed = sink.events.filter((e) => e.type === 'recovery.completed');
    expect(completed.map((e) => e.detail?.['outcome'])).toEqual(['recovered', 'recovered']);
    // One sweep-level event carries the aggregate totals + duration.
    const sweep = sink.events.find((e) => e.type === 'recovery.sweep');
    expect(sweep?.detail).toMatchObject({ recovered: 2, detected: 2 });
    expect(typeof sweep?.durationMs).toBe('number');
    expect(coordinator.backlog).toBe(2);
  });

  it('tallies mixed outcomes (recovered / abandoned / already-healed / skipped)', async () => {
    const { coordinator } = build();
    coordinator.register(
      new FakeRecoverable(
        'album-pdf',
        [
          { kind: 'x', id: 'a' },
          { kind: 'x', id: 'b' },
          { kind: 'x', id: 'c' },
          { kind: 'x', id: 'd' },
        ],
        { a: 'recovered', b: 'abandoned', c: 'already-healed', d: 'skipped' },
      ),
    );
    const summary = await coordinator.runOnce(new CancellationSource().token);
    expect(summary).toMatchObject({
      recovered: 1,
      abandoned: 1,
      alreadyHealed: 1,
      skipped: 1,
      failed: 0,
    });
  });

  it('records a failed heal without aborting the sweep', async () => {
    const { coordinator, sink } = build();
    coordinator.register(
      new FakeRecoverable(
        'album-pdf',
        [
          { kind: 'x', id: 'boom' },
          { kind: 'x', id: 'ok' },
        ],
        {},
        'boom',
      ),
    );
    const summary = await coordinator.runOnce(new CancellationSource().token);
    expect(summary.failed).toBe(1);
    expect(summary.recovered).toBe(1); // the sweep continued to the next item
    expect(sink.typesFor('recovery.failed')).toHaveLength(1);
  });

  it('stops promptly when cancelled', async () => {
    const { coordinator } = build();
    const source = new CancellationSource();
    source.cancel(); // cancelled before the sweep starts
    coordinator.register(new FakeRecoverable('image-hardening', [{ kind: 'x', id: 'p1' }]));
    const summary = await coordinator.runOnce(source.token);
    expect(summary.recovered).toBe(0); // nothing processed
  });
});
