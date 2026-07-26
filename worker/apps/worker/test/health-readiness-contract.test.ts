import { describe, it, expect } from 'vitest';
import { InMemoryStorageBackend, RecordingLogger } from '@workerv2/worker-runtime';
import { loadAppConfig } from '../src/config.js';
import { bootstrapApp } from '../src/bootstrap.js';
import { WorkerApplication } from '../src/main.js';
import { startHealthServer } from '../src/health.js';
import {
  MemoryLogSink,
  chromiumProbe,
  databaseProbe,
  memoryProbe,
  objectStoreProbe,
  queueCoverageProbe,
} from '../src/observability/index.js';
import { WORKER_QUEUES } from '../src/infra/config.js';

/**
 * THE HTTP READINESS CONTRACT — `GET /health` answers "should this worker be given work?", and its
 * status code must be driven by `report.ready`, NOT by `report.status`.
 *
 * The distinction is the entire point of the criticality model. `report.status` is the worst status
 * across EVERY component, `informational` ones included, so it is a diagnostic summary. `report.ready`
 * is the serve/don't-serve verdict: false only when a `liveness`- or `readiness`-critical component is
 * `unhealthy`. `coarseStatus` used to fold the former into the coarse `status`, which meant the
 * permanently-degraded `queue-coverage` probe (the app declares `cover-thumbnail` and
 * `blueprint-thumbnail`; this worker serves neither) made a fully capable worker answer 503. The
 * Next.js app's `checkWorker` reads any non-200 as "worker unreachable", so the browser upload gate
 * polled for 90s and refused to upload against a worker that was idle and ready.
 *
 * These tests assert the contract at the WIRE, over a real health server with real probes, because
 * the status code is what the app's gate actually consumes. The invariant, stated once:
 *
 *     HTTP 200  ⟺  the worker can process jobs  ⟺  report.ready === true
 *
 * Every case also asserts that the diagnostic detail SURVIVES — a 200 must not mean the degradation
 * was swallowed. It is still in `report.status` and in `components[]`, where an operator reads it.
 */

function buildApp(): WorkerApplication {
  const config = loadAppConfig({ WV2_POLL_INTERVAL_MS: '5' });
  const components = bootstrapApp(config, {
    logger: new RecordingLogger(),
    backend: new InMemoryStorageBackend(),
    sink: new MemoryLogSink(),
  });
  return new WorkerApplication(config, components);
}

interface HealthBody {
  readonly status: string;
  readonly state: string;
  readonly live?: boolean;
  readonly ready?: boolean;
  readonly components?: readonly { name: string; status: string; criticality: string }[];
}

/** Serve `/health` for one app on an ephemeral port and hand the probe result to `assert`. */
async function probeHealth(
  app: WorkerApplication,
  assert: (res: { code: number; body: HealthBody }) => void | Promise<void>,
): Promise<void> {
  const service = await startHealthServer(0, {
    snapshot: () => app.snapshot(),
    report: () => app.healthReport(),
  });
  try {
    const res = await fetch(`http://127.0.0.1:${service.port}/health`);
    await assert({ code: res.status, body: (await res.json()) as HealthBody });
  } finally {
    await service.close();
  }
}

const component = (body: HealthBody, name: string): { status: string; criticality: string } | undefined =>
  body.components?.find((c) => c.name === name);

