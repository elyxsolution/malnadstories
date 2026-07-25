import { InMemoryStorageBackend, noopLogger } from '@workerv2/worker-runtime';
import type { RecordedSample } from '@workerv2/metrics';
import type { AppConfig } from '../../config.js';
import { loadAppConfig } from '../../config.js';
import type { AppComponents } from '../../bootstrap.js';
import { buildRuntime } from '../../bootstrap.js';
import type { Job, JobType } from '../../job.js';
import type { QueueAdapter } from '../../queue.js';
import { WorkerApplication } from '../../main.js';
import { JobRouter } from '../../router.js';
import { ConcurrencyController, memoryPressureSensor } from '../../concurrency.js';
import { ProcessorRegistry } from '../../processors/registry.js';
import type { Processor } from '../../processors/registry.js';
import { ProcessorJobRunner } from '../../processors/runner.js';
import {
  InMemoryMetricsProvider,
  MemoryLogSink,
  createObservability,
} from '../../observability/index.js';
import type { Observability } from '../../observability/index.js';
import { FakeBroker, FakeBrokerQueue } from '../fakes/fake-broker.js';
import type { BenchmarkReport, LatencySummary } from '../bench/metrics.js';
import { LatencyHistogram, sampleMemory } from '../bench/metrics.js';
import { sleep } from './workload.js';

/**
 * THE LOAD HARNESS — runs N REAL `WorkerApplication` instances against one broker and reports what
 * happened.
 *
 * The critical design choice is that these are real workers, not a simulation of one. The harness
 * builds the actual application, the actual dispatch loop, the actual concurrency controller,
 * registry, router and observability layer, and only the INFRASTRUCTURE (broker, storage, database,
 * renderer) is faked. So a result here is evidence about the shipped code path: if the harness shows
 * no duplicate processing across 8 workers, that is the production dispatch loop being correct, not
 * a model of it.
 *
 * N workers over ONE broker is exactly the horizontal-scaling question — every worker competes for
 * the same jobs through the same atomic fetch, which is what a multi-instance deployment does.
 */

export interface HarnessOptions {
  /** How many worker processes to model. */
  readonly workers?: number;
  /** Processors each worker registers. A factory, so every worker gets its OWN instances. */
  readonly processors: () => readonly Processor[];
  /** Environment overrides for `loadAppConfig` (concurrency lanes, drain timeout, …). */
  readonly env?: NodeJS.ProcessEnv;
  /** Queues the workers are responsible for. Defaults to the processors' types. */
  readonly queues?: readonly JobType[];
  /** Wrap each worker's queue adapter (chaos injection). */
  readonly wrapQueue?: (inner: QueueAdapter<Job>, index: number) => QueueAdapter<Job>;
  /**
   * Supply the concurrency controller instead of building one from config — the seam a backpressure
   * test uses to drive pressure directly rather than trying to provoke real memory growth.
   */
  readonly concurrency?: (index: number) => ConcurrencyController;
  readonly broker?: FakeBroker;
}

/** One modelled worker and everything needed to assert about it. */
export interface HarnessWorker {
  readonly id: string;
  readonly app: WorkerApplication<Job>;
  readonly processors: readonly Processor[];
  readonly metrics: InMemoryMetricsProvider;
  readonly logs: MemoryLogSink;
  readonly observability: Observability;
  readonly concurrency: ConcurrencyController;
}

export class LoadHarness {
  readonly broker: FakeBroker;
  readonly workers: HarnessWorker[] = [];
  private readonly config: AppConfig;
  private started = false;

  constructor(private readonly options: HarnessOptions) {
    this.broker = options.broker ?? new FakeBroker();
    this.config = loadAppConfig({ WV2_POLL_INTERVAL_MS: '2', ...options.env });

    const count = options.workers ?? 1;
    for (let i = 0; i < count; i += 1) {
      this.workers.push(this.buildWorker(i));
    }
  }

