import { describe, it, expect } from 'vitest';
import { InMemoryStorageBackend, RecordingLogger } from '@workerv2/worker-runtime';
import { loadAppConfig, summarizeConfig } from '../src/config.js';
import { bootstrapApp } from '../src/bootstrap.js';
import { WorkerApplication } from '../src/main.js';
import { startHealthServer } from '../src/health.js';
import {
  MemoryLogSink,
  ObservabilityLogger,
  WorkerHealthRegistry,
  queueCoverageProbe,
} from '../src/observability/index.js';
import { WORKER_QUEUES } from '../src/infra/config.js';

/**
 * PRODUCTION CERTIFICATION — regression tests for the issues the Phase I-6 audit found.
 *
 * Each of these pins a defect that was real at the start of certification, so it cannot silently
 * return. They are deliberately narrow: this phase fixed problems, it did not add features.
 */

function buildApp(env: NodeJS.ProcessEnv = {}): { app: WorkerApplication; sink: MemoryLogSink } {
  const config = loadAppConfig({ WV2_POLL_INTERVAL_MS: '5', ...env });
  const sink = new MemoryLogSink();
  const components = bootstrapApp(config, {
    logger: new RecordingLogger(),
    backend: new InMemoryStorageBackend(),
    sink,
  });
  return { app: new WorkerApplication(config, components), sink };
}

describe('BLOCKER: queues the application enqueues onto but no processor serves', () => {
  /**
   * The app enqueues `cover-thumbnail` and `blueprint-thumbnail`; Worker V2 implements neither.
   * The jobs are durable and not lost, but the features silently never happen. The gap is now
   * reported continuously instead of being discoverable only by reading two codebases side by side.
   */
  it('reports unserved queues as degraded, naming them', async () => {
    const registry = new WorkerHealthRegistry();
    registry.register(
      queueCoverageProbe(
        () => WORKER_QUEUES,
        () => ['image-hardening', 'album-pdf', 'r2-cleanup'],
      ),
    );
    const report = await registry.report();
    const coverage = report.components.find((c) => c.name === 'queue-coverage');

    expect(coverage?.status).toBe('degraded');
    expect(coverage?.data?.['unserved']).toEqual(['cover-thumbnail', 'blueprint-thumbnail']);
    // Informational: an unserved queue must not pull the worker out of rotation for the work it
    // DOES serve.
    expect(report.ready).toBe(true);
    expect(report.live).toBe(true);
  });

  it('is healthy once every declared queue has a processor', async () => {
    const registry = new WorkerHealthRegistry();
    registry.register(
      queueCoverageProbe(
        () => ['image-hardening'],
        () => ['image-hardening', 'album-pdf'],
      ),
    );
    expect((await registry.report()).status).toBe('healthy');
  });
});

describe('SECURITY: the public health port must not disclose internals', () => {
  it('DISABLES /diagnostics when no token is configured (safe by default)', async () => {
    const { app } = buildApp();
    await app.start();
    const service = await startHealthServer(0, {
      snapshot: () => app.snapshot(),
      report: () => app.healthReport(),
      diagnostics: () => app.diagnostics(),
    });
    try {
      const res = await fetch(`http://127.0.0.1:${service.port}/diagnostics`);
      expect(res.status).toBe(404); // not 401 — an anonymous caller learns nothing
    } finally {
      await service.close();
      await app.stop('test');
    }
  });

  it('redacts the per-component data blobs from an unauthenticated /ready', async () => {
    const { app } = buildApp();
    await app.start();
    const service = await startHealthServer(0, {
      snapshot: () => app.snapshot(),
      report: () => app.healthReport(),
      diagnostics: () => app.diagnostics(),
      detailToken: 'sekrit',
    });
    try {
      const anon = (await (await fetch(`http://127.0.0.1:${service.port}/ready`)).json()) as {
        ready: boolean;
        components: { name: string; data?: unknown }[];
      };
      expect(anon.ready).toBe(true); // still usable as a readiness gate
      expect(anon.components.every((c) => c.data === undefined)).toBe(true);
      // The configuration shape (app URL, lanes, thresholds, hostname) is not disclosed.
      expect(JSON.stringify(anon)).not.toMatch(/memorySoftLimit|storageRoot|lanes/);

      const authed = (await (
        await fetch(`http://127.0.0.1:${service.port}/ready`, {
          headers: { authorization: 'Bearer sekrit' },
        })
      ).json()) as { components: { name: string; data?: unknown }[] };
      expect(authed.components.some((c) => c.data !== undefined)).toBe(true);
    } finally {
      await service.close();
      await app.stop('test');
    }
  });

  it('serves /diagnostics only to a correct bearer token', async () => {
    const { app } = buildApp();
    await app.start();
    const service = await startHealthServer(0, {
      snapshot: () => app.snapshot(),
      report: () => app.healthReport(),
      diagnostics: () => app.diagnostics(),
      detailToken: 'correct-horse',
    });
    try {
      const base = `http://127.0.0.1:${service.port}/diagnostics`;
      expect((await fetch(base)).status).toBe(404);
      expect((await fetch(base, { headers: { authorization: 'Bearer wrong' } })).status).toBe(404);
      expect(
        (await fetch(base, { headers: { authorization: 'Bearer correct-horse' } })).status,
      ).toBe(200);
    } finally {
      await service.close();
      await app.stop('test');
    }
  });

  it('keeps /health and /live open — the app gate and orchestrator probe depend on them', async () => {
    const { app } = buildApp();
    await app.start();
    const service = await startHealthServer(0, {
      snapshot: () => app.snapshot(),
      report: () => app.healthReport(),
      detailToken: 'sekrit',
    });
    try {
      const health = await fetch(`http://127.0.0.1:${service.port}/health`);
      expect(health.status).toBe(200);
      expect(((await health.json()) as { status: string }).status).toBe('ok');
      expect((await fetch(`http://127.0.0.1:${service.port}/live`)).status).toBe(200);
    } finally {
      await service.close();
      await app.stop('test');
    }
  });

  it('never puts the diagnostics token in the configuration summary', () => {
    const summary = summarizeConfig(loadAppConfig({ WV2_DIAGNOSTICS_TOKEN: 'super-secret-value' }));
    expect(JSON.stringify(summary)).not.toMatch(/super-secret-value/);
    expect(summary['diagnosticsProtected']).toBe(true);
  });

  it('treats an empty token as unset rather than as a token that matches ""', () => {
    expect(loadAppConfig({ WV2_DIAGNOSTICS_TOKEN: '   ' }).app.diagnosticsToken).toBeNull();
    expect(loadAppConfig({}).app.diagnosticsToken).toBeNull();
  });
});

describe('SECRET HYGIENE across the observability layer', () => {
  it('redacts a print token that reaches a log detail bag', () => {
    // The PDF payload carries a raw print token. Nothing logs `job.payload` wholesale (audited), but
    // if a detail bag ever carried one, the sanitizer is the backstop.
    const sink = new MemoryLogSink();
    const logger = new ObservabilityLogger({ level: 'info', sink });
    logger.info('pdf.debug', { albumId: 'a1', token: 'raw-print-token', tokenHash: 'abc' });
    const record = sink.withMessage('pdf.debug')[0];
    expect(record?.detail).toMatchObject({ albumId: 'a1', token: '[redacted]' });
    expect(JSON.stringify(record)).not.toMatch(/raw-print-token/);
  });
});
