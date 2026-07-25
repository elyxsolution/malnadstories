import { pathToFileURL } from 'node:url';
import type { AppConfig } from './config.js';
import { loadAppConfig, summarizeConfig, WORKER_VERSION, RUNTIME_VERSION } from './config.js';
import type { AppComponents } from './bootstrap.js';
import { bootstrapApp, buildRuntime } from './bootstrap.js';
import type { Job } from './job.js';
import type { QueueAdapter, WorkerJob } from './queue.js';
import { InMemoryQueue } from './queue.js';
import { JobRouter } from './router.js';
import { CancellationSource } from './recovery/cancellation.js';
import { ConcurrencyController, memoryPressureSensor } from './concurrency.js';
import { installSignalHandlers } from './shutdown.js';
import { coarseStatus, startHealthServer } from './health.js';
import type { HealthService, HealthSnapshot } from './health.js';
import type {
  DiagnosticsReport,
  Observability,
  WorkerHealthRegistry,
  WorkerHealthReport,
  WorkerLogger,
} from './observability/index.js';
import {
  RuntimeMonitor,
  StartupDiagnostics,
  buildDiagnosticsReport,
  configurationProbe,
  cpuProbe,
  fail,
  memoryProbe,
  pass,
  readBuildIdentity,
  runtimeStorageProbe,
  warn,
} from './observability/index.js';

/**
 * THE WORKER APPLICATION — the composition/bootstrap process around the existing production runtime. It
 * drives the lifecycle (startup → recovery → idle → processing → draining → shutdown) and consumes jobs
 * from a replaceable queue adapter, delegating each job's EXECUTION to an injected `JobRunner`. It is
 * generic over the job type, so ONE application drives both the album path (Blueprint → runtime) and the
 * processor path (Job → registry → pipeline) without duplicating any lifecycle logic. It DUPLICATES NO
 * runtime logic — recovery, durable storage, rendering, export, and DI live in the unchanged libraries.
 *
 * OBSERVABILITY (Phase I-4): the application no longer computes health itself, and it no longer decides
 * what a lifecycle state MEANS. It owns the lifecycle and EXPOSES it; the observability layer's health
 * registry aggregates that with every component probe, and `coarseStatus` maps the result onto the
 * frontend's contract. Startup now runs a single validation pass that fails fast, and every log line the
 * application emits carries the worker id, job id and correlation id automatically.
 */

export type AppState = 'starting' | 'recovering' | 'idle' | 'processing' | 'draining' | 'stopped';

/** One job executing right now, with the handle needed to cancel it during a drain. */
interface InFlightJob {
  readonly type: string;
  readonly cancellation: CancellationSource;
  readonly settled: Promise<void>;
}

