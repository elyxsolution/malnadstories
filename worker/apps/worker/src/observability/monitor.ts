import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { StructuredLogger } from '@workerv2/worker-runtime';
import { PeriodicScheduler } from '../recovery/scheduler.js';
import type { MetricsProvider } from './metrics.js';
import { WORKER_METRICS } from './metric-names.js';

/**
 * RESOURCE MONITORING — a periodic sampler that turns process + composition state into GENERIC
 * METRICS. It exposes no dashboard and serves no UI: it emits gauges through the `MetricsProvider`
 * and keeps the latest sample in memory for the health probes and `/diagnostics` to read.
 *
 * REUSE: the scheduling is Phase I-3's `PeriodicScheduler` — it already solves jittered intervals,
 * non-overlapping runs, backoff on failure, cancellation, and graceful stop. Writing a second timer
 * loop here would duplicate all of that.
 *
 * EVERY SOURCE IS OPTIONAL AND CHEAP. Queue depth, browser/page counts and recovery backlog are
 * supplied as injected callbacks, and any of them may be absent — the prompt's "queue depth (if
 * cheaply available)" constraint is expressed in the type. A source that throws is swallowed and
 * reported as `null`: monitoring must never destabilise the thing it monitors.
 */

export interface CpuSample {
  /** Percent of ONE core spent in user code since the previous sample (can exceed 100 on many cores). */
  readonly userPercent: number;
  readonly systemPercent: number;
}

export interface ResourceSnapshot {
  readonly at: string;
  readonly memory: {
    readonly rssBytes: number;
    readonly heapUsedBytes: number;
    readonly heapTotalBytes: number;
    readonly externalBytes: number;
  };
  readonly cpu: CpuSample | null;
  readonly uptimeSeconds: number;
  readonly activeJobs: number;
  readonly queueDepth: number | null;
  readonly browsers: number | null;
  readonly openPages: number | null;
  readonly recoveryBacklog: number | null;
  /** Mean event-loop delay since the previous sample — the earliest sign of a blocked worker. */
  readonly eventLoopDelayMs: number | null;
}

/** Browser-level counts, when a browser resource is live. */
export interface BrowserStats {
  readonly browsers: number;
  readonly openPages: number;
}

/** The (all optional) state providers the monitor samples. Each must be cheap and non-blocking. */
export interface MonitorSources {
  /** Jobs currently executing in this process. */
  readonly activeJobs?: () => number;
  /** Broker depth — supply ONLY if the adapter can answer without a scan. */
  readonly queueDepth?: () => number | null | Promise<number | null>;
  /** Live browser + open page counts. */
  readonly browsers?: () => BrowserStats | null | Promise<BrowserStats | null>;
  /** Items awaiting recovery as of the last sweep. */
  readonly recoveryBacklog?: () => number | null;
}

export interface RuntimeMonitorOptions {
  readonly metrics: MetricsProvider;
  readonly logger: StructuredLogger;
  /** Sampling interval (ms). */
  readonly intervalMs: number;
  readonly sources?: MonitorSources;
  /** Injectable clock (tests). */
  readonly now?: () => number;
  /** Disable the event-loop histogram (it holds a libuv handle; tests prefer it off). */
  readonly trackEventLoop?: boolean;
}

export class RuntimeMonitor {
  private readonly scheduler: PeriodicScheduler;
  private readonly metrics: MetricsProvider;
  private readonly sources: MonitorSources;
  private readonly now: () => number;
  private readonly loopDelay: ReturnType<typeof monitorEventLoopDelay> | null;
  private lastCpu: NodeJS.CpuUsage | null = null;
  private lastCpuAt: number | null = null;
  private snapshot: ResourceSnapshot | null = null;

  constructor(options: RuntimeMonitorOptions) {
    this.metrics = options.metrics;
    this.sources = options.sources ?? {};
    this.now = options.now ?? ((): number => Date.now());
    this.loopDelay =
      options.trackEventLoop === false ? null : monitorEventLoopDelay({ resolution: 20 });
    this.scheduler = new PeriodicScheduler(async () => void (await this.sample()), {
      intervalMs: options.intervalMs,
      jitterMs: Math.min(1_000, Math.floor(options.intervalMs / 10)),
      logger: options.logger,
    });
  }

  /** Begin sampling. The first sample lands after one interval. */
  start(): void {
    this.loopDelay?.enable();
    this.scheduler.start();
  }

  /** Stop sampling and await the in-flight sample. */
  async stop(): Promise<void> {
    await this.scheduler.stop();
    this.loopDelay?.disable();
  }

