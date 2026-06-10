import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { env } from './env.js';

// Read our own version without a JSON import-assertion (keeps Node/tsx happy across
// versions). worker/src/health-server.ts → ../package.json = worker/package.json.
const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

/**
 * Minimal availability endpoint for the worker service.
 *
 * On Render Free the worker is a Web Service that spins down when idle; an inbound
 * HTTP request wakes it. This server is BOTH the port Render needs to route traffic
 * AND the readiness signal the app probes (`ensureWorkerReady` in the app). It is
 * deliberately a thin "is the process up?" check:
 *
 *   GET /health → 200 { status, version, timestamp }
 *
 * It exposes NO secrets, NO queue depth, NO env, NO internal diagnostics — only
 * confirmation that the service is reachable. (The deeper guarantee that jobs are
 * actually being drained still comes from pg-boss + the periodic sweep.)
 */
export function startHealthServer(): void {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];

    if (req.method === 'GET' && (path === '/health' || path === '/')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ status: 'ok', version, timestamp: new Date().toISOString() }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  // Bind first thing on boot so Render can route the wake-up request immediately.
  server.listen(env.PORT, () => {
    console.log(`[worker] health server listening on :${env.PORT} (GET /health)`);
  });

  server.on('error', (e) => console.error('[worker] health server error:', e));
}
