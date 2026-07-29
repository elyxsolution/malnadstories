/**
 * LOCAL PERFORMANCE INSTRUMENTATION — measurement only, and only in this browser tab.
 *
 * There is no analytics service, no telemetry, no network call and no persistence. This is a
 * bounded in-memory ring buffer whose entire purpose is to answer "is this actually slow?"
 * with a number instead of an opinion — the same discipline that led this phase to virtualize
 * the tray (measured: 24,000 DOM nodes at 2,000 photos) and to NOT memoize the builder's array
 * scans (measured: 0.17 ms per render at 2,000 photos — not worth the indirection).
 *
 * Recording is deliberately near-free: a `performance.now()` read and a write into a
 * pre-allocated slot. Nothing is computed until something asks for a summary, so leaving the
 * instrumentation in production costs effectively nothing.
 *
 * In development the recorder is exposed as `window.__msPerf` — call `.summary()` in the
 * console to see p50/p95 per metric.
 */

/** Metrics this phase records. A closed union so a typo can't silently create a new series. */
export type PerfMetric =
  | 'render.tray' // one tray render, including its virtual window computation
  | 'image.decode' // <img> src set → load event
  | 'url.refresh' // signed-URL refresh round trip
  | 'virtual.ratio' // rendered items ÷ total items (×100)
  | 'upload.throughput' // KB/s for one completed upload
  | 'upload.queueWait'; // ms a task spent queued before starting

const CAPACITY = 120; // per metric — enough for a stable p95, bounded memory

type Series = { values: Float64Array; count: number; next: number };

const series = new Map<PerfMetric, Series>();

function seriesFor(metric: PerfMetric): Series {
  let s = series.get(metric);
  if (!s) {
    s = { values: new Float64Array(CAPACITY), count: 0, next: 0 };
    series.set(metric, s);
  }
  return s;
}

/** Record one sample. Safe to call from a hot path — no allocation, no formatting. */
export function record(metric: PerfMetric, value: number): void {
  if (!Number.isFinite(value)) return;
  const s = seriesFor(metric);
  s.values[s.next] = value;
  s.next = (s.next + 1) % CAPACITY;
  if (s.count < CAPACITY) s.count += 1;
}

/** Time a synchronous block and record it. Returns whatever the block returned. */
export function measure<T>(metric: PerfMetric, fn: () => T): T {
  const t0 = now();
  try {
    return fn();
  } finally {
    record(metric, now() - t0);
  }
}

/** A monotonic clock that degrades gracefully outside the browser. */
export function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export type PerfSummary = Record<string, { count: number; p50: number; p95: number; max: number; mean: number }>;

/** Percentiles across everything currently buffered. Computed on demand only. */
export function summary(): PerfSummary {
  const out: PerfSummary = {};
  series.forEach((s, metric) => {
    if (s.count === 0) return;
    const sorted = Array.from(s.values.slice(0, s.count)).sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
    out[metric] = {
      count: s.count,
      p50: round(at(0.5)),
      p95: round(at(0.95)),
      max: round(sorted[sorted.length - 1]),
      mean: round(mean),
    };
  });
  return out;
}

export function reset(): void {
  series.clear();
}

const round = (v: number) => Math.round(v * 100) / 100;

// Dev-only console handle. Guarded so it never appears in a production bundle's global scope.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as { __msPerf?: unknown }).__msPerf = { summary, reset, record };
}
