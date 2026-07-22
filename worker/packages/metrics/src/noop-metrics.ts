import type { Metrics, MetricTags } from './types.js';

/** A `Metrics` implementation that records nothing. Safe default. */
export class NoopMetrics implements Metrics {
  counter(_name: string, _value?: number, _tags?: MetricTags): void {}
  gauge(_name: string, _value: number, _tags?: MetricTags): void {}
  histogram(_name: string, _value: number, _tags?: MetricTags): void {}
  timing(_name: string, _milliseconds: number, _tags?: MetricTags): void {}
}
