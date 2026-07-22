/** String tags attached to a metric sample (low-cardinality dimensions only). */
export type MetricTags = Readonly<Record<string, string>>;

/**
 * The metrics abstraction every subsystem depends on. Implementations decide transport
 * (noop, in-memory, remote). Kept intentionally small — the full metrics platform (taxonomy,
 * export, business metrics) is a later phase.
 */
export interface Metrics {
  /** Increment a monotonic counter by `value` (default 1). */
  counter(name: string, value?: number, tags?: MetricTags): void;
  /** Record an instantaneous value that can go up or down. */
  gauge(name: string, value: number, tags?: MetricTags): void;
  /** Record a distribution sample (e.g. sizes). */
  histogram(name: string, value: number, tags?: MetricTags): void;
  /** Record a duration in milliseconds (a histogram specialized for time). */
  timing(name: string, milliseconds: number, tags?: MetricTags): void;
}
