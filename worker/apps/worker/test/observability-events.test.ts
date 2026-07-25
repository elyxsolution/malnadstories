import { describe, it, expect } from 'vitest';
import {
  DefaultTracer,
  InMemoryMetricsProvider,
  MemoryLogSink,
  MemorySpanExporter,
  NoopTracer,
  ObservabilityEventSink,
  ObservabilityLogger,
  WORKER_METRICS,
} from '../src/observability/index.js';
import type { RecordedSample } from '@workerv2/metrics';
import { Pipeline } from '../src/processors/pipeline/pipeline.js';
import type { Stage } from '../src/processors/pipeline/pipeline.js';
import { RecoveryCoordinator } from '../src/recovery/coordinator.js';
import { CancellationSource } from '../src/recovery/cancellation.js';
import type {
  RecoverableProcessor,
  RecoveryItem,
  RecoveryResult,
} from '../src/recovery/recoverable.js';

/**
 * THE SINGLE INSTRUMENTATION POINT.
 *
 * These tests are the load-bearing ones for the phase's central claim: processing components emit
 * ONE event stream, and logs, metrics and traces are all DERIVED from it — so no processor contains
 * any logging, metrics or tracing code, and swapping a backend changes nothing but composition.
 */

interface Harness {
  sink: ObservabilityEventSink;
  logs: MemoryLogSink;
  metrics: InMemoryMetricsProvider;
  spans: MemorySpanExporter;
}

function harness(options: { tracing?: boolean } = {}): Harness {
  const logs = new MemoryLogSink();
  const logger = new ObservabilityLogger({ level: 'trace', sink: logs });
  const metrics = new InMemoryMetricsProvider();
  const spans = new MemorySpanExporter();
  let id = 0;
  const tracer =
    options.tracing === false
      ? new NoopTracer()
      : new DefaultTracer({ exporter: spans, ids: () => `id${(id += 1)}` });
  return { sink: new ObservabilityEventSink({ logger, metrics, tracer }), logs, metrics, spans };
}

function counters(metrics: InMemoryMetricsProvider, name: string): RecordedSample[] {
  return metrics.samples.filter((s) => s.name === name && s.type === 'counter');
}
function timings(metrics: InMemoryMetricsProvider, name: string): RecordedSample[] {
  return metrics.samples.filter((s) => s.name === name && s.type === 'timing');
}

/** A stage that records its name; optionally throws to exercise the failure path. */
function stage(name: string, boom = false): Stage<{ trail: string[] }, unknown> {
  return {
    name,
    run: async (ctx): Promise<{ trail: string[] }> => {
      if (boom) throw new Error(`${name} failed`);
      return { trail: [...ctx.trail, name] };
    },
  };
}

describe('events → traces: the trace shape IS the pipeline shape', () => {
  it('an image job produces a root span with one child span per stage', async () => {
    const h = harness();
    const stages = ['loading', 'validating', 'decoding', 'normalizing', 'finalizing'].map((n) =>
      stage(n),
    );
    const pipeline = new Pipeline(stages, {}, h.sink);

    await pipeline.run(
      { trail: [] },
      { processor: 'image-hardening', correlationId: 'c1', detail: { photoId: 'p1' } },
    );

    // Children complete before the root, so the root is last.
    expect(h.spans.names).toEqual([
      'loading',
      'validating',
      'decoding',
      'normalizing',
      'finalizing',
      'image-hardening',
    ]);
    const root = h.spans.spans.at(-1);
    expect(root?.context.parentSpanId).toBeUndefined();
    // Every stage span belongs to the job's trace and points at the root.
    for (const span of h.spans.spans.slice(0, -1)) {
      expect(span.context.traceId).toBe(root?.context.traceId);
      expect(span.context.parentSpanId).toBe(root?.context.spanId);
    }
  });

  it('a PDF job produces the render pipeline span shape', async () => {
    const h = harness();
    const stages = ['validate', 'snapshot', 'prepare', 'render', 'upload', 'finalize'].map((n) =>
      stage(n),
    );
    await new Pipeline(stages, {}, h.sink).run(
      { trail: [] },
      { processor: 'album-pdf', correlationId: 'c2', detail: { albumId: 'a1' } },
    );
    expect(h.spans.names).toEqual([
      'validate',
      'snapshot',
      'prepare',
      'render',
      'upload',
      'finalize',
      'album-pdf',
    ]);
  });

  it('a failing stage produces an errored stage span AND an errored root span', async () => {
    const h = harness();
    const pipeline = new Pipeline([stage('validate'), stage('render', true)], {}, h.sink);
    await expect(
      pipeline.run({ trail: [] }, { processor: 'album-pdf', correlationId: 'c3' }),
    ).rejects.toThrow('render failed');

    const render = h.spans.spans.find((s) => s.name === 'render');
    const root = h.spans.spans.find((s) => s.name === 'album-pdf');
    expect(render).toMatchObject({ status: 'error', error: 'render failed' });
    expect(root?.status).toBe('error');
  });

  it('releases all span state on every terminal outcome (no leak)', async () => {
    const h = harness();
    await new Pipeline([stage('a')], {}, h.sink).run(
      { trail: [] },
      { processor: 'p', correlationId: 'c4' },
    );
    expect(h.sink.openTraces).toBe(0);

    await expect(
      new Pipeline([stage('a', true)], {}, h.sink).run(
        { trail: [] },
        { processor: 'p', correlationId: 'c5' },
      ),
    ).rejects.toThrow();
    expect(h.sink.openTraces).toBe(0);

    // A processor that starts and then terminates without completing the pipeline also releases.
    h.sink.emit({ type: 'processor.started', processor: 'p', correlationId: 'c6', at: 'T' });
    expect(h.sink.openTraces).toBe(1);
    h.sink.emit({
      type: 'processor.skipped',
      processor: 'p',
      correlationId: 'c6',
      at: 'T',
      detail: { reason: 'superseded' },
    });
    expect(h.sink.openTraces).toBe(0);
  });
});

