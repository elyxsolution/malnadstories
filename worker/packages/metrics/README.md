# @workerv2/metrics

Metrics **abstraction** (the `Metrics` interface) plus reference implementations. Foundation
seam only — the full metrics platform (taxonomy, export, business metrics) is a later phase.
Depends on `@workerv2/contracts`.

## Exports

- `Metrics` — `counter`, `gauge`, `histogram`, `timing(ms)`, each with optional low-cardinality
  `MetricTags`.
- `NoopMetrics` — records nothing (safe default).
- `InMemoryMetrics` — retains `samples`, aggregates `counterTotal(name)`, `reset()` (tests only).
