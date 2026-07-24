import { pathToFileURL } from 'node:url';
import type { StructuredLogger } from '@workerv2/worker-runtime';
import type { AppConfig } from './config.js';
import { loadAppConfig, summarizeConfig, WORKER_VERSION, RUNTIME_VERSION } from './config.js';
import type { AppComponents } from './bootstrap.js';
import { bootstrapApp, buildRuntime } from './bootstrap.js';
import type { Job } from './job.js';
import type { QueueAdapter, WorkerJob } from './queue.js';
import { InMemoryQueue } from './queue.js';
import { JobRouter } from './router.js';
import { CancellationSource } from './recovery/cancellation.js';
import { installSignalHandlers } from './shutdown.js';
import { startHealthServer } from './health.js';
import type { HealthService, HealthSnapshot, HealthStatus } from './health.js';

/**
 * THE WORKER APPLICATION — the composition/bootstrap process around the existing production runtime. It
 * drives the lifecycle (startup → recovery → idle → processing → draining → shutdown) and consumes jobs
 * from a replaceable queue adapter, delegating each job's EXECUTION to an injected `JobRunner`. It is
 * generic over the job type, so ONE application drives both the album path (Blueprint → runtime) and the
 * processor path (Job → registry → pipeline) without duplicating any lifecycle logic. It DUPLICATES NO
 * runtime logic — recovery, durable storage, rendering, export, and DI live in the unchanged libraries.
 */

export type AppState = 'starting' | 'recovering' | 'idle' | 'processing' | 'draining' | 'stopped';

export class WorkerApplication<TJob extends { readonly id: string } = WorkerJob> {
  private state: AppState = 'starting';
  private currentJobId: string | null = null;
  private currentJobCancellation: CancellationSource | null = null;
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
    private readonly components: AppComponents<TJob>,
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

    if (this.config.app.healthPort !== null) {
      this.health = await startHealthServer(this.config.app.healthPort, () => this.snapshot());
    }

    this.state = 'idle';
    this.logger.log({
      level: 'info',
      message: 'worker.ready',
      detail: { healthPort: this.config.app.healthPort, state: this.state },
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
      if (!processed && this.running) await this.idleSleep(this.config.app.pollIntervalMs);
    }
  }

