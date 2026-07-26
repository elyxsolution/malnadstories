import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { WorkerHealthReport } from './observability/index.js';

/**
 * THE HEALTH ENDPOINTS — the operator- and orchestrator-facing surface of the health system.
 *
 * FOUR endpoints, each answering a different question:
 *
 *   GET /health       Is the worker ready? (the pre-existing contract — see COMPATIBILITY below)
 *   GET /live         Should a supervisor RESTART this process?      → liveness
 *   GET /ready        Should this process be GIVEN MORE WORK?        → readiness
 *   GET /diagnostics  What exactly is this process, and what is it wired to?
 *
 * The liveness/readiness split is the point. Restarting a worker whose Chromium has crashed throws
 * away in-flight image jobs to fix nothing; removing it from rotation while its database is
 * unreachable is right, but restarting it is not. `/live` is deliberately hard to fail — only a
 * `liveness`-critical component can — while `/ready` fails for anything that makes new work unsafe.
 *
 * COMPATIBILITY: the Next.js app probes the worker with `checkWorker` and treats it as available only
 * when the body is `{ status: 'ok' }`. That contract is preserved EXACTLY — `/health` still returns
 * the coarse `status` field with the same four values and the same 200/503 mapping. The richer Phase
 * I-4 fields (live/ready/components) are ADDED alongside it, so no information is lost and nothing
 * downstream breaks.
 *
 * This service is OBSERVATIONAL: it only reads snapshots the application provides and never influences
 * execution. When no port is configured the worker runs headless and it is not started.
 */

/** Coarse readiness for the app's probe: `ok` == ready to serve; anything else == not ready. */
export type HealthStatus = 'ok' | 'degraded' | 'starting' | 'stopped';

export interface HealthSnapshot {
  /** Frontend-compatible coarse status. `ok` iff the worker is ready. UNCHANGED contract. */
  readonly status: HealthStatus;
  readonly state: string;
  readonly storage: string;
  readonly recovery: string;
  readonly currentJob: string | null;
  readonly version: string;
  // --- Phase I-4 additions (purely additive) ---
  /** Can the worker continue running? */
  readonly live?: boolean;
  /** Can the worker safely accept more work? */
  readonly ready?: boolean;
  /** Per-component health, so a 503 says WHICH component caused it. */
  readonly components?: readonly {
    readonly name: string;
    readonly status: string;
    readonly criticality: string;
    readonly detail?: string;
  }[];
}

/** The handlers the application supplies. Only `snapshot` is required. */
export interface HealthEndpoints {
  snapshot(): Promise<HealthSnapshot> | HealthSnapshot;
  /** Full component report, powering `/live` and `/ready`. */
  report?(): Promise<WorkerHealthReport> | WorkerHealthReport;
  /** The full diagnostics document. */
  diagnostics?(): Promise<unknown> | unknown;
  /**
   * Shared secret guarding the DETAILED endpoints (Phase I-6). Unset (the default) DISABLES
   * `/diagnostics` entirely and strips the per-component `data` blobs from `/ready`.
   *
   * Why this exists: the worker's health port is publicly reachable — that is how the Next.js app
   * probes it — and the detailed endpoints disclose hostname, CPU model, core count, memory, PID,
   * the registered composition, and the resolved configuration shape. None of that is a secret, but
   * none of it should be handed to the internet either; it is exactly the reconnaissance an attacker
   * wants. `/health` and `/live` stay open, because the app's gate and the orchestrator's probe
   * depend on them and they carry only coarse status.
   */
  readonly detailToken?: string;
}

export interface HealthService {
  /** The actually-bound port (resolves an ephemeral `0` request to the real port — useful for tests). */
  readonly port: number;
  close(): Promise<void>;
}

