import { describe, it, expect } from 'vitest';
import {
  InMemoryMetricsProvider,
  MemoryLogSink,
  ObservabilityLogger,
  ResilientMetricsProvider,
  RuntimeMonitor,
  StartupDiagnostics,
  StartupError,
  buildDiagnosticsReport,
  fail,
  pass,
  readBuildIdentity,
  readPlatformInfo,
  warn,
} from '../src/observability/index.js';
import { noopLogger } from '@workerv2/worker-runtime';

function build(): { startup: StartupDiagnostics; logs: MemoryLogSink } {
  const logs = new MemoryLogSink();
  return {
    startup: new StartupDiagnostics(new ObservabilityLogger({ level: 'trace', sink: logs })),
    logs,
  };
}

describe('startup diagnostics — one report', () => {
  it('runs checks in order and emits a SINGLE consolidated report', async () => {
    const { startup, logs } = build();
    const order: string[] = [];
    startup
      .check('configuration', true, () => {
        order.push('configuration');
        return pass({ storage: 'memory' });
      })
      .check('database', true, () => {
        order.push('database');
        return pass();
      })
      .check('chromium', false, () => {
        order.push('chromium');
        return pass();
      });

    const report = await startup.run();

    expect(order).toEqual(['configuration', 'database', 'chromium']);
    expect(report.overall).toBe('pass');
    expect(report.checks.map((c) => c.name)).toEqual(['configuration', 'database', 'chromium']);
    expect(report.checks.every((c) => typeof c.durationMs === 'number')).toBe(true);
    // ONE record, not one per check.
    expect(logs.withMessage('worker.startup.report')).toHaveLength(1);
    expect(logs.withMessage('worker.startup.report')[0]?.level).toBe('info');
  });

  it('validates the full set of subsystems the phase requires', async () => {
    const { startup } = build();
    for (const name of [
      'configuration',
      'environment',
      'database',
      'storage',
      'chromium',
      'queue',
      'processors',
      'recovery',
      'resources',
    ]) {
      startup.check(name, false, () => pass());
    }
    expect(startup.names).toEqual([
      'configuration',
      'environment',
      'database',
      'storage',
      'chromium',
      'queue',
      'processors',
      'recovery',
      'resources',
    ]);
    expect((await startup.run()).checks).toHaveLength(9);
  });
});

describe('startup diagnostics — fail fast vs graceful degradation', () => {
  it('a CRITICAL failure aborts startup and skips the remaining checks', async () => {
    const { startup, logs } = build();
    let reached = false;
    startup
      .check('database', true, () => fail('postgres unreachable'))
      .check('storage', true, () => {
        reached = true;
        return pass();
      });

    await expect(startup.run()).rejects.toBeInstanceOf(StartupError);
    // Probing R2 after Postgres is already known-unreachable buys nothing.
    expect(reached).toBe(false);
    expect(logs.withMessage('worker.startup.report')[0]?.level).toBe('fatal');
  });

  it('the thrown error carries the report, so the failure log shows what ran before it', async () => {
    const { startup } = build();
    startup
      .check('configuration', true, () => pass())
      .check('database', true, () => fail('postgres unreachable'));

    await expect(startup.run()).rejects.toMatchObject({
      name: 'StartupError',
      check: 'database',
    });
    let captured: StartupError | null = null;
    await startup.run().catch((e: unknown) => {
      captured = e as StartupError;
    });
    const error = captured as unknown as StartupError;
    expect(error.report.checks.map((c) => c.name)).toEqual(['configuration', 'database']);
    expect(error.message).toMatch(/postgres unreachable/);
  });

  it('a NON-critical failure only warns — the worker starts degraded', async () => {
    const { startup, logs } = build();
    startup
      .check('chromium', false, () => fail('no Chromium executable'))
      .check('processors', true, () => pass({ types: ['image-hardening'] }));

    const report = await startup.run();
    expect(report.overall).toBe('warn'); // NOT fail — image hardening still works
    expect(report.checks).toHaveLength(2);
    expect(logs.withMessage('worker.startup.report')[0]?.level).toBe('warn');
  });

  it('a check that throws is recorded as a failure rather than escaping', async () => {
    const { startup } = build();
    startup.check('database', false, () => {
      throw new Error('connection refused');
    });
    const report = await startup.run();
    expect(report.checks[0]).toMatchObject({ status: 'fail', detail: 'connection refused' });
    expect(report.overall).toBe('warn');
  });

  it('warnings propagate to the overall verdict without failing', async () => {
    const { startup } = build();
    startup.check('configuration', true, () => warn('2 warning(s)'));
    expect((await startup.run()).overall).toBe('warn');
  });
});

