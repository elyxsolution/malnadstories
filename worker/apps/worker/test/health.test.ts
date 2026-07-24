import { describe, it, expect } from 'vitest';
import { InMemoryStorageBackend, RecordingLogger } from '@workerv2/worker-runtime';
import { loadAppConfig } from '../src/config.js';
import { bootstrapApp } from '../src/bootstrap.js';
import { WorkerApplication } from '../src/main.js';
import { startHealthServer } from '../src/health.js';
import type { HealthSnapshot } from '../src/health.js';

function buildApp(): WorkerApplication {
  const config = loadAppConfig({ WV2_POLL_INTERVAL_MS: '5' });
  const components = bootstrapApp(config, {
    logger: new RecordingLogger(),
    backend: new InMemoryStorageBackend(),
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
    expect(app.snapshot().status).toBe('starting'); // before start
    await app.start();
    const snap = app.snapshot();
    expect(snap.status).toBe('ok');
    // Richer Worker V2 fields are preserved alongside the coarse status — no information lost.
    expect(snap).toMatchObject({ state: 'idle', storage: 'healthy', version: '0.0.0' });
    await app.stop('test');
    expect(app.snapshot().status).toBe('stopped');
  });
});

describe('health HTTP endpoint', () => {
  it('serves 200 + {status:"ok"} when ready (the exact shape checkWorker expects)', async () => {
    const service = await startHealthServer(0, () => readySnapshot);
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
    const service = await startHealthServer(0, () => notReady);
    try {
      const res = await fetch(`http://127.0.0.1:${service.port}/health`);
      expect(res.status).toBe(503);
    } finally {
      await service.close();
    }
  });
});