describe('events → metrics', () => {
  it('derives processor + stage counters and timings, tagged by low-cardinality dimensions', async () => {
    const h = harness();
    await new Pipeline([stage('loading'), stage('finalizing')], {}, h.sink).run(
      { trail: [] },
      { processor: 'image-hardening', correlationId: 'c1' },
    );

    expect(counters(h.metrics, WORKER_METRICS.processorStarted)).toHaveLength(1);
    expect(counters(h.metrics, WORKER_METRICS.processorCompleted)[0]?.tags).toEqual({
      processor: 'image-hardening',
    });
    expect(timings(h.metrics, WORKER_METRICS.processorDurationMs)).toHaveLength(1);

    const stageTimings = timings(h.metrics, WORKER_METRICS.stageDurationMs);
    expect(stageTimings.map((s) => s.tags['stage'])).toEqual(['loading', 'finalizing']);
    expect(stageTimings.every((s) => s.tags['processor'] === 'image-hardening')).toBe(true);

    // Correlation ids are never tags — that would be unbounded cardinality.
    expect(h.metrics.samples.every((s) => !('correlationId' in s.tags))).toBe(true);
  });

  it('counts terminal outcomes separately, bucketed by reason', () => {
    const h = harness();
    h.sink.emit({
      type: 'processor.rejected',
      processor: 'image-hardening',
      correlationId: 'c1',
      at: 'T',
      detail: { reason: 'bad_payload' },
    });
    h.sink.emit({
      type: 'processor.skipped',
      processor: 'album-pdf',
      correlationId: 'c2',
      at: 'T',
      detail: { reason: 'superseded' },
    });
    expect(counters(h.metrics, WORKER_METRICS.processorRejected)[0]?.tags).toEqual({
      processor: 'image-hardening',
      reason: 'bad_payload',
    });
    expect(counters(h.metrics, WORKER_METRICS.processorSkipped)[0]?.tags).toEqual({
      processor: 'album-pdf',
      reason: 'superseded',
    });
  });

  it('derives the cleanup counter + timing from the cleanup event alone', () => {
    const h = harness();
    h.sink.emit({
      type: 'cleanup.completed',
      processor: 'r2-cleanup',
      correlationId: 'c1',
      at: 'T',
      durationMs: 12,
      detail: { deleted: 7 },
    });
    expect(counters(h.metrics, WORKER_METRICS.cleanupObjectsRemoved)[0]?.value).toBe(7);
    expect(timings(h.metrics, WORKER_METRICS.cleanupDurationMs)[0]?.value).toBe(12);
  });

  it('derives every recovery metric the coordinator used to emit by hand', async () => {
    const h = harness();
    const coordinator = new RecoveryCoordinator({ events: h.sink, batchSize: 10 });
    coordinator.register(
      fakeRecoverable('image-hardening', [
        { kind: 'stale-pending', id: 'p1' },
        { kind: 'stale-pending', id: 'p2' },
      ]),
    );
    await coordinator.runOnce(new CancellationSource().token);

    expect(counters(h.metrics, WORKER_METRICS.recoveryStaleDetected)).toHaveLength(2);
    const outcomes = counters(h.metrics, WORKER_METRICS.recoveryOutcome);
    expect(outcomes.map((s) => s.tags['outcome'])).toEqual(['recovered', 'recovered']);
    expect(timings(h.metrics, WORKER_METRICS.recoverySweepDurationMs)).toHaveLength(1);
    expect(h.metrics.samples.filter((s) => s.name === WORKER_METRICS.recoveryBacklog)).toHaveLength(
      1,
    );
  });
});

