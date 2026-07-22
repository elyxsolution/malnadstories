import type { Metrics, MetricTags } from './types.js';

/** One recorded sample, retained for inspection/testing. */
export interface RecordedSample {
  readonly type: 'counter' | 'gauge' | 'histogram' | 'timing';
  readonly name: string;
  readonly value: number;
  readonly tags: MetricTags;
}

/**
 * A `Metrics` implementation that retains samples in memory. Intended for tests and local
 * inspection — NOT a production sink. Counters are also aggregated for convenient assertions.
 */
export class InMemoryMetrics implements Metrics {
  private readonly _samples: RecordedSample[] = [];

  private record(
    type: RecordedSample['type'],
    name: string,
    value: number,
    tags?: MetricTags,
  ): void {
    this._samples.push({ type, name, value, tags: tags ?? {} });
  }

  counter(name: string, value = 1, tags?: MetricTags): void {
    this.record('counter', name, value, tags);
  }
  gauge(name: string, value: number, tags?: MetricTags): void {
    this.record('gauge', name, value, tags);
  }
  histogram(name: string, value: number, tags?: MetricTags): void {
    this.record('histogram', name, value, tags);
  }
  timing(name: string, milliseconds: number, tags?: MetricTags): void {
    this.record('timing', name, milliseconds, tags);
  }

  /** All recorded samples, in order. */
  get samples(): readonly RecordedSample[] {
    return this._samples;
  }

  /** Sum of all counter samples for `name`. */
  counterTotal(name: string): number {
    return this._samples
      .filter((s) => s.type === 'counter' && s.name === name)
      .reduce((sum, s) => sum + s.value, 0);
  }

  /** Clear all recorded samples. */
  reset(): void {
    this._samples.length = 0;
  }
}
