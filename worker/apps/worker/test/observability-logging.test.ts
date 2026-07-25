import { describe, it, expect } from 'vitest';
import { RecordingLogger } from '@workerv2/worker-runtime';
import {
  ConsoleLogSink,
  JsonLogSink,
  MemoryLogSink,
  MultiLogSink,
  ObservabilityLogger,
  REDACTED,
  asStructuredLogger,
  parseLogLevel,
  resilientSink,
  sanitizeDetail,
  sanitizeValue,
} from '../src/observability/index.js';
import type { LogRecord, LogSink } from '../src/observability/index.js';

const FIXED = (): Date => new Date('2026-01-01T00:00:00.000Z');

function build(level: Parameters<typeof parseLogLevel>[1] = 'trace'): {
  logger: ObservabilityLogger;
  sink: MemoryLogSink;
} {
  const sink = new MemoryLogSink();
  const logger = new ObservabilityLogger({ level, sink, now: FIXED, fields: { workerId: 'w1' } });
  return { logger, sink };
}

describe('structured logging — levels', () => {
  it('supports all six levels, ordered', () => {
    const { logger, sink } = build('trace');
    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.fatal('f');
    expect(sink.records.map((r) => r.level)).toEqual([
      'trace',
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
    ]);
  });

  it('filters below the configured threshold', () => {
    const { logger, sink } = build('warn');
    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.fatal('f');
    expect(sink.records.map((r) => r.message)).toEqual(['w', 'f']);
    expect(logger.isEnabled('info')).toBe(false);
    expect(logger.isEnabled('error')).toBe(true);
  });

  it('parses configured levels, tolerating the runtime spelling and rejecting nonsense', () => {
    expect(parseLogLevel('DEBUG')).toBe('debug');
    expect(parseLogLevel('warning')).toBe('warn'); // the Worker Runtime's vocabulary
    expect(parseLogLevel('nonsense', 'error')).toBe('error'); // never throws — degrades
    expect(parseLogLevel(undefined, 'fatal')).toBe('fatal');
  });
});

describe('structured logging — records + fields', () => {
  it('emits a full structured record with timestamp, level, message and bound fields', () => {
    const { logger, sink } = build();
    logger.info('worker.job.start');
    expect(sink.records[0]).toEqual({
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'info',
      message: 'worker.job.start',
      workerId: 'w1',
    });
  });

  it('binds context through child loggers without call sites repeating it', () => {
    const { logger, sink } = build();
    const job = logger.child({ processor: 'image-hardening', jobId: 'j1' });
    const stage = job.child({ stage: 'validating' });
    stage.info('stage.started');
    expect(sink.records[0]).toMatchObject({
      workerId: 'w1',
      processor: 'image-hardening',
      jobId: 'j1',
      stage: 'validating',
    });
  });

  it('promotes per-call fields to the top level without allocating a child logger', () => {
    const { logger, sink } = build();
    logger.record('info', 'stage.completed', { stage: 'render', durationMs: 42 }, { pages: 3 });
    expect(sink.records[0]).toMatchObject({
      stage: 'render',
      durationMs: 42,
      detail: { pages: 3 },
      workerId: 'w1',
    });
  });

  it('carries every field the phase requires', () => {
    const { logger, sink } = build();
    logger
      .child({
        processor: 'album-pdf',
        pipeline: 'album-pdf',
        jobId: 'j9',
        correlationId: 'c9',
        traceId: 't9',
        spanId: 's9',
        attempt: 2,
      })
      .record('warn', 'stage.failed', { stage: 'render', durationMs: 10 });
    const record = sink.records[0] as LogRecord;
    for (const field of [
      'timestamp',
      'level',
      'message',
      'processor',
      'pipeline',
      'stage',
      'jobId',
      'correlationId',
      'traceId',
      'spanId',
      'durationMs',
      'workerId',
      'attempt',
    ]) {
      expect(record).toHaveProperty(field);
    }
  });
});