  /** The most recent sample, or `null` before the first one. */
  latest(): ResourceSnapshot | null {
    return this.snapshot;
  }

  /** The most recent CPU reading (the shape `cpuProbe` consumes). */
  cpu(): CpuSample | null {
    return this.snapshot?.cpu ?? null;
  }

  /**
   * Take one sample: read process state, poll the optional sources, emit gauges, retain the result.
   * Public so a test (or a manual "run checks now" action) can sample deterministically without
   * waiting for the timer.
   */
  async sample(): Promise<ResourceSnapshot> {
    const mem = process.memoryUsage();
    const cpu = this.readCpu();
    const [queueDepth, browserStats] = await Promise.all([
      safe(this.sources.queueDepth),
      safe(this.sources.browsers),
    ]);
    const activeJobs = safeSync(this.sources.activeJobs) ?? 0;
    const recoveryBacklog = safeSync(this.sources.recoveryBacklog) ?? null;

    let eventLoopDelayMs: number | null = null;
    if (this.loopDelay !== null) {
      const mean = this.loopDelay.mean;
      eventLoopDelayMs = Number.isFinite(mean) ? Number((mean / 1e6).toFixed(3)) : null;
      this.loopDelay.reset();
    }

    const snapshot: ResourceSnapshot = {
      at: new Date(this.now()).toISOString(),
      memory: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        externalBytes: mem.external,
      },
      cpu,
      uptimeSeconds: Math.round(process.uptime()),
      activeJobs,
      queueDepth: queueDepth ?? null,
      browsers: browserStats?.browsers ?? null,
      openPages: browserStats?.openPages ?? null,
      recoveryBacklog,
      eventLoopDelayMs,
    };

    this.emit(snapshot);
    this.snapshot = snapshot;
    return snapshot;
  }

  private emit(s: ResourceSnapshot): void {
    const m = this.metrics;
    m.gauge(WORKER_METRICS.memoryRssBytes, s.memory.rssBytes);
    m.gauge(WORKER_METRICS.memoryHeapUsedBytes, s.memory.heapUsedBytes);
    m.gauge(WORKER_METRICS.memoryHeapTotalBytes, s.memory.heapTotalBytes);
    m.gauge(WORKER_METRICS.memoryExternalBytes, s.memory.externalBytes);
    m.gauge(WORKER_METRICS.uptimeSeconds, s.uptimeSeconds);
    m.gauge(WORKER_METRICS.jobsActive, s.activeJobs);
    if (s.cpu !== null) {
      m.gauge(WORKER_METRICS.cpuUserPercent, s.cpu.userPercent);
      m.gauge(WORKER_METRICS.cpuSystemPercent, s.cpu.systemPercent);
    }
    if (s.eventLoopDelayMs !== null) m.gauge(WORKER_METRICS.eventLoopDelayMs, s.eventLoopDelayMs);
    if (s.queueDepth !== null) m.gauge(WORKER_METRICS.queueDepth, s.queueDepth);
    if (s.browsers !== null)
      m.gauge(WORKER_METRICS.resourcesLive, s.browsers, { resource: 'chromium' });
    if (s.openPages !== null) m.gauge(WORKER_METRICS.browserPagesOpen, s.openPages);
    if (s.recoveryBacklog !== null) m.gauge(WORKER_METRICS.recoveryBacklog, s.recoveryBacklog);
  }

  /** CPU percent since the previous sample. The first sample has no baseline, so it reports null. */
  private readCpu(): CpuSample | null {
    const at = this.now();
    const usage = process.cpuUsage();
    const previous = this.lastCpu;
    const previousAt = this.lastCpuAt;
    this.lastCpu = usage;
    this.lastCpuAt = at;
    if (previous === null || previousAt === null) return null;
    const elapsedMs = at - previousAt;
    if (elapsedMs <= 0) return null;
    const elapsedMicros = elapsedMs * 1_000;
    return {
      userPercent: round2(((usage.user - previous.user) / elapsedMicros) * 100),
      systemPercent: round2(((usage.system - previous.system) / elapsedMicros) * 100),
    };
  }
}

function round2(value: number): number {
  return Number(Math.max(0, value).toFixed(2));
}

async function safe<T>(source: (() => T | Promise<T>) | undefined): Promise<T | null> {
  if (source === undefined) return null;
  try {
    return await source();
  } catch {
    return null; // a monitoring source must never destabilise the monitor
  }
}

function safeSync<T>(source: (() => T) | undefined): T | null {
  if (source === undefined) return null;
  try {
    return source();
  } catch {
    return null;
  }
}
