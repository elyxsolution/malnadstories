import { describe, it, expect } from 'vitest';
import {
  DefaultTracer,
  LoggingSpanExporter,
  MemoryLogSink,
  MemorySpanExporter,
  NOOP_SPAN,
  NoopTracer,
  ObservabilityLogger,
  spanFields,
} from '../src/observability/index.js';

/** Deterministic ids + clock, so span trees and durations are exactly assertable. */
function build(sampleRatio = 1): { tracer: DefaultTracer; spans: MemorySpanExporter } {
  const spans = new MemorySpanExporter();
  let id = 0;
  let now = 1_000;
  const tracer = new DefaultTracer({
    exporter: spans,
    ids: () => `id${(id += 1)}`,
    clock: () => (now += 10),
    sampleRatio,
    random: () => 0.5,
  });
  return { tracer, spans };
}

describe('tracing — span tree', () => {
  it('a root span starts a new trace; children inherit the trace and record their parent', () => {
    const { tracer, spans } = build();
    const root = tracer.startSpan('album-pdf');
    const child = tracer.startSpan('render', { parent: root });
    child.end();
    root.end();

    expect(spans.names).toEqual(['render', 'album-pdf']); // children finish first
    const [rendered, album] = spans.spans;
    expect(rendered?.context.traceId).toBe(album?.context.traceId);
    expect(rendered?.context.parentSpanId).toBe(album?.context.spanId);
    expect(album?.context.parentSpanId).toBeUndefined();
  });

  it('records duration, attributes and status', () => {
    const { tracer, spans } = build();
    const span = tracer.startSpan('render', { attributes: { processor: 'album-pdf' } });
    span.setAttribute('pages', 24);
    span.end();

    expect(spans.spans[0]).toMatchObject({
      name: 'render',
      status: 'ok',
      attributes: { processor: 'album-pdf', pages: 24 },
    });
    expect(spans.spans[0]?.durationMs).toBeGreaterThan(0);
  });

  it('recordError marks the span failed and captures a sanitized message', () => {
    const { tracer, spans } = build();
    const span = tracer.startSpan('upload');
    span.recordError(new Error('r2 down'));
    span.end();
    expect(spans.spans[0]).toMatchObject({ status: 'error', error: 'r2 down' });
  });

  it('end() is idempotent — a stage that fails and then unwinds exports once', () => {
    const { tracer, spans } = build();
    const span = tracer.startSpan('validate');
    span.end();
    span.end();
    span.end();
    expect(spans.spans).toHaveLength(1);
    expect(span.ended).toBe(true);
  });

  it('ignores mutation after end rather than throwing', () => {
    const { tracer, spans } = build();
    const span = tracer.startSpan('validate');
    span.end();
    expect(() => {
      span.setAttribute('late', 1);
      span.setStatus('error');
      span.recordError(new Error('late'));
    }).not.toThrow();
    expect(spans.spans[0]?.attributes).toEqual({});
  });
});

describe('tracing — sampling + no-op', () => {
  it('head sampling keeps a trace WHOLE: a sampled-out root drops its children too', () => {
    const { tracer, spans } = build(0); // never sample
    const root = tracer.startSpan('album-pdf');
    const child = tracer.startSpan('render', { parent: root });
    child.end();
    root.end();
    expect(spans.spans).toHaveLength(0);
    expect(root).toBe(NOOP_SPAN);
    expect(child).toBe(NOOP_SPAN);
  });

  it('the no-op tracer allocates nothing per operation', () => {
    const tracer = new NoopTracer();
    expect(tracer.enabled).toBe(false);
    expect(tracer.startSpan('x')).toBe(NOOP_SPAN);
    expect(tracer.startSpan('y')).toBe(tracer.startSpan('z')); // one shared instance
    expect(() => tracer.startSpan('x').end()).not.toThrow();
  });

  it('spanFields yields correlation ids for a real span and nothing for a no-op one', () => {
    const { tracer } = build();
    const span = tracer.startSpan('x');
    expect(spanFields(span)).toEqual({ traceId: 'id1', spanId: 'id2' });
    expect(spanFields(NOOP_SPAN)).toEqual({});
    expect(spanFields(undefined)).toEqual({});
  });
});

describe('tracing — exporters are replaceable backends', () => {
  it('the logging exporter turns spans into structured records', () => {
    const sink = new MemoryLogSink();
    const logger = new ObservabilityLogger({ level: 'debug', sink });
    const spans = new MemorySpanExporter();
    const tracer = new DefaultTracer({ exporter: new LoggingSpanExporter(logger) });

    tracer.startSpan('render', { attributes: { processor: 'album-pdf' } }).end();

    const record = sink.withMessage('trace.span')[0];
    expect(record?.detail).toMatchObject({ name: 'render', status: 'ok', processor: 'album-pdf' });
    expect(spans.spans).toHaveLength(0); // exporters are independent
  });

  it('an exporter that throws never breaks the traced operation', () => {
    const tracer = new DefaultTracer({
      exporter: {
        export: (): void => {
          throw new Error('collector unreachable');
        },
      },
    });
    expect(() => tracer.startSpan('x').end()).not.toThrow();
  });
});
