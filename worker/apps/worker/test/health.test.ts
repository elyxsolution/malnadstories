import { describe, it, expect } from 'vitest';
import { InMemoryStorageBackend, RecordingLogger } from '@workerv2/worker-runtime';
import { loadAppConfig } from '../src/config.js';
import { bootstrapApp } from '../src/bootstrap.js';
import { WorkerApplication } from '../src/main.js';
import { startHealthServer } from '../src/health.js';
import type { HealthSnapshot } from '../src/health.js';
import { MemoryLogSink } from '../src/observability/index.js';

/**
 * The FRONTEND-COMPATIBILITY suite. The Next.js app gates worker-dependent operations on
 * `GET /health` returning `{ status: 'ok' }` with a 200, so that contract is asserted here
 * explicitly — Phase I-4 enriches the payload but must never change those two things.
 */

function buildApp(): WorkerApplication {
  const config = loadAppConfig({ WV2_POLL_INTERVAL_MS: '5' });
  const components = bootstrapApp(config, {
    logger: new RecordingLogger(),
    backend: new InMemoryStorageBackend(),
    sink: new MemoryLogSink(), // keep the app's own structured output out of the test console
  });
  return new WorkerApplication(config, components);
}

const readySnapshot: HealthSnapshot = {
  status: 'ok',
  state: 'idle',
  storage: 'healthy',
  recovery: '0 recovered',
  currentJob: null,
  version: '0.0.0',
};

describe('health snapshot status (frontend compatibility)', () => {
  it('reports status "ok" once idle with healthy storage (what the app probe requires)', async () => {
    const app = buildApp();
    expect((await app.snapshot()).status).toBe('starting'); // before start
    await app.start();
    const snap = await app.snapshot();
    expect(snap.status).toBe('ok');
    // Richer Worker V2 fields are preserved alongside the coarse status — no information lost.
    expect(snap).toMatchObject({ state: 'idle', storage: 'healthy', version: '0.0.0' });
    // Phase I-4 additions ride ALONGSIDE the unchanged contract.
    expect(snap.live).toBe(true);
    expect(snap.ready).toBe(true);
    expect(snap.components?.map((c) => c.name).sort()).toEqual([
      'configuration',
      'memory',
      'runtime-storage',
    ]);
    await app.stop('test');
    expect((await app.snapshot()).status).toBe('stopped');
  });
});

describe('health HTTP endpoints', () => {
  it('serves 200 + {status:"ok"} on /health when ready (the exact shape checkWorker expects)', async () => {
    const service = await startHealthServer(0, { snapshot: () => readySnapshot });
    try {
      const res = await fetch(`http://127.0.0.1:${service.port}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('ok');
    } finally {
      await service.close();
    }
  });

  it('serves 503 when not ready', async () => {
    const notReady: HealthSnapshot = { ...readySnapshot, status: 'starting', state: 'starting' };
    const service = await startHealthServer(0, { snapshot: () => notReady });
    try {
      const res = await fetch(`http://127.0.0.1:${service.port}/health`);
      expect(res.status).toBe(503);
    } finally {
      await service.close();
    }
  });

  it('serves /live, /ready and /diagnostics from a running application', async () => {
    const app = buildApp();
    await app.start();
    // Phase I-6: `/diagnostics` and the detailed `/ready` payload are gated behind a bearer token
    // (unset = disabled), because the health port is publicly reachable. See certification.test.ts.
    const service = await startHealthServer(0, {
      snapshot: () => app.snapshot(),
      report: () => app.healthReport(),
      diagnostics: () => app.diagnostics(),
      detailToken: 'test-token',
    });
    const authed = { headers: { authorization: 'Bearer test-token' } };
    try {
      const base = `http://127.0.0.1:${service.port}`;

      const live = await fetch(`${base}/live`);
      expect(live.status).toBe(200);
      expect(((await live.json()) as { live: boolean }).live).toBe(true);

      const ready = await fetch(`${base}/ready`);
      expect(ready.status).toBe(200);
      expect(((await ready.json()) as { ready: boolean }).ready).toBe(true);

      const diagnostics = await fetch(`${base}/diagnostics`, authed);
      expect(diagnostics.status).toBe(200);
      const report = (await diagnostics.json()) as {
        workerVersion: string;
        platform: { nodeVersion: string };
        composition: { healthProbes: string[] };
      };
      expect(report.workerVersion).toBe('0.0.0');
      expect(report.platform.nodeVersion).toBe(process.version);
      expect(report.composition.healthProbes).toContain('memory');

      expect((await fetch(`${base}/nope`)).status).toBe(404);
    } finally {
      await service.close();
      await app.stop('test');
    }
  });
});