  private buildWorker(index: number): HarnessWorker {
    const id = `worker-${index + 1}`;
    const logs = new MemoryLogSink(500);
    const metrics = new InMemoryMetricsProvider();
    const observability = createObservability(this.config.observability, { sink: logs, metrics });

    const { runtime } = buildRuntime(this.config, {
      observability,
      backend: new InMemoryStorageBackend(),
      logger: noopLogger,
    });

    const processors = this.options.processors();
    const registry = new ProcessorRegistry();
    for (const processor of processors) registry.register(processor);

    const queues = this.options.queues ?? processors.map((p) => p.type);
    const base: QueueAdapter<Job> = new FakeBrokerQueue(this.broker, queues, id);
    const queue = this.options.wrapQueue?.(base, index) ?? base;

    const concurrency =
      this.options.concurrency?.(index) ??
      new ConcurrencyController({
        config: this.config.concurrency,
        pressure: memoryPressureSensor(
          this.config.observability.memorySoftLimitBytes,
          this.config.observability.memoryHardLimitBytes,
        ),
      });

    const components: AppComponents<Job> = {
      runtime,
      queue,
      logger: observability.structuredLogger,
      runner: new ProcessorJobRunner(new JobRouter(registry)),
      observability,
      concurrency,
      composition: { processors: () => registry.types },
    };

    return {
      id,
      app: new WorkerApplication<Job>(this.config, components),
      processors,
      metrics,
      logs,
      observability,
      concurrency,
    };
  }

  /** Start every worker and begin consuming. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const worker of this.workers) {
      await worker.app.start();
      worker.app.begin();
    }
  }

  /**
   * Wait until the broker is empty and no worker is mid-job, or `timeoutMs` elapses. Returns whether
   * the queue actually drained — a test that needs "all work completed" asserts on this rather than
   * on a sleep, so it neither flakes nor wastes time.
   */
  async waitForDrain(timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const idle = this.broker.depth === 0 && this.workers.every((w) => w.app.inFlight === 0);
      if (idle) return true;
      await sleep(2);
    }
    return false;
  }

  /** Stop every worker gracefully. */
  async stop(reason = 'harness'): Promise<void> {
    await Promise.all(this.workers.map((w) => w.app.stop(reason)));
  }

  // --- Reporting ------------------------------------------------------------------------------

  /** Every metric sample from every worker (metrics accuracy is itself under test). */
  allSamples(): RecordedSample[] {
    return this.workers.flatMap((w) => [...w.metrics.samples]);
  }

  private summarize(name: string, tagKey: string): Record<string, LatencySummary> {
    const byTag = new Map<string, LatencyHistogram>();
    for (const sample of this.allSamples()) {
      if (sample.name !== name || sample.type !== 'timing') continue;
      const tag = sample.tags[tagKey] ?? 'all';
      let histogram = byTag.get(tag);
      if (histogram === undefined) {
        histogram = new LatencyHistogram();
        byTag.set(tag, histogram);
      }
      histogram.record(sample.value);
    }
    return Object.fromEntries([...byTag].map(([tag, h]) => [tag, h.summary()]));
  }

  /**
   * Build the benchmark report from the observability layer's OWN metrics rather than from separate
   * harness bookkeeping. That is deliberate: it means every published figure is one an operator can
   * also read in production, and a discrepancy would be a real observability defect, not a harness
   * artefact.
   */
  report(scenario: string, durationMs: number, before = sampleMemory()): BenchmarkReport {
    const samples = this.allSamples();
    const counter = (metric: string): number =>
      samples
        .filter((s) => s.name === metric && s.type === 'counter')
        .reduce((sum, s) => sum + s.value, 0);

    const after = sampleMemory();
    const completed = counter('worker.jobs.completed');
    return {
      scenario,
      workers: this.workers.length,
      jobsCompleted: completed,
      jobsFailed: counter('worker.jobs.failed'),
      durationMs,
      throughputPerSecond: durationMs === 0 ? 0 : (completed / durationMs) * 1000,
      latency: this.summarize('worker.jobs.duration_ms', 'processor'),
      stages: this.summarize('worker.stage.duration_ms', 'stage'),
      memoryBefore: before,
      memoryAfter: after,
      heapGrowthBytes: after.heapUsedBytes - before.heapUsedBytes,
      notes: [],
    };
  }
}