describe('events → logs', () => {
  it('assigns severity by outcome, not by the emitter', async () => {
    const h = harness();
    await expect(
      new Pipeline([stage('render', true)], {}, h.sink).run(
        { trail: [] },
        { processor: 'album-pdf', correlationId: 'c1' },
      ),
    ).rejects.toThrow();

    const byMessage = new Map(h.logs.records.map((r) => [r.message, r.level]));
    expect(byMessage.get('processor.started')).toBe('info');
    expect(byMessage.get('stage.started')).toBe('trace');
    expect(byMessage.get('stage.failed')).toBe('warn');
    expect(byMessage.get('processor.failed')).toBe('error');
  });

  it('correlates every record with the processor, stage, correlation id and trace id', async () => {
    const h = harness();
    await new Pipeline([stage('loading')], {}, h.sink).run(
      { trail: [] },
      { processor: 'image-hardening', correlationId: 'req-42', detail: { photoId: 'p1' } },
    );
    const completed = h.logs.withMessage('stage.completed')[0];
    expect(completed).toMatchObject({
      processor: 'image-hardening',
      pipeline: 'image-hardening',
      stage: 'loading',
      correlationId: 'req-42',
    });
    expect(typeof completed?.traceId).toBe('string');
    expect(typeof completed?.durationMs).toBe('number');
    // The pipeline's run detail identifies the SUBJECT on every event.
    expect(completed?.detail).toMatchObject({ photoId: 'p1' });
  });

  it('a terminal domain result becomes span attributes and a log line', () => {
    const h = harness();
    h.sink.emit({
      type: 'processor.started',
      processor: 'image-hardening',
      correlationId: 'c',
      at: 'T',
    });
    h.sink.emit({
      type: 'processor.result',
      processor: 'image-hardening',
      correlationId: 'c',
      at: 'T',
      detail: { photoId: 'p1', width: 4000, height: 3000 },
    });
    h.sink.emit({
      type: 'processor.completed',
      processor: 'image-hardening',
      correlationId: 'c',
      at: 'T',
    });

    expect(h.logs.withMessage('processor.result')[0]?.detail).toMatchObject({
      width: 4000,
      height: 3000,
    });
    expect(h.spans.spans.at(-1)?.attributes).toMatchObject({ width: 4000, height: 3000 });
  });
});

describe('the sink never destabilises processing', () => {
  it('swallows a metrics backend failure', () => {
    const logs = new MemoryLogSink();
    const sink = new ObservabilityEventSink({
      logger: new ObservabilityLogger({ level: 'trace', sink: logs }),
      metrics: {
        counter: (): void => {
          throw new Error('metrics down');
        },
        gauge: (): void => {},
        histogram: (): void => {},
        timing: (): void => {},
      },
      tracer: new NoopTracer(),
    });
    expect(() =>
      sink.emit({ type: 'processor.started', processor: 'p', correlationId: 'c', at: 'T' }),
    ).not.toThrow();
  });

  it('works with tracing disabled, still producing logs and metrics', async () => {
    const h = harness({ tracing: false });
    await new Pipeline([stage('a')], {}, h.sink).run(
      { trail: [] },
      { processor: 'p', correlationId: 'c' },
    );
    expect(h.spans.spans).toHaveLength(0);
    expect(counters(h.metrics, WORKER_METRICS.processorCompleted)).toHaveLength(1);
    expect(h.logs.withMessage('processor.completed')).toHaveLength(1);
    expect(h.logs.withMessage('processor.completed')[0]?.traceId).toBeUndefined();
  });
});

function fakeRecoverable(name: string, items: RecoveryItem[]): RecoverableProcessor {
  return {
    name,
    detectStale: async (): Promise<readonly RecoveryItem[]> => items,
    recover: async (): Promise<RecoveryResult> => ({ outcome: 'recovered' }),
  };
}
