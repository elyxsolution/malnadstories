/**
 * BENCHMARK MEASUREMENT — a latency histogram and the report shape the validation suites emit.
 *
 * Deliberately exact rather than approximate: samples are retained and sorted, so p95/p99 are the
 * true order statistics. Approximate digests exist because production systems cannot retain every
 * sample; a benchmark harness measuring thousands (not billions) of jobs can, and being able to
 * trust the tail figure matters more here than the memory saved.
 */

export class LatencyHistogram {
  private readonly samples: number[] = [];

  record(ms: number): void {
    this.samples.push(ms);
  }

  get count(): number {
    return this.samples.length;
  }

  get min(): number {
    return this.count === 0 ? 0 : Math.min(...this.samples);
  }

  get max(): number {
    return this.count === 0 ? 0 : Math.max(...this.samples);
  }

  get mean(): number {
    if (this.count === 0) return 0;
    return this.samples.reduce((sum, s) => sum + s, 0) / this.count;
  }

  /** Nearest-rank percentile, `p` in 0..1. */
  percentile(p: number): number {
    if (this.count === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = Math.ceil(Math.min(1, Math.max(0, p)) * sorted.length);
    return sorted[Math.max(0, rank - 1)] as number;
  }

  summary(): LatencySummary {
    return {
      count: this.count,
      minMs: round(this.min),
      meanMs: round(this.mean),
      p50Ms: round(this.percentile(0.5)),
      p95Ms: round(this.percentile(0.95)),
      p99Ms: round(this.percentile(0.99)),
      maxMs: round(this.max),
    };
  }
}

export interface LatencySummary {
  readonly count: number;
  readonly minMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

export interface MemorySample {
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
}

export interface BenchmarkReport {
  readonly scenario: string;
  readonly workers: number;
  readonly jobsCompleted: number;
  readonly jobsFailed: number;
  readonly durationMs: number;
  /** Completed jobs per second across all workers. */
  readonly throughputPerSecond: number;
  /** End-to-end latency per job type. */
  readonly latency: Readonly<Record<string, LatencySummary>>;
  /** Per-stage timings, from the observability layer's own `worker.stage.duration_ms`. */
  readonly stages: Readonly<Record<string, LatencySummary>>;
  readonly memoryBefore: MemorySample;
  readonly memoryAfter: MemorySample;
  /** Heap retained across the run — the leak signal. */
  readonly heapGrowthBytes: number;
  readonly notes: readonly string[];
}

/** Render a report as a fixed-width table for the test console. */
export function formatReport(report: BenchmarkReport): string {
  const lines: string[] = [
    '',
    `── ${report.scenario} ─────────────────────────────────────────`,
    `  workers=${report.workers}  completed=${report.jobsCompleted}  failed=${report.jobsFailed}  ` +
      `duration=${report.durationMs}ms  throughput=${report.throughputPerSecond.toFixed(1)}/s`,
    `  heap: ${mb(report.memoryBefore.heapUsedBytes)} → ${mb(report.memoryAfter.heapUsedBytes)} ` +
      `(growth ${mb(report.heapGrowthBytes)})`,
  ];
  const rows = { ...report.latency };
  if (Object.keys(rows).length > 0) {
    lines.push('  latency          count     mean      p50      p95      p99      max');
    for (const [name, s] of Object.entries(rows)) {
      lines.push(
        `    ${name.padEnd(16)}${String(s.count).padStart(5)}${fmt(s.meanMs)}${fmt(s.p50Ms)}` +
          `${fmt(s.p95Ms)}${fmt(s.p99Ms)}${fmt(s.maxMs)}`,
      );
    }
  }
  if (Object.keys(report.stages).length > 0) {
    lines.push('  stages           count     mean      p95');
    for (const [name, s] of Object.entries(report.stages)) {
      lines.push(
        `    ${name.padEnd(16)}${String(s.count).padStart(5)}${fmt(s.meanMs)}${fmt(s.p95Ms)}`,
      );
    }
  }
  for (const note of report.notes) lines.push(`  • ${note}`);
  return lines.join('\n');
}

function fmt(value: number): string {
  return `${value.toFixed(1)}ms`.padStart(9);
}
function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
function round(value: number): number {
  return Number(value.toFixed(2));
}

/** Current process memory, for before/after comparison. */
export function sampleMemory(): MemorySample {
  const usage = process.memoryUsage();
  return { rssBytes: usage.rss, heapUsedBytes: usage.heapUsed };
}
