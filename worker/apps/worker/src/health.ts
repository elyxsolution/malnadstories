import { createServer } from 'node:http';
import type { Server } from 'node:http';

/**
 * A lightweight, OBSERVATIONAL health service. When a port is configured it exposes `GET /health`
 * (and `/`) returning a JSON snapshot — lifecycle state, storage status, recovery status, current
 * job, and version — for Render/K8s probes. It NEVER influences execution: it only reads a snapshot
 * the application provides. When no port is configured the worker runs headless (a background worker
 * binds no port) and this service is simply not started.
 */

export interface HealthSnapshot {
  readonly state: string;
  readonly storage: string;
  readonly recovery: string;
  readonly currentJob: string | null;
  readonly version: string;
}

export type HealthProvider = () => HealthSnapshot;

export interface HealthService {
  close(): Promise<void>;
}

/** Start the HTTP health server on `port`, reporting the snapshot from `provider`. */
export function startHealthServer(port: number, provider: HealthProvider): Promise<HealthService> {
  const server: Server = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      const snapshot = provider();
      const ready = snapshot.state === 'idle' || snapshot.state === 'processing';
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
      resolve({
        close: (): Promise<void> => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