export class WorkerApplication<TJob extends { readonly id: string } = WorkerJob> {
  private state: AppState = 'starting';
  private recoveredCount = 0;
  private running = false;
  private loop: Promise<void> = Promise.resolve();
  private health: HealthService | null = null;
  private wake: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped: (() => void) | null = null;
  private readonly done: Promise<void>;
  private readonly obs: Observability;
  private readonly logger: WorkerLogger;
  /** Every job currently executing, keyed by broker job id. */
  private readonly inFlightJobs = new Map<string, InFlightJob>();
  private readonly concurrency: ConcurrencyController;
  /** Job types this worker can run — the poll filter's universe. */
  private readonly knownTypes: readonly string[];
  private abandonedOnDrain = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly components: AppComponents<TJob>,
  ) {
    this.obs = components.observability;
    this.logger = this.obs.logger;
    this.done = new Promise<void>((resolve) => {
      this.stopped = resolve;
    });
    this.concurrency =
      components.concurrency ??
      new ConcurrencyController({
        config: config.concurrency,
        pressure: memoryPressureSensor(
          config.observability.memorySoftLimitBytes,
          config.observability.memoryHardLimitBytes,
        ),
      });
    // With no processor registry (the album path) there is one implicit lane; the filter is then
    // `undefined`, which means "any job", preserving the pre-Phase-I-5 polling behaviour exactly.
    this.knownTypes = components.composition?.processors?.() ?? [];
    this.registerOwnProbes();
  }

  // --- Lifecycle: startup → recovery → ready ---

  /**
   * Validate, start the runtime, recover unfinished work, start health, and become ready.
   *
   * Startup validation runs FIRST and throws `StartupError` on a critical failure, so a misconfigured
   * or disconnected worker exits with one clear report instead of half-starting and failing later on
   * its first job.
   */
  async start(): Promise<void> {
    this.logger.info('worker.startup', {
      workerVersion: WORKER_VERSION,
      runtimeVersion: RUNTIME_VERSION,
      nodeVersion: process.version,
      storageBackend: this.config.runtime.storage.kind,
      config: summarizeConfig(this.config),
    });

    await (this.components.startup ?? this.defaultStartupChecks()).run();

    this.components.runtime.start();
    await this.recover();

    if (this.config.app.healthPort !== null) {
      this.health = await startHealthServer(this.config.app.healthPort, {
        snapshot: () => this.snapshot(),
        report: () => this.healthReport(),
        diagnostics: () => this.diagnostics(),
        ...(this.config.app.diagnosticsToken === null
          ? {}
          : { detailToken: this.config.app.diagnosticsToken }),
      });
    }
    this.components.monitor?.start();

    this.state = 'idle';
    this.logger.info('worker.ready', {
      healthPort: this.config.app.healthPort,
      state: this.state,
      warnings: this.config.warnings,
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
    this.logger.info('worker.recovery', { recovered: this.recoveredCount, runs: runIds });
  }

  // --- Consume loop ---

  /** Begin consuming jobs. Returns immediately; the loop runs until `stop()`. */
  begin(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.consume();
  }

  /**
   * The dispatch loop. Each pass fills every lane that has room, then sleeps until either the poll
   * interval elapses or a running job frees a slot — so a worker with capacity never sits idle
   * waiting out a timer, and a saturated worker never spins.
   */
  private async consume(): Promise<void> {
    while (this.running) {
      let dispatched = false;
      try {
        dispatched = await this.dispatchAvailable();
      } catch (error) {
        // THE LOOP MUST NEVER DIE. A broker blip (connection reset, pooler restart) used to escape
        // here, reject `this.loop`, and silently kill dispatch — leaving a process that reported
        // itself healthy while consuming nothing, forever. Found by chaos-injecting a poll outage.
        // Now it is logged, counted, and retried on the next tick.
        this.obs.metrics.counter('worker.dispatch.error');
        this.logger.error('worker.dispatch.failed', {
          error: error instanceof Error ? error.message : String(error),
          note: 'dispatch continues; the poll is retried on the next tick',
        });
      }
      if (!dispatched && this.running) await this.idleSleep(this.config.app.pollIntervalMs);
    }
    // Leaving the loop does not abandon work: `stop()` owns the drain.
  }

  /**
   * Start as many jobs as the current allowances permit. Returns whether anything started.
   *
   * The concurrency controller is consulted BEFORE polling and its verdict becomes the poll filter,
   * so a full lane is never asked for. That ordering is what makes backpressure real rather than
   * cosmetic: when the controller admits nothing, the worker performs no broker round-trip at all
   * and jobs stay durably queued instead of being pulled into a process that cannot run them.
   */
  private async dispatchAvailable(): Promise<boolean> {
    let dispatched = false;
    while (this.running) {
      const eligible = this.concurrency.eligibleTypes(this.knownTypes);
      // No known types = the album path's single implicit lane: fall back to the global ceiling.
      if (this.knownTypes.length === 0) {
        if (this.concurrency.inFlight >= this.config.concurrency.maxInFlight) break;
      } else if (eligible.length === 0) {
        this.obs.metrics.counter('worker.dispatch.backpressure');
        break;
      }

      const job = await this.components.queue.poll(
        this.knownTypes.length === 0 ? undefined : eligible,
      );
      if (job === null) {
        this.obs.metrics.counter('worker.queue.poll_empty');
        break;
      }
      this.startJob(job);
      dispatched = true;
    }
    return dispatched;
  }

  /**
   * Begin a job WITHOUT awaiting it. The returned promise is tracked so the drain can wait on it;
   * the loop moves straight on to fill the next slot. This is the whole of the head-of-line-blocking
   * fix — the lifecycle, logging, metrics and ack/nack semantics below are unchanged from Phase I-4.
   */
  private startJob(job: TJob): void {
    const type = typeOf(job);
    this.concurrency.acquire(type);
    this.state = 'processing';

    const cancellation = new CancellationSource();
    const settled = this.runJob(job, type, cancellation).finally(() => {
      this.concurrency.release(type);
      this.inFlightJobs.delete(job.id);
      if (this.inFlightJobs.size === 0 && this.state === 'processing') this.state = 'idle';
      this.wake?.(); // a freed slot is worth waking the loop for
    });

    this.inFlightJobs.set(job.id, { type, cancellation, settled });
  }

  /** Execute one job: run it, then ack (success/handled-terminal) or nack (retryable). */
  private async runJob(job: TJob, type: string, cancellation: CancellationSource): Promise<void> {
    // Per-job bound context: every line from here on carries the job id without repeating it.
    const jobLogger = this.logger.child({ jobId: job.id, processor: type });
    const started = Date.now();

    this.obs.metrics.counter('worker.jobs.received', 1, { processor: type });
    jobLogger.info('worker.job.start');
    try {
      const execution = await this.components.runner.run(job, cancellation.token);
      const durationMs = Date.now() - started;
      this.obs.metrics.timing('worker.jobs.duration_ms', durationMs, { processor: type });
      this.obs.metrics.counter(execution.ok ? 'worker.jobs.completed' : 'worker.jobs.failed', 1, {
        processor: type,
      });
      jobLogger.record(
        execution.ok ? 'info' : 'error',
        'worker.job.done',
        { durationMs },
        execution.detail,
      );
      await this.components.queue.ack(job.id);
    } catch (error) {
      const durationMs = Date.now() - started;
      this.obs.metrics.counter('worker.jobs.failed', 1, { processor: type });
      this.obs.metrics.timing('worker.jobs.duration_ms', durationMs, { processor: type });
      jobLogger.record(
        'error',
        'worker.job.failed',
        { durationMs },
        { error: error instanceof Error ? error.message : String(error) },
      );
      // A failing nack must not take down the dispatch loop; the broker's visibility timeout will
      // redeliver the job regardless, so swallowing here loses nothing.
      await this.components.queue.nack(job.id, error).catch(() => undefined);
    }
  }

  /**
   * Poll once and run the job to completion before returning. Retained from Phase I-4 for callers
   * that want deterministic single-step execution (tests, and the one-shot drain of a queue).
   */
  async processOnce(): Promise<boolean> {
    const job = await this.components.queue.poll();
    if (job === null) {
      this.obs.metrics.counter('worker.queue.poll_empty');
      return false;
    }
    this.startJob(job);
    await this.inFlightJobs.get(job.id)?.settled;
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
    this.logger.info('worker.draining', { reason, outstanding: this.depth() });

    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.wake !== null) this.wake();
    // Ask every in-flight job to abort promptly (cooperative — nothing is force-killed).
    for (const job of this.inFlightJobs.values()) job.cancellation.cancel();
    // `consume` is defensively guarded, but a rejected loop must never prevent an orderly shutdown.
    await this.loop.catch(() => undefined);
    await this.drain(this.config.app.drainTimeoutMs);

    await this.components.monitor?.stop();
    this.components.runtime.shutdown(); // persists final state via the durable stores
    if (this.health !== null) await this.health.close();

    this.state = 'stopped';
    this.logger.info('worker.shutdown', {
      outstandingJobs: this.depth(),
      abandoned: this.abandonedOnDrain,
      drainDurationMs: Date.now() - drainStart,
      openTraces: this.obs.events.openTraces,
      complete: this.abandonedOnDrain === 0,
    });
    await this.obs.flush(); // last, so the shutdown record itself is flushed
    this.stopped?.();
  }

  // --- Observability ---

  /**
   * The health registry, so a composition root (or an operational test) can register probes for
   * components the application itself does not own — the infrastructure adapters, Chromium, the
   * recovery scheduler. Exposed rather than reached into, because WHICH components exist is a
   * composition decision, not an application one.
   */
  get healthRegistry(): WorkerHealthRegistry {
    return this.obs.health;
  }

  /** The full component health report (powers `/live` and `/ready`). */
  async healthReport(): Promise<WorkerHealthReport> {
    return this.obs.health.report();
  }

  /** The coarse, frontend-compatible snapshot (powers `/health`). */
  async snapshot(): Promise<HealthSnapshot> {
    const report = await this.obs.health.report();
    const storage = report.components.find((c) => c.name === 'runtime-storage');
    return {
      status: coarseStatus(this.state, report),
      state: this.state,
      storage: storage?.status ?? 'unknown',
      recovery: `${this.recoveredCount} recovered`,
      currentJob: this.inFlightJobs.keys().next().value ?? null,
      version: WORKER_VERSION,
      live: report.live,
      ready: report.ready,
      components: report.components.map((c) => ({
        name: c.name,
        status: c.status,
        criticality: c.criticality,
        ...(c.detail === undefined ? {} : { detail: c.detail }),
      })),
    };
  }

  /** The production-debugging document (powers `/diagnostics`). */
  async diagnostics(): Promise<DiagnosticsReport> {
    const composition = this.components.composition ?? {};
    return buildDiagnosticsReport({
      workerVersion: WORKER_VERSION,
      runtimeVersion: RUNTIME_VERSION,
      build: readBuildIdentity(process.env, WORKER_VERSION),
      composition: {
        processors: composition.processors?.() ?? [],
        resources: composition.resources?.() ?? [],
        recoveryHandlers: composition.recoveryHandlers?.() ?? [],
        healthProbes: this.obs.health.names,
        ...this.obs.backends(),
      },
      configuration: {
        ...summarizeConfig(this.config),
        // The live concurrency decision, not just its configuration — an operator asking "why is
        // this worker slow?" needs the allowances in effect right now.
        concurrency: this.concurrency.snapshot(this.knownTypes),
      },
      state: this.state,
      health: await this.obs.health.report(),
      resources: this.components.monitor?.latest() ?? null,
    });
  }

  get appState(): AppState {
    return this.state;
  }

  /** Jobs currently executing in this process (the runtime monitor's `activeJobs` source). */
  get inFlight(): number {
    return this.inFlightJobs.size;
  }

  /** The concurrency controller, so composition can throttle recovery and diagnostics can report. */
  get concurrencyController(): ConcurrencyController {
    return this.concurrency;
  }

  /** Jobs abandoned by a drain that hit its timeout (they return via the broker). */
  get abandonedJobs(): number {
    return this.abandonedOnDrain;
  }

  /**
   * Wait for in-flight jobs to finish, bounded by `timeoutMs`.
   *
   * WHY BOUNDED. A cooperative cancellation cannot interrupt a Chromium render mid-`page.pdf()`; the
   * job simply runs to completion. Waiting indefinitely meant a wedged render could hold shutdown
   * past the orchestrator's grace period, at which point SIGKILL arrives and the runtime never
   * flushes its durable state — the worst outcome available. Abandoning the wait is strictly safer:
   * the abandoned job was never acked, so the broker redelivers it after its visibility timeout, and
   * everything else shuts down cleanly.
   */
  private async drain(timeoutMs: number): Promise<void> {
    const outstanding = [...this.inFlightJobs.values()].map((j) => j.settled);
    if (outstanding.length === 0) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const expired = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
      timer.unref?.();
    });
    try {
      const outcome = await Promise.race([
        Promise.allSettled(outstanding).then(() => 'drained' as const),
        expired,
      ]);
      if (outcome === 'timeout') {
        this.abandonedOnDrain = this.inFlightJobs.size;
        this.logger.warn('worker.drain.timeout', {
          timeoutMs,
          abandoned: this.abandonedOnDrain,
          jobs: [...this.inFlightJobs.keys()],
          note: 'unacked jobs return to the broker on their visibility timeout',
        });
      }
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  /**
   * Probes the APPLICATION owns, as opposed to those a composition root registers. Registered at
   * construction so `/health` is meaningful from the very first request, even before `start()`.
   */
  private registerOwnProbes(): void {
    this.obs.health
      .register(runtimeStorageProbe(this.components.runtime))
      .register(
        memoryProbe({
          softLimitBytes: this.config.observability.memorySoftLimitBytes,
          hardLimitBytes: this.config.observability.memoryHardLimitBytes,
        }),
      )
      .register(configurationProbe(() => summarizeConfig(this.config), this.config.warnings));
    if (this.components.monitor !== undefined) {
      const monitor = this.components.monitor;
      this.obs.health.register(cpuProbe(() => monitor.cpu()));
    }
  }

  /** The minimal startup pass used when a composition root supplies none (the album path). */
  private defaultStartupChecks(): StartupDiagnostics {
    return new StartupDiagnostics(this.logger)
      .check('configuration', true, () =>
        this.config.warnings.length === 0
          ? pass(summarizeConfig(this.config))
          : warn(`${this.config.warnings.length} warning(s)`, {
              warnings: this.config.warnings,
            }),
      )
      .check('runtime-storage', true, () => {
        const report = this.components.runtime.health();
        const storage = report.dependencies.find((d) => d.name === 'storage');
        return storage?.state === 'healthy'
          ? pass({ kind: this.config.runtime.storage.kind })
          : fail(storage?.detail ?? 'durable storage unavailable');
      });
  }

  private depth(): number {
    return this.components.queue instanceof InMemoryQueue ? this.components.queue.depth : 0;
  }

  /**
   * Sleep until the poll interval elapses OR something wakes us — a job freeing a concurrency slot,
   * or shutdown. Early waking is what keeps a busy worker responsive: with lanes full, the loop
   * parks here, and the instant a job settles it re-polls rather than waiting out the timer.
   */
  private idleSleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        if (this.timer !== null) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        this.wake = null;
        resolve();
      };
      this.wake = finish;
      this.timer = setTimeout(finish, ms);
      this.timer.unref?.();
    });
  }
}