  /** Poll once; process a job if one is available. Returns whether a job was processed. */
  async processOnce(): Promise<boolean> {
    const job = await this.components.queue.poll();
    if (job === null) return false;

    this.state = 'processing';
    this.currentJobId = job.id;
    const cancellation = new CancellationSource();
    this.currentJobCancellation = cancellation;
    this.logger.log({ level: 'info', message: 'worker.job.start', detail: { jobId: job.id } });
    try {
      const execution = await this.components.runner.run(job, cancellation.token);
      this.logger.log({
        level: execution.ok ? 'info' : 'error',
        message: 'worker.job.done',
        detail: { jobId: job.id, ...execution.detail },
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
      this.currentJobCancellation = null;
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
    this.currentJobCancellation?.cancel(); // ask the in-flight job to abort promptly (cooperative)
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
    const storageState = storage?.state ?? 'unknown';
    return {
      status: this.computeStatus(storageState),
      state: this.state,
      storage: storageState,
      recovery: `${this.recoveredCount} recovered`,
      currentJob: this.currentJobId,
      version: WORKER_VERSION,
    };
  }

  /** Collapse the fine-grained lifecycle state + storage health into the app-probe's coarse `status`. */
  private computeStatus(storageState: string): HealthStatus {
    switch (this.state) {
      case 'idle':
      case 'processing':
        return storageState === 'healthy' ? 'ok' : 'degraded';
      case 'starting':
      case 'recovering':
        return 'starting';
      case 'stopped':
        return 'stopped';
      default:
        return 'degraded';
    }
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
  if (config.infrastructure === null) {
    // Default path: no infrastructure → the album/blueprint worker on the in-memory queue (idle until
    // a Blueprint is enqueued). The external SDKs and the native image stack are never loaded.
    await driveApp(new WorkerApplication(config, bootstrapApp(config)));
    return;
  }
  await runProcessorWorker(config, config.infrastructure);
}

/**
 * The FUNCTIONAL processor worker (WV2_INFRA=on): connect the infrastructure, register the concrete
 * processors, and consume real jobs from pg-boss. Everything infrastructure-bound is imported LAZILY so
 * the default worker + bundle stay free of the external SDKs and the native image backend.
 */
async function runProcessorWorker(
  config: AppConfig,
  infraConfig: NonNullable<AppConfig['infrastructure']>,
): Promise<void> {
  const { runtime, logger } = buildRuntime(config);

  // 1. Infrastructure: build + fail-fast preflight (connects pg-boss, R2, Supabase).
  const infraModule = await import('./infra/index.js');
  const infra = infraModule.createInfrastructure(infraConfig);
  await infraModule.preflightInfrastructure(infra, logger);

  // 2. Long-lived resources: Chromium owned by the generic ResourceManager (never launched by a processor).
  const { ResourceManager } = await import('./resources/resource-manager.js');
  const { createBrowserResource } = await import('./resources/browser-resource.js');
  const resources = new ResourceManager();
  const browser = resources.register(createBrowserResource());

  // 3. Processor registry: image + album-PDF + r2-cleanup (Job → registry → pipeline → stages).
  const processors = await import('./processors/index.js');
  const recovery = await import('./recovery/index.js');
  const metrics = new recovery.LoggingMetricsSink(logger);
  const registry = new processors.ProcessorRegistry();
  registry.register(
    processors.createImageProcessor({
      objectStore: infra.objectStore,
      database: infra.database,
      codec: processors.createSharpImageCodec(),
      logger,
    }),
  );
  registry.register(
    processors.createPdfProcessor({
      database: infra.database,
      objectStore: infra.objectStore,
      renderer: new processors.PuppeteerPageRenderer(browser),
      appUrl: infraConfig.render.appUrl,
      logger,
    }),
  );
  registry.register(
    processors.createCleanupProcessor({ objectStore: infra.objectStore, logger, metrics }),
  );
  logger.log({
    level: 'info',
    message: 'processors.registered',
    detail: { types: registry.types },
  });

  // 4. Recovery Coordinator: register the recoverable processors (self-healing), driven by a scheduler.
  const rc = infraConfig.recovery;
  const coordinator = new recovery.RecoveryCoordinator({
    events: new processors.LoggingEventSink(logger),
    metrics,
    logger,
    batchSize: rc.batchSize,
  });
  coordinator.register(
    processors.createImageRecoverableProcessor({
      database: infra.database,
      objectStore: infra.objectStore,
      producer: infra.queue,
      logger,
      stalePendingMs: rc.imageStalePendingMs,
    }),
  );
  coordinator.register(
    processors.createPdfRecoverableProcessor({
      database: infra.database,
      producer: infra.queue,
      logger,
      staleMs: rc.pdfStaleMs,
      maxAttempts: rc.pdfMaxAttempts,
      tokenTtlMs: rc.pdfTokenTtlMs,
    }),
  );
  const scheduler = rc.enabled
    ? new recovery.PeriodicScheduler((token) => coordinator.runOnce(token).then(() => undefined), {
        intervalMs: rc.intervalMs,
        jitterMs: rc.jitterMs,
        logger,
      })
    : null;
  scheduler?.start();

  // 5. Drive the generic worker over the pg-boss queue with the processor runner.
  const runner = new processors.ProcessorJobRunner(new JobRouter(registry));
  const components: AppComponents<Job> = { runtime, queue: infra.queue, logger, runner };
  await driveApp(new WorkerApplication<Job>(config, components), async () => {
    await scheduler?.stop(); // stop the recovery sweep (cancels + awaits the in-flight run)
    await resources.shutdown(); // graceful Chromium teardown
    await infraModule.closeInfrastructure(infra, logger);
  });
}

/** Install signal handlers, start + consume until stopped, then run optional cleanup. Shared by both paths. */
async function driveApp<TJob extends { readonly id: string }>(
  app: WorkerApplication<TJob>,
  cleanup?: () => Promise<void>,
): Promise<void> {
  const removeSignals = installSignalHandlers((signal) => {
    void app.stop(`signal:${signal}`);
  });
  try {
    await app.start();
    app.begin();
    await app.whenStopped();
  } finally {
    removeSignals();
    if (cleanup !== undefined) await cleanup();
  }
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