describe('structured logging — sanitization (the security boundary)', () => {
  it('redacts secret-bearing keys but keeps object keys, which are needed for debugging', () => {
    const clean = sanitizeDetail({
      token: 'abc123',
      accessKeyId: 'AKIA',
      password: 'hunter2',
      // These are R2 object keys, not credentials — they must survive.
      rawKey: 'u1/albums/a1/x.jpg',
      thumbKey: 'u1/albums/a1/x_thumb.jpg',
      photoId: 'p1',
    });
    expect(clean).toEqual({
      token: REDACTED,
      accessKeyId: REDACTED,
      password: REDACTED,
      rawKey: 'u1/albums/a1/x.jpg',
      thumbKey: 'u1/albums/a1/x_thumb.jpg',
      photoId: 'p1',
    });
  });

  it('bounds strings, arrays, object width and nesting depth', () => {
    const limits = { maxDepth: 2, maxKeys: 2, maxArray: 2, maxString: 5 };
    expect(sanitizeValue('abcdefghij', limits)).toBe('abcde…(+5)');
    expect(sanitizeValue([1, 2, 3, 4], limits)).toEqual([1, 2, '…(+2)']);
    expect(sanitizeValue({ a: 1, b: 2, c: 3 }, limits)).toEqual({ a: 1, b: 2, '…': 'truncated' });
    expect(sanitizeValue({ a: { b: { c: 1 } } }, limits)).toEqual({ a: { b: '[depth]' } });
  });

  it('renders errors, dates, bytes and non-JSON values safely', () => {
    expect(sanitizeValue(new Error('boom'))).toEqual({ name: 'Error', message: 'boom' });
    expect(sanitizeValue(new Uint8Array(8))).toBe('[bytes:8]');
    expect(sanitizeValue(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(sanitizeValue(10n)).toBe('10');
    expect(sanitizeValue(() => 1)).toBe('[function]');
  });

  it('omits an empty detail bag entirely', () => {
    const { logger, sink } = build();
    logger.info('x', {});
    expect(sink.records[0]).not.toHaveProperty('detail');
  });
});

describe('log sinks — pluggability + degradation', () => {
  it('JsonLogSink writes one JSON object per line', () => {
    const lines: string[] = [];
    new JsonLogSink((l) => lines.push(l)).write({
      timestamp: 'T',
      level: 'info',
      message: 'm',
    });
    expect(JSON.parse(lines[0] as string)).toEqual({ timestamp: 'T', level: 'info', message: 'm' });
  });

  it('ConsoleLogSink writes a compact human line', () => {
    const lines: string[] = [];
    new ConsoleLogSink((l) => lines.push(l)).write({
      timestamp: '2026-01-01T12:04:31.882Z',
      level: 'info',
      message: 'worker.job.start',
      jobId: 'j1',
    });
    expect(lines[0]).toBe('12:04:31.882 INFO  worker.job.start jobId=j1');
  });

  it('MultiLogSink fans out and isolates a failing sink from the others', () => {
    const good = new MemoryLogSink();
    const bad: LogSink = {
      write: (): void => {
        throw new Error('sink down');
      },
    };
    new MultiLogSink([bad, good]).write({ timestamp: 'T', level: 'info', message: 'm' });
    expect(good.records).toHaveLength(1);
  });

  it('a failing sink degrades to the fallback instead of breaking the caller', () => {
    const fallback = new MemoryLogSink();
    let attempts = 0;
    const failing: LogSink = {
      write: (): void => {
        attempts += 1;
        throw new Error('destination unreachable');
      },
    };
    const sink = resilientSink(failing, fallback, 2);
    const logger = new ObservabilityLogger({ level: 'info', sink, now: FIXED });

    expect(() => {
      logger.info('a');
      logger.info('b');
      logger.info('c');
    }).not.toThrow();

    // After 2 consecutive failures it stops trying the primary and uses the fallback permanently.
    expect(attempts).toBe(2);
    expect(fallback.records.map((r) => r.message)).toContain('observability.log_sink.degraded');
    expect(fallback.records.map((r) => r.message)).toContain('c');
  });
});

describe('runtime logger bridge', () => {
  it('routes Worker Runtime records through the observability layer, mapping warning → warn', () => {
    const { logger, sink } = build();
    const bridged = asStructuredLogger(logger);
    bridged.log({ level: 'warning', message: 'run.retry', runId: 'r1', durationMs: 5 });
    expect(sink.records[0]).toMatchObject({
      level: 'warn',
      message: 'run.retry',
      workerId: 'w1',
      detail: { runId: 'r1', durationMs: 5 },
    });
  });

  it('preserves every runtime-specific field rather than dropping it in translation', () => {
    const { logger, sink } = build();
    asStructuredLogger(logger).log({
      level: 'info',
      message: 'run.settled',
      runId: 'r1',
      nodeId: 'n1',
      processor: 'p1',
      outcome: 'succeeded',
      artifacts: ['sha256:aa'],
    });
    expect(sink.records[0]?.detail).toMatchObject({
      runId: 'r1',
      nodeId: 'n1',
      processor: 'p1',
      outcome: 'succeeded',
      artifacts: ['sha256:aa'],
    });
  });

  it('is a drop-in for the port the unchanged libraries already depend on', () => {
    const recording = new RecordingLogger();
    recording.log({ level: 'info', message: 'x' });
    const { logger } = build();
    const bridged = asStructuredLogger(logger);
    // Same shape, so any component holding a `StructuredLogger` accepts either.
    expect(typeof bridged.log).toBe('function');
    expect(recording.records).toHaveLength(1);
  });
});