/**
 * The concurrency lane a job belongs to. The album path's `WorkerJob` has no `type`, so it falls
 * into a single implicit lane — which is exactly its pre-Phase-I-5 behaviour.
 */
function typeOf(job: { readonly id: string }): string {
  const candidate = (job as { type?: unknown }).type;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'default';
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
 *
 * Note what every processor and handler below is given for observability: `observability.events` — the
 * ONE sink. None of them receives a metrics client or a tracer, and none logs directly; the sink derives
 * all three signals from the events they emit.
 */
async function runProcessorWorker(
  config: AppConfig,
  infraConfig: NonNullable<AppConfig['infrastructure']>,
): Promise<void> {
  const { runtime, logger, observability } = buildRuntime(config);
  const obs = observability;

  // 1. Infrastructure: build the adapters (connectivity is PROVEN by the startup checks below, so a
  //    failure there produces one startup report rather than a bare exception).
  const infraModule = await import('./infra/index.js');
  const infra = infraModule.createInfrastructure(infraConfig);

  // 2. Long-lived resources: Chromium owned by the generic ResourceManager (never launched by a
  //    processor). The manager reports its lifecycle to the observability layer's resource observer.
  const { ResourceManager } = await import('./resources/resource-manager.js');
  const { createBrowserResource } = await import('./resources/browser-resource.js');
  const resources = new ResourceManager(obs.resourceObserver);
  const browser = resources.register(createBrowserResource());

  // 3. Processor registry: image + album-PDF + r2-cleanup (Job → registry → pipeline → stages).
  const processors = await import('./processors/index.js');
  const recovery = await import('./recovery/index.js');
  const registry = new processors.ProcessorRegistry();
  registry.register(
    processors.createImageProcessor({
      objectStore: infra.objectStore,
      database: infra.database,
      codec: processors.createSharpImageCodec(),
      logger,
      events: obs.events,
    }),
  );
  registry.register(
    processors.createPdfProcessor({
      database: infra.database,
      objectStore: infra.objectStore,
      renderer: new processors.PuppeteerPageRenderer(browser),
      appUrl: infraConfig.render.appUrl,
      logger,
      events: obs.events,
    }),
  );
  registry.register(
    processors.createCleanupProcessor({
      objectStore: infra.objectStore,
      logger,
      events: obs.events,
    }),
  );

  // 4. Recovery Coordinator: register the recoverable processors (self-healing), driven by a scheduler.
  const rc = infraConfig.recovery;
  const coordinator = new recovery.RecoveryCoordinator({
    events: obs.events,
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
  // ONE controller is shared by the dispatch loop and the recovery sweep, which is what lets
  // recovery observe production load rather than guess at it.
  const concurrency = new ConcurrencyController({
    config: config.concurrency,
    pressure: memoryPressureSensor(
      config.observability.memorySoftLimitBytes,
      config.observability.memoryHardLimitBytes,
    ),
  });

  const scheduler = rc.enabled
    ? new recovery.PeriodicScheduler(
        async (token) => {
          // THROTTLE, don't disable: recovery is deferred while the worker is busy or under memory
          // pressure, and resumes on the next tick once load drops. Skipping a sweep is free —
          // stale work stays stale and is found later — whereas competing with live customer jobs
          // for a saturated event loop makes both slower.
          if (!concurrency.allowRecovery()) {
            obs.logger.debug('recovery.deferred', { ...concurrency.snapshot(registry.types) });
            return;
          }
          await coordinator.runOnce(token);
        },
        { intervalMs: rc.intervalMs, jitterMs: rc.jitterMs, logger },
      )
    : null;

  // 5. Health probes for everything infrastructure-bound. This is where the graceful-degradation
  //    policy becomes concrete: database/queue/storage are readiness-critical, Chromium only degrades.
  const obsModule = await import('./observability/index.js');
  obs.health
    .register(obsModule.databaseProbe(infra.database))
    .register(obsModule.queueProbe(infra.queue))
    .register(obsModule.objectStoreProbe(infra.objectStore))
    .register(obsModule.chromiumProbe(browser))
    .register(obsModule.resourceManagerProbe(() => resources.stats()))
    .register(obsModule.processorsProbe(() => registry.types))
    .register(
      obsModule.queueCoverageProbe(
        () => infraConfig.queue.queues,
        () => registry.types,
      ),
    );
  if (scheduler !== null) {
    obs.health.register(obsModule.recoverySchedulerProbe(() => scheduler.stats));
  }

  // 6. Resource monitoring: cheap periodic gauges. Browser/page counts come from `peek()`, which never
  //    creates a browser — monitoring must not launch Chromium as a side effect.
  const monitor = new RuntimeMonitor({
    metrics: obs.metrics,
    logger,
    intervalMs: config.observability.monitorIntervalMs,
    sources: {
      activeJobs: () => app.inFlight,
      browsers: async () => {
        const live = browser.peek();
        if (live === null) return null;
        return { browsers: 1, openPages: (await live.pages()).length };
      },
      recoveryBacklog: () => coordinator.backlog,
    },
  });

  // 7. Startup diagnostics: ONE ordered validation pass with an explicit critical/non-critical policy.
  const startup = new StartupDiagnostics(obs.logger)
    .check('configuration', true, () =>
      config.warnings.length === 0
        ? pass(summarizeConfig(config))
        : warn(`${config.warnings.length} warning(s)`, { warnings: config.warnings }),
    )
    .check('environment', true, () => {
      const missing = ['DIRECT_URL', 'R2_ENDPOINT', 'R2_BUCKET_NAME'].filter(
        (name) => (process.env[name] ?? '') === '',
      );
      return missing.length === 0 ? pass() : fail(`missing: ${missing.join(', ')}`);
    })
    // Connectivity: connects the pools + declares the queues, then probes each. Critical — a worker
    // that cannot reach its infrastructure must exit, not sit in a crash loop pretending to be ready.
    .check('infrastructure', true, async () => {
      const probes = await infraModule.preflightInfrastructure(infra);
      return pass({ probes });
    })
    // Chromium is NON-critical: unavailable means PDF rendering is unavailable, not that image
    // hardening should stop. The worker starts degraded and keeps processing everything else.
    .check('chromium', false, async () => {
      const configured = process.env['PUPPETEER_EXECUTABLE_PATH'];
      if (configured !== undefined && configured.length > 0) {
        const { existsSync } = await import('node:fs');
        return existsSync(configured)
          ? pass({ executablePath: configured })
          : warn(`PUPPETEER_EXECUTABLE_PATH not found: ${configured}`);
      }
      const puppeteer = (await import('puppeteer')).default;
      const path = puppeteer.executablePath();
      // Resolved lazily and NOT launched — a startup check must not pay a browser launch.
      return path.length > 0
        ? pass({ executablePath: path })
        : warn('no Chromium executable found');
    })
    .check('processors', true, () =>
      registry.types.length > 0
        ? pass({ types: registry.types })
        : fail('no processors registered'),
    )
    // Non-critical, but LOUD at boot: an operator must learn about an unserved queue from the
    // startup report, not from a customer asking why cover thumbnails never appear.
    .check('queue-coverage', false, () => {
      const unserved = infraConfig.queue.queues.filter((q) => !registry.types.includes(q));
      return unserved.length === 0
        ? pass({ served: registry.types })
        : warn(`no processor for: ${unserved.join(', ')} — those jobs accumulate unprocessed`, {
            unserved,
          });
    })
    .check('recovery', false, () =>
      scheduler === null
        ? warn('recovery scheduler disabled')
        : pass({ handlers: coordinator.handlers, intervalMs: rc.intervalMs }),
    )
    .check('resources', true, () => pass({ registered: resources.registered }));

  // 8. Drive the generic worker over the pg-boss queue with the processor runner.
  const runner = new processors.ProcessorJobRunner(new JobRouter(registry));
  const components: AppComponents<Job> = {
    runtime,
    queue: infra.queue,
    logger,
    runner,
    observability: obs,
    startup,
    monitor,
    concurrency,
    composition: {
      processors: () => registry.types,
      resources: () => resources.registered,
      recoveryHandlers: () => coordinator.handlers,
    },
  };
  const app = new WorkerApplication<Job>(config, components);

  await driveApp(app, {
    // The recovery sweep starts only AFTER startup validation has passed, so a worker that is about
    // to abort never begins sweeping (and never re-drives work it cannot finish).
    onReady: () => scheduler?.start(),
    cleanup: async () => {
      await scheduler?.stop(); // stop the recovery sweep (cancels + awaits the in-flight run)
      await resources.shutdown(); // graceful Chromium teardown
      const closed = await infraModule.closeInfrastructure(infra);
      obs.logger.info('infra.closed', closed);
    },
  });
}

interface DriveHooks {
  /** Runs once the app has started and passed validation. */
  readonly onReady?: () => void;
  readonly cleanup?: () => Promise<void>;
}

/** Install signal handlers, start + consume until stopped, then run optional cleanup. Shared by both paths. */
async function driveApp<TJob extends { readonly id: string }>(
  app: WorkerApplication<TJob>,
  hooks: DriveHooks = {},
): Promise<void> {
  const removeSignals = installSignalHandlers((signal) => {
    void app.stop(`signal:${signal}`);
  });
  try {
    await app.start();
    hooks.onReady?.();
    app.begin();
    await app.whenStopped();
  } finally {
    removeSignals();
    if (hooks.cleanup !== undefined) await hooks.cleanup();
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
