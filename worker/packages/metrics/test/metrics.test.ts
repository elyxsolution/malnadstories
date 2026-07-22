import { describe, expect, it } from 'vitest';
import { NoopMetrics, InMemoryMetrics } from '@workerv2/metrics';

describe('NoopMetrics', () => {
  it('accepts all calls without error', () => {
    const m = new NoopMetrics();
    expect(() => {
      m.counter('c');
      m.gauge('g', 1);
      m.histogram('h', 2);
      m.timing('t', 3);
    }).not.toThrow();
  });
});

describe('InMemoryMetrics', () => {
  it('records samples of each type with defaults and tags', () => {
    const m = new InMemoryMetrics();
    m.counter('req');
    m.counter('req', 2, { route: '/a' });
    m.gauge('mem', 100);
    m.histogram('size', 500);
    m.timing('dur', 42);

    expect(m.samples).toStrictEqual([
      { type: 'counter', name: 'req', value: 1, tags: {} },
      { type: 'counter', name: 'req', value: 2, tags: { route: '/a' } },
      { type: 'gauge', name: 'mem', value: 100, tags: {} },
      { type: 'histogram', name: 'size', value: 500, tags: {} },
      { type: 'timing', name: 'dur', value: 42, tags: {} },
    ]);
  });

  it('aggregates counter totals and resets', () => {
    const m = new InMemoryMetrics();
    m.counter('x');
    m.counter('x', 4);
    expect(m.counterTotal('x')).toBe(5);
    expect(m.counterTotal('missing')).toBe(0);
    m.reset();
    expect(m.samples).toHaveLength(0);
  });
});
