import { pathToFileURL } from 'node:url';
import type { StructuredLogger } from '@workerv2/worker-runtime';
import type { AppConfig } from './config.js';
import { loadAppConfig, summarizeConfig, WORKER_VERSION, RUNTIME_VERSION } from './config.js';
import type { AppComponents } from './bootstrap.js';
import { bootstrapApp } from './bootstrap.js';
import type { QueueAdapter, WorkerJob } from './queue.js';
import { InMemoryQueue } from './queue.js';
import { installSignalHandlers } from './shutdown.js';
import { startHealthServer } from './health.js';
import type { HealthService, HealthSnapshot } from './health.js';

/**
 * THE WORKER APPLICATION — the composition/bootstrap process around the existing production runtime.
 * It drives the lifecycle (startup → recovery → idle → processing → draining → shutdown), consumes
 * jobs from a replaceable queue adapter, and hands each job's Blueprint to `runtime.run(...)`. It
 * DUPLICATES NO runtime logic — recovery, durable storage, rendering, export, and DI all live in the
 * unchanged libraries; this only composes + drives them.
 */

export type AppState = 'starting' | 'recovering' | 'idle' | 'processing' | 'draining' | 'stopped';

export class WorkerApplication {
  private state: AppState = 'starting';
  private currentJobId: string | null = null;
  private recoveredCount = 0;
  private running = false;
  private loop: Promise<void> = Promise.resolve();
  private health: HealthService | null = null;
  private wake: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped: (() => void) | null = null;
  private readonly done: Promise<void>;
  private readonly logger: StructuredLogger;

  constructor(
    private readonly config: AppConfig,
    private readonly components: AppComponents,
  ) {
    this.logger = components.logger;
    this.done = new Promise<void>((resolve) => {
      this.stopped = resolve;
    });
  }

  // --- Lifecycle: startup → recovery → ready ---

  /** Start the runtime, recover unfinished work, start health, and become ready. */
  async start(): Promise<void> {
    this.logger.log({
      level: 'info',
      message: 'worker.startup',
      detail: {
        workerVersion: WORKER_VERSION,
        runtimeVersion: RUNTIME_VERSION,
        nodeVersion: process.version,
        storageBackend: this.config.runtime.storage.kind,
        config: summarizeConfig(this.config),
      },
    });

    this.components.runtime.start();
    await this.recover();

    if (this.config.healthPort !== null) {
      this.health = await startHealthServer(this.config.healthPort, () => this.snapshot());
    }

    this.state = 'idle';
    this.logger.log({
      level: 'info',
      message: 'worker.ready',
      detail: { healthPort: this.config.healthPort, state: this.state },
    });
  }

  /** Recover every interrupted run recorded in durable storage (reuses the runtime's own resume). */
  private async recover(): Promise<void> {
    this.state = 'recovering';
    const runIds = this.components.runtime.recoverableRuns();
    for (const runId of runIds) {
      await this.components.runtime.recover(runId);
      this.recoveredCount += 1;
    }
    this.logger.log({
      level: 'info',
      message: 'worker.recovery',
      detail: { recovered: this.recoveredCount, runs: runIds },
    });
  }

  // --- Consume loop ---

  /** Begin consuming jobs. Returns immediately; the loop runs until `stop()`. */
  begin(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.consume();
  }

  private async consume(): Promise<void> {
    while (this.running) {
      const processed = await this.processOnce();
      if (!processed && this.running) await this.idleSleep(this.config.pollIntervalMs);
    }
  }

  /** Poll once; process a job if one is available. Returns whether a job was processed. */
  async processOnce(): Promise<boolean> {
    const job = await this.components.queue.poll();
    if (job === null) return false;

    this.state = 'processing';
    this.currentJobId = job.id;
    this.logger.log({ level: 'info', message: 'worker.job.start', detail: { jobId: job.id } });
    try {
      const { result } = await this.components.runtime.run(job.blueprint);
      this.logger.log({
        level: result.succeeded ? 'info' : 'error',
        message: 'worker.job.done',
        detail: { jobId: job.id, succeeded: result.succeeded, pdf: result.pdfKey ?? null },
      });
      await this.components.queue.ack(job.id);
    } catch (error) {
      this.logger.log({
        level: 'error',
        message: 'worker.job.failed',
        detail: { jobId: job.id, error: error instanceof Error ? error.message : String(error) },
      });
      await this.components.queue.nack(job.id, error);
    } finally {
      this.currentJobId = null;
      this.state = 'idle';
    }
    return true;
  }

  // --- Shutdown ---

  /** A promise that resolves once the worker has fully, gracefully stopped. */
  whenStopped(): Promise<void> {
    return this.done;
  }

  /** Graceful shutdown: stop accepting work, drain the in-flight job, persist, and stop. */
  async stop(reason: string): Promise<void> {
    if (this.state === 'stopped') return;
    const drainStart = Date.now();
    this.state = 'draining';
    this.logger.log({
      level: 'info',
      message: 'worker.draining',
      detail: { reason, outstanding: this.depth() },
    });

    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.wake !== null) this.wake();
    await this.loop; // drains the in-flight job + exits the loop

    this.components.runtime.shutdown(); // persists final state via the durable stores
    if (this.health !== null) await this.health.close();

    this.state = 'stopped';
    this.logger.log({
      level: 'info',
      message: 'worker.shutdown',
      detail: {
        outstandingJobs: this.depth(),
        drainDurationMs: Date.now() - drainStart,
        complete: true,
      },
    });
    this.stopped?.();
  }

  // --- Observability ---

  snapshot(): HealthSnapshot {
    const storage = this.components.runtime.health().dependencies.find((d) => d.name === 'storage');
    return {
      state: this.state,
      storage: storage?.state ?? 'unknown',
      recovery: `${this.recoveredCount} recovered`,
      currentJob: this.currentJobId,
      version: WORKER_VERSION,
    };
  }

  get appState(): AppState {
    return this.state;
  }

  private depth(): number {
    return this.components.queue instanceof InMemoryQueue ? this.components.queue.depth : 0;
  }

  private idleSleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.wake = resolve;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.wake = null;
        resolve();
      }, ms);
    });
  }
}

/** Build + run a worker from the environment (the process entrypoint's body). */
export async function runFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = loadAppConfig(env);
  const components = bootstrapApp(config);
  const app = new WorkerApplication(config, components);

  const removeSignals = installSignalHandlers((signal) => {
    void app.stop(`signal:${signal}`);
  });

  await app.start();
  app.begin();
  await app.whenStopped();
  removeSignals();
}

/** Whether this module was executed directly (vs. imported by a test/bundler). */
function isEntrypoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isEntrypoint()) {
  runFromEnv()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exit(1);
    });
}

export type { QueueAdapter, WorkerJob };