/** Start the HTTP health server on `port`, serving the supplied endpoints. */
export function startHealthServer(
  port: number,
  endpoints: HealthEndpoints,
): Promise<HealthService> {
  const server: Server = createServer((req, res) => {
    // A probe must never be able to crash the worker, so every handler is fully guarded and any
    // failure is reported as an unhealthy 503 rather than an unhandled rejection.
    void handle(req.url ?? '/', endpoints, req.headers.authorization)
      .then(({ statusCode, body }) => {
        res.writeHead(statusCode, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      })
      .catch((error: unknown) => {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'degraded',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
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

/** Constant-time bearer comparison, so the token cannot be recovered by timing the responses. */
function authorized(header: string | undefined, expected: string | undefined): boolean {
  if (expected === undefined || expected.length === 0) return false;
  const presented = header?.startsWith('Bearer ') === true ? header.slice(7) : '';
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Strip the per-component `data` blobs, leaving only names and statuses. */
function redactReport(report: WorkerHealthReport): unknown {
  return {
    status: report.status,
    live: report.live,
    ready: report.ready,
    checkedAt: report.checkedAt,
    components: report.components.map((c) => ({
      name: c.name,
      status: c.status,
      criticality: c.criticality,
      ...(c.detail === undefined ? {} : { detail: c.detail }),
    })),
  };
}

async function handle(
  url: string,
  endpoints: HealthEndpoints,
  authorization: string | undefined,
): Promise<{ statusCode: number; body: unknown }> {
  const path = url.split('?')[0] ?? '/';
  const detailed = authorized(authorization, endpoints.detailToken);

  if (path === '/health' || path === '/') {
    const snapshot = await endpoints.snapshot();
    // The pre-existing contract: 200 iff `status === 'ok'`.
    return { statusCode: snapshot.status === 'ok' ? 200 : 503, body: snapshot };
  }

  if (path === '/live') {
    if (endpoints.report === undefined) {
      // No component report wired: the process is answering HTTP, so it is alive by definition.
      return { statusCode: 200, body: { live: true } };
    }
    const report = await endpoints.report();
    return {
      statusCode: report.live ? 200 : 503,
      body: {
        live: report.live,
        status: report.status,
        checkedAt: report.checkedAt,
        // Only the components that can actually fail liveness — a focused answer, not a data dump.
        components: report.components
          .filter((c) => c.criticality === 'liveness')
          .map((c) => ({
            name: c.name,
            status: c.status,
            ...(c.detail === undefined ? {} : { detail: c.detail }),
          })),
      },
    };
  }

  if (path === '/ready') {
    if (endpoints.report === undefined) {
      const snapshot = await endpoints.snapshot();
      return { statusCode: snapshot.status === 'ok' ? 200 : 503, body: snapshot };
    }
    const report = await endpoints.report();
    // Full detail only for an authenticated caller; otherwise names + statuses, which is everything
    // an orchestrator needs to decide rotation.
    return {
      statusCode: report.ready ? 200 : 503,
      body: detailed ? report : redactReport(report),
    };
  }

  if (path === '/diagnostics') {
    if (endpoints.diagnostics === undefined) {
      return { statusCode: 404, body: { error: 'diagnostics not available' } };
    }
    if (!detailed) {
      // 404, not 401: an unauthenticated caller learns nothing, not even that the endpoint exists.
      return { statusCode: 404, body: { error: 'not found' } };
    }
    return { statusCode: 200, body: await endpoints.diagnostics() };
  }

  return { statusCode: 404, body: { error: 'not found' } };
}

/**
 * Collapse the fine-grained lifecycle state + the component report into the coarse `status` the app's
 * probe consumes. It lives here, beside the contract it serves, rather than inside the application —
 * `WorkerApplication` should own the lifecycle, not the wire format of a health response.
 *
 * `status` is a READINESS verdict, not a summary of the aggregate report. A running worker is `ok`
 * iff `report.ready` — i.e. no `liveness`- or `readiness`-critical component is `unhealthy`. It is
 * deliberately NOT derived from `report.status`, which is the worst status across EVERY component
 * INCLUDING `informational` ones (see `WorkerHealthRegistry.report`).
 *
 * That distinction is the whole point of the criticality model. Folding the aggregate in here
 * inverted it: `queue-coverage` is permanently `degraded` (the app declares `cover-thumbnail` and
 * `blueprint-thumbnail`, which this worker does not serve) and a degraded Chromium is the documented
 * graceful-degradation case — neither stops image hardening, yet both made `/health` answer 503, and
 * the app's `checkWorker` reads a non-200 as "worker unreachable" and blocks uploads at the gate.
 * `certification.test.ts` already asserts the invariant this now honours: an unserved queue must not
 * pull the worker out of rotation for the work it DOES serve.
 *
 * Nothing is hidden by this: the aggregate status, every component's status, and its `detail` all
 * still ride in the `/health` body's `components[]` and in the full `/ready` report.
 */
export function coarseStatus(lifecycle: string, report: WorkerHealthReport | null): HealthStatus {
  switch (lifecycle) {
    case 'idle':
    case 'processing':
      if (report === null) return 'ok';
      return report.ready ? 'ok' : 'degraded';
    case 'starting':
    case 'recovering':
      return 'starting';
    case 'stopped':
      return 'stopped';
    default:
      return 'degraded';
  }
}
