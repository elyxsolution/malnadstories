import { createServer } from 'node:http';
import type { Server } from 'node:http';

/**
 * A lightweight, OBSERVATIONAL health service. When a port is configured it exposes `GET /health`
 * (and `/`) returning a JSON snapshot — a top-level `status` plus lifecycle state, storage status,
 * recovery status, current job, and version — for Render/K8s probes. It NEVER influences execution: it
 * only reads a snapshot the application provides. When no port is configured the worker runs headless
 * (a background worker binds no port) and this service is simply not started.
 *
 * COMPATIBILITY: the application's own probe (`src/lib/worker/health.ts`, `checkWorker`) treats the
 * worker as ready only when the body is `{ status: 'ok' }`. So the snapshot carries a coarse `status`
 * for that contract ALONGSIDE the richer Worker V2 fields — no health information is lost.
 */

/** Coarse readiness for the app's probe: `ok` == ready to serve; anything else == not ready. */
export type HealthStatus = 'ok' | 'degraded' | 'starting' | 'stopped';

export interface HealthSnapshot {
  /** Frontend-compatible coarse status. `ok` iff the worker is ready (idle/processing + storage healthy). */
  readonly status: HealthStatus;
  readonly state: string;
  readonly storage: string;
  readonly recovery: string;
  readonly currentJob: string | null;
  readonly version: string;
}

export type HealthProvider = () => HealthSnapshot;

export interface HealthService {
  /** The actually-bound port (resolves an ephemeral `0` request to the real port — useful for tests). */
  readonly port: number;
  close(): Promise<void>;
}

/** Start the HTTP health server on `port`, reporting the snapshot from `provider`. */
export function startHealthServer(port: number, provider: HealthProvider): Promise<HealthService> {
  const server: Server = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      const snapshot = provider();
      const ready = snapshot.status === 'ok';
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify(snapshot));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return new Promise<HealthService>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      const address = server.address();
      const boundPort = typeof address === 'object' && address !== null ? address.port : port;
      resolve({
        port: boundPort,
        close: (): Promise<void> => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
