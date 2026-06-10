import 'server-only';

/**
 * Server-side worker availability service.
 *
 * The worker runs as a SEPARATE service (Render) that may spin down when idle. Its
 * URL is a server-only secret — it must NEVER reach the browser. All probing happens
 * here on the server; the client only ever talks to our own `/api/worker/health`
 * route (which calls into this module).
 *
 * ── Fail-open (dev) vs fail-closed (prod) ──────────────────────────────────────────
 * If WORKER_URL is unset or invalid:
 *   - DEVELOPMENT  → treat as "ready" (fail OPEN). The worker often shares the dev
 *                    machine with no public URL; blocking would wreck the DX.
 *   - PRODUCTION   → treat as a hard misconfiguration (fail CLOSED). We NEVER silently
 *                    continue a worker-dependent operation when the worker is
 *                    unconfigured/unreachable — the caller surfaces a clear error.
 *
 * `checkWorker()` is one quick probe returning a structured result (so callers can
 * distinguish "asleep, waking may help" from "misconfigured, waking won't help").
 * `probeWorker()` is the boolean shorthand. `ensureWorkerReady()` is the canonical
 * "block until up (or give up)" helper, polling every 5s for up to 90s. The
 * interactive UX drives that loop client-side (for a live timer) via the route, but
 * over the SAME primitive.
 */

const IS_PROD = process.env.NODE_ENV === 'production';

/** Normalize + validate WORKER_URL once. Invalid (or missing) → null. */
function resolveWorkerUrl(): string | null {
  const raw = process.env.WORKER_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return raw.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

const WORKER_URL = resolveWorkerUrl();

const PROBE_TIMEOUT_MS = 4000;
const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 90_000;

export type NotReadyReason = 'unreachable' | 'misconfigured';
export type ProbeResult = { ready: true } | { ready: false; reason: NotReadyReason };

/**
 * Cheap, NETWORK-FREE config check. True when a worker-dependent op is allowed to
 * START on the server without first proving liveness:
 *   - prod: only when WORKER_URL is configured + valid (else hard fail-closed),
 *   - dev:  always (fail-open for DX).
 * Use this at the entry of an enqueue path (e.g. upload presign) to reject a
 * misconfigured deploy immediately, without a per-request probe.
 */
export function workerConfigOk(): boolean {
  if (IS_PROD) return WORKER_URL !== null;
  return true;
}

/** True when a worker URL is configured + valid. */
export function workerConfigured(): boolean {
  return WORKER_URL !== null;
}

/**
 * Single availability probe. `{ ready: true }` if the worker answers `/health` with
 * `{ status: 'ok' }` within `timeoutMs`. Otherwise `{ ready: false, reason }`:
 *   - 'misconfigured' → WORKER_URL missing/invalid in prod (waking can't help),
 *   - 'unreachable'   → configured but no healthy response (likely asleep — wake it).
 * When unconfigured in DEV it returns `{ ready: true }` (gating disabled).
 */
export async function checkWorker(timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  if (!WORKER_URL) {
    if (!IS_PROD) return { ready: true }; // dev fail-open
    return { ready: false, reason: 'misconfigured' }; // prod fail-closed
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${WORKER_URL}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return { ready: false, reason: 'unreachable' };
    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    return body?.status === 'ok' ? { ready: true } : { ready: false, reason: 'unreachable' };
  } catch {
    return { ready: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/** Boolean shorthand for callers that only need go/no-go. */
export async function probeWorker(timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return (await checkWorker(timeoutMs)).ready;
}

export type WorkerReady = { ready: true } | { ready: false; reason: 'timeout' | NotReadyReason };

/**
 * Wake-and-wait: probe immediately, then poll every `intervalMs` until the worker is
 * healthy or `maxWaitMs` elapses. A 'misconfigured' result returns immediately (no
 * point polling). Bounded by design — never an unbounded loop.
 */
export async function ensureWorkerReady(opts?: {
  maxWaitMs?: number;
  intervalMs?: number;
}): Promise<WorkerReady> {
  const maxWaitMs = opts?.maxWaitMs ?? MAX_WAIT_MS;
  const intervalMs = opts?.intervalMs ?? POLL_INTERVAL_MS;
  const start = Date.now();

  const first = await checkWorker();
  if (first.ready) return { ready: true };
  if (first.reason === 'misconfigured') return { ready: false, reason: 'misconfigured' };

  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const r = await checkWorker();
    if (r.ready) return { ready: true };
    if (r.reason === 'misconfigured') return { ready: false, reason: 'misconfigured' };
  }
  return { ready: false, reason: 'timeout' };
}
