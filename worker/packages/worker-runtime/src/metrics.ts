/**
 * METRICS — an OPTIONAL, injectable interface for operational telemetry: execution duration,
 * artifact counts, retries, failures, per-processor timings, and backend usage. It is observational
 * and never influences execution. The runtime records into whatever sink is injected; a real
 * deployment injects a Prometheus/StatsD/OpenTelemetry adapter behind the same interface. A
 * recording sink (tests) and a no-op ship here.
 */
export interface RuntimeMetrics {
  /** Total wall-time of a completed run (ms). */
  recordExecutionDuration(runId: string, durationMs: number): void;
  /** How many Artifacts a run produced. */
  recordArtifactCount(runId: string, count: number): void;
  /** Retry attempts (beyond the first) observed in a run. */
  recordRetries(runId: string, retries: number): void;
  /** Node failures observed in a run. */
  recordFailures(runId: string, failures: number): void;
  /** Per-processor timing (ms) for a node. */
  recordProcessorTiming(processor: string, durationMs: number): void;
  /** Which image backend a run used. */
  recordBackendUsage(backendId: string): void;
}

/** A metrics sink that records everything — for tests + inspection. */
export class RecordingMetrics implements RuntimeMetrics {
  readonly executionDurations: { runId: string; durationMs: number }[] = [];
  readonly artifactCounts: { runId: string; count: number }[] = [];
  readonly retries: { runId: string; retries: number }[] = [];
  readonly failures: { runId: string; failures: number }[] = [];
  readonly processorTimings: { processor: string; durationMs: number }[] = [];
  readonly backendUsage: string[] = [];

  recordExecutionDuration(runId: string, durationMs: number): void {
    this.executionDurations.push({ runId, durationMs });
  }
  recordArtifactCount(runId: string, count: number): void {
    this.artifactCounts.push({ runId, count });
  }
  recordRetries(runId: string, retries: number): void {
    this.retries.push({ runId, retries });
  }
  recordFailures(runId: string, failures: number): void {
    this.failures.push({ runId, failures });
  }
  recordProcessorTiming(processor: string, durationMs: number): void {
    this.processorTimings.push({ processor, durationMs });
  }
  recordBackendUsage(backendId: string): void {
    this.backendUsage.push(backendId);
  }
}

/** A metrics sink that discards everything (metrics disabled). */
export const noopMetrics: RuntimeMetrics = {
  recordExecutionDuration: (): void => {},
  recordArtifactCount: (): void => {},
  recordRetries: (): void => {},
  recordFailures: (): void => {},
  recordProcessorTiming: (): void => {},
  recordBackendUsage: (): void => {},
};