describe('/health readiness contract — 200 iff the worker can process jobs', () => {
  // ── 1. Healthy ────────────────────────────────────────────────────────────────────────────────
  it('healthy worker (ready=true, status=healthy) → HTTP 200', async () => {
    const app = buildApp();
    await app.start();
    try {
      expect((await app.healthReport()).status).toBe('healthy');
      await probeHealth(app, ({ code, body }) => {
        expect(code).toBe(200);
        expect(body.status).toBe('ok');
        expect(body.ready).toBe(true);
        expect(body.live).toBe(true);
      });
    } finally {
      await app.stop('test');
    }
  });

  // ── 2. Informational degradation (the reported defect) ────────────────────────────────────────
  it('ready worker with an INFORMATIONAL degradation (queue-coverage) → HTTP 200', async () => {
    const app = buildApp();
    await app.start();
    app.healthRegistry.register(
      queueCoverageProbe(
        () => WORKER_QUEUES,
        () => ['image-hardening', 'album-pdf', 'r2-cleanup'],
      ),
    );
    try {
      // The aggregate IS degraded — that is intended, and must not change.
      const report = await app.healthReport();
      expect(report.status).toBe('degraded');
      expect(report.ready).toBe(true);

      await probeHealth(app, ({ code, body }) => {
        expect(code).toBe(200); // what the app's upload gate checks
        expect(body.status).toBe('ok'); // what `checkWorker` compares against
        expect(body.ready).toBe(true);
        // Diagnostics preserved: the operator still sees exactly which queues are unserved.
        expect(component(body, 'queue-coverage')).toMatchObject({
          status: 'degraded',
          criticality: 'informational',
        });
      });
    } finally {
      await app.stop('test');
    }
  });

  // ── 3. Database unavailable ───────────────────────────────────────────────────────────────────
  it('DATABASE unavailable (readiness-critical unhealthy, ready=false) → HTTP 503', async () => {
    const app = buildApp();
    await app.start();
    app.healthRegistry.register(databaseProbe({ healthCheck: async () => 'unhealthy' }, 0));
    try {
      expect((await app.healthReport()).ready).toBe(false);
      await probeHealth(app, ({ code, body }) => {
        expect(code).toBe(503);
        expect(body.ready).toBe(false);
        expect(body.live).toBe(true); // an external outage is not a reason to restart
        expect(component(body, 'database')?.status).toBe('unhealthy');
      });
    } finally {
      await app.stop('test');
    }
  });

  // ── 4. Shutting down ──────────────────────────────────────────────────────────────────────────
  it('worker SHUTTING DOWN → HTTP 503', async () => {
    const app = buildApp();
    await app.start();
    await app.stop('test');
    await probeHealth(app, ({ code, body }) => {
      expect(code).toBe(503);
      expect(body.status).toBe('stopped');
      expect(body.state).toBe('stopped');
    });
  });

  // ── 5. Storage unavailable ────────────────────────────────────────────────────────────────────
  it('OBJECT STORAGE unavailable (readiness-critical unhealthy) → HTTP 503', async () => {
    const app = buildApp();
    await app.start();
    app.healthRegistry.register(objectStoreProbe({ healthCheck: async () => 'unhealthy' }, 0));
    try {
      expect((await app.healthReport()).ready).toBe(false);
      await probeHealth(app, ({ code, body }) => {
        expect(code).toBe(503);
        expect(body.ready).toBe(false);
        expect(component(body, 'storage')?.status).toBe('unhealthy');
      });
    } finally {
      await app.stop('test');
    }
  });

  // ── 6. Chromium unavailable — PDFs degrade, image hardening does not ──────────────────────────
  it('CHROMIUM unavailable (readiness DEGRADED, not unhealthy) → HTTP 200, still degraded in components[]', async () => {
    const app = buildApp();
    await app.start();
    app.healthRegistry.register(chromiumProbe({ health: async () => 'unhealthy' }, 0));
    try {
      const report = await app.healthReport();
      expect(report.status).toBe('degraded'); // PDF rendering is impaired…
      expect(report.ready).toBe(true); // …but image hardening + cleanup are not

      await probeHealth(app, ({ code, body }) => {
        expect(code).toBe(200);
        expect(body.status).toBe('ok');
        expect(body.ready).toBe(true);
        expect(component(body, 'chromium')).toMatchObject({
          status: 'degraded',
          criticality: 'readiness',
        });
      });
    } finally {
      await app.stop('test');
    }
  });

  // ── Remaining 503 examples from the contract ──────────────────────────────────────────────────
  it('MEMORY above the hard limit (refusing new work) → HTTP 503', async () => {
    const app = buildApp();
    await app.start();
    app.healthRegistry.register(
      memoryProbe({ softLimitBytes: 100, hardLimitBytes: 200 }, () => ({
        rss: 500,
        heapTotal: 0,
        heapUsed: 0,
        external: 0,
        arrayBuffers: 0,
      })),
    );
    try {
      await probeHealth(app, ({ code, body }) => {
        expect(code).toBe(503);
        expect(body.ready).toBe(false);
        expect(component(body, 'memory')?.status).toBe('unhealthy');
      });
    } finally {
      await app.stop('test');
    }
  });

  it('STARTUP not yet complete → HTTP 503', async () => {
    const app = buildApp(); // never started
    await probeHealth(app, ({ code, body }) => {
      expect(code).toBe(503);
      expect(body.status).toBe('starting');
    });
  });

  // ── The invariant itself ──────────────────────────────────────────────────────────────────────
  it('the status code tracks `ready` exactly — informational noise never changes it', async () => {
    const app = buildApp();
    await app.start();
    try {
      // Pile on every non-blocking condition at once: an unserved queue AND a dead Chromium.
      app.healthRegistry.register(
        queueCoverageProbe(
          () => WORKER_QUEUES,
          () => ['image-hardening'],
        ),
      );
      app.healthRegistry.register(chromiumProbe({ health: async () => 'unhealthy' }, 0));
      await probeHealth(app, ({ code, body }) => {
        expect(code).toBe(200);
        expect(body.ready).toBe(true);
      });

      // Now add ONE readiness-critical failure — and only now does it flip.
      app.healthRegistry.register(databaseProbe({ healthCheck: async () => 'unhealthy' }, 0));
      await probeHealth(app, ({ code, body }) => {
        expect(code).toBe(503);
        expect(body.ready).toBe(false);
      });

      // Recovery is symmetric: the database comes back, the worker returns to rotation while the
      // informational + degraded components are untouched.
      app.healthRegistry.register(databaseProbe({ healthCheck: async () => 'healthy' }, 0));
      await probeHealth(app, ({ code, body }) => {
        expect(code).toBe(200);
        expect(body.ready).toBe(true);
        expect(component(body, 'queue-coverage')?.status).toBe('degraded');
        expect(component(body, 'chromium')?.status).toBe('degraded');
      });
    } finally {
      await app.stop('test');
    }
  });

  it('/live is unaffected — a not-ready worker is still alive and must not be restarted', async () => {
    const app = buildApp();
    await app.start();
    app.healthRegistry.register(databaseProbe({ healthCheck: async () => 'unhealthy' }, 0));
    const service = await startHealthServer(0, {
      snapshot: () => app.snapshot(),
      report: () => app.healthReport(),
    });
    try {
      expect((await fetch(`http://127.0.0.1:${service.port}/health`)).status).toBe(503);
      expect((await fetch(`http://127.0.0.1:${service.port}/live`)).status).toBe(200);
    } finally {
      await service.close();
      await app.stop('test');
    }
  });
});