describe('diagnostics report', () => {
  it('carries identity, platform, composition, configuration and state', () => {
    const report = buildDiagnosticsReport({
      workerVersion: '1.2.3',
      runtimeVersion: '0.9.0',
      build: readBuildIdentity(
        { WORKER_V2_VERSION: '1.2.3', GIT_COMMIT: 'abc1234', NODE_ENV: 'production' },
        '1.2.3',
      ),
      composition: {
        processors: ['image-hardening', 'album-pdf', 'r2-cleanup'],
        resources: ['chromium'],
        recoveryHandlers: ['image-hardening', 'album-pdf'],
        healthProbes: ['database', 'queue'],
        metricsBackend: 'resilient(in-memory+logging)',
        tracingBackend: 'default(sample=1)',
        logSinks: ['json', 'memory'],
      },
      configuration: { storage: 'filesystem', infrastructure: 'enabled' },
      state: 'idle',
    });

    expect(report.workerVersion).toBe('1.2.3');
    expect(report.runtimeVersion).toBe('0.9.0');
    expect(report.build).toMatchObject({
      version: '1.2.3',
      gitSha: 'abc1234',
      environment: 'production',
      nodeVersion: process.version,
    });
    expect(report.platform).toMatchObject({ nodeVersion: process.version, pid: process.pid });
    expect(report.platform.cpuCount).toBeGreaterThan(0);
    expect(report.composition.processors).toContain('album-pdf');
    expect(report.composition.metricsBackend).toBe('resilient(in-memory+logging)');
    expect(report.state).toBe('idle');
  });

  it('falls back to "unknown" instead of failing when build metadata is absent', () => {
    const build = readBuildIdentity({}, '0.0.0');
    expect(build.gitSha).toBe('unknown');
    expect(build.builtAt).toBe('unknown');
    expect(build.environment).toBe('unknown');
  });

  it("reads the deployment platform's own commit variables", () => {
    expect(readBuildIdentity({ RENDER_GIT_COMMIT: 'deadbeef' }, '0.0.0').gitSha).toBe('deadbeef');
    expect(readBuildIdentity({ GITHUB_SHA: 'cafe' }, '0.0.0').gitSha).toBe('cafe');
  });

  it('never reads secrets — only the caller-supplied, already-redacted summary', () => {
    const report = buildDiagnosticsReport({
      workerVersion: '0.0.0',
      runtimeVersion: '0.0.0',
      build: readBuildIdentity({}, '0.0.0'),
      composition: {
        processors: [],
        resources: [],
        recoveryHandlers: [],
        healthProbes: [],
        metricsBackend: 'noop',
        tracingBackend: 'noop',
        logSinks: [],
      },
      configuration: { storage: 'memory' },
      state: 'idle',
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/postgres:\/\//);
    expect(serialized).not.toMatch(/secret/i);
    expect(readPlatformInfo().hostname.length).toBeGreaterThan(0);
  });
});

describe('resource monitoring', () => {
  it('samples process + composition state and emits gauges', async () => {
    const metrics = new InMemoryMetricsProvider();
    const monitor = new RuntimeMonitor({
      metrics,
      logger: noopLogger,
      intervalMs: 60_000,
      trackEventLoop: false,
      sources: {
        activeJobs: () => 2,
        queueDepth: () => 7,
        browsers: async () => ({ browsers: 1, openPages: 3 }),
        recoveryBacklog: () => 5,
      },
    });

    const snapshot = await monitor.sample();

    expect(snapshot.memory.rssBytes).toBeGreaterThan(0);
    expect(snapshot).toMatchObject({
      activeJobs: 2,
      queueDepth: 7,
      browsers: 1,
      openPages: 3,
      recoveryBacklog: 5,
    });
    expect(snapshot.cpu).toBeNull(); // no baseline on the first sample

    const gauges = metrics.samples.filter((s) => s.type === 'gauge').map((s) => s.name);
    expect(gauges).toEqual(
      expect.arrayContaining([
        'worker.process.memory_rss_bytes',
        'worker.process.memory_heap_used_bytes',
        'worker.jobs.active',
        'worker.queue.depth',
        'worker.resource.browser_pages_open',
        'worker.recovery.backlog',
      ]),
    );
    expect(monitor.latest()).toBe(snapshot);
  });

  it('produces a CPU reading once a baseline exists', async () => {
    const metrics = new InMemoryMetricsProvider();
    let now = 0;
    const monitor = new RuntimeMonitor({
      metrics,
      logger: noopLogger,
      intervalMs: 60_000,
      trackEventLoop: false,
      now: () => (now += 1_000),
    });
    await monitor.sample();
    const second = await monitor.sample();
    expect(second.cpu).not.toBeNull();
    expect(second.cpu?.userPercent).toBeGreaterThanOrEqual(0);
    expect(monitor.cpu()).toEqual(second.cpu);
  });

  it('a throwing source degrades to null instead of destabilising monitoring', async () => {
    const monitor = new RuntimeMonitor({
      metrics: new InMemoryMetricsProvider(),
      logger: noopLogger,
      intervalMs: 60_000,
      trackEventLoop: false,
      sources: {
        activeJobs: () => {
          throw new Error('boom');
        },
        queueDepth: () => {
          throw new Error('broker down');
        },
      },
    });
    const snapshot = await monitor.sample();
    expect(snapshot.activeJobs).toBe(0);
    expect(snapshot.queueDepth).toBeNull();
  });

  it('omits sources that are not cheaply available', async () => {
    const metrics = new InMemoryMetricsProvider();
    const monitor = new RuntimeMonitor({
      metrics,
      logger: noopLogger,
      intervalMs: 60_000,
      trackEventLoop: false,
    });
    const snapshot = await monitor.sample();
    expect(snapshot.queueDepth).toBeNull();
    expect(snapshot.browsers).toBeNull();
    expect(metrics.samples.some((s) => s.name === 'worker.queue.depth')).toBe(false);
  });

  it('starts and stops cleanly', async () => {
    const monitor = new RuntimeMonitor({
      metrics: new InMemoryMetricsProvider(),
      logger: noopLogger,
      intervalMs: 60_000,
      trackEventLoop: false,
    });
    monitor.start();
    monitor.start(); // idempotent
    await monitor.stop();
    expect(monitor.latest()).toBeNull();
  });
});

describe('metrics degradation', () => {
  it('a failing metrics backend falls back to no-op after repeated failures', () => {
    let calls = 0;
    const notices: number[] = [];
    const provider = new ResilientMetricsProvider(
      {
        counter: (): void => {
          calls += 1;
          throw new Error('collector unreachable');
        },
        gauge: (): void => {},
        histogram: (): void => {},
        timing: (): void => {},
      },
      (failures) => notices.push(failures),
      2,
    );

    expect(() => {
      provider.counter('a');
      provider.counter('b');
      provider.counter('c');
      provider.counter('d');
    }).not.toThrow();

    expect(calls).toBe(2); // stops calling the broken backend
    expect(provider.isDegraded).toBe(true);
    expect(notices).toEqual([2]); // reported exactly once
  });
});
