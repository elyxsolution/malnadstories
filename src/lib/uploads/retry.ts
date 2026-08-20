/**
 * UPLOAD FAILURE CLASSIFICATION + BACKOFF — the pure decision layer behind automatic retry.
 *
 * WHY IT IS ITS OWN FILE. The Upload Manager already owns the queue, the lanes and the
 * lifecycle; adding "is this worth retrying, and when?" inline would have buried two
 * independent policies inside a scheduler. Everything here is PURE — no timers, no network,
 * no DOM, no React — so the policy can be reasoned about (and exercised) on its own, and the
 * manager keeps exactly one job: acting on the verdict.
 *
 * THE CENTRAL RULE: classify on the HTTP STATUS, never on an exception string. A 502 from a
 * proxy answers with an HTML error page, so `res.json()` throws `SyntaxError: Unexpected
 * token '<'` — and treating that message as the failure both hides a retryable outage behind
 * a nonsense error and shows the customer a parser diagnostic. The status is read first, the
 * body is parsed only when it is plausibly JSON, and the raw HTML never reaches a user.
 */

/** Why an attempt failed. Drives both the retry decision and the counter it increments. */
export type FailureKind =
  /** No usable connection: fetch rejected, XHR error, or `xhr.status === 0`. */
  | 'network'
  /** The request was alive but stopped moving (total timeout, or no progress for too long). */
  | 'timeout'
  /** The server answered, but with a 5xx / 408 / 425 — the request may succeed later. */
  | 'server'
  /** 429 (or a 503 carrying `Retry-After`): we are being asked to slow down. */
  | 'rate-limit'
  /** Deterministic. Retrying the identical request cannot change the outcome. */
  | 'permanent';

export type Classification = {
  /** Whether an automatic retry is allowed at all. */
  readonly transient: boolean;
  readonly kind: FailureKind;
  /**
   * Server-directed delay in ms, parsed from `Retry-After`. When present it OVERRIDES the
   * local backoff — ignoring it would mean fighting our own rate limiter.
   */
  readonly retryAfterMs: number | null;
  /** User-facing message. Never raw HTML, never a JSON parser diagnostic. */
  readonly message: string;
};

/**
 * Statuses that mean "try again later".
 *   408 Request Timeout · 425 Too Early · 429 Too Many Requests
 *   500/502/503/504 — including presign's own 503, which is the deliberate
 *   `workerConfigOk()` gate (a transient deploy condition, not a client error).
 */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Everything else in 4xx is deterministic: 400/401/403/404/409 and friends. */
export function isTransientStatus(status: number): boolean {
  if (TRANSIENT_STATUS.has(status)) return true;
  // Any other 5xx is treated as transient; unknown 4xx are not.
  return status >= 500 && status < 600;
}

/**
 * `Retry-After` is either delta-seconds or an HTTP-date (RFC 9110 §10.2.3). Both are honoured;
 * anything unparseable, negative, or absurd falls back to local backoff rather than trusting a
 * malformed header to park an upload for an hour.
 */
export const MAX_RETRY_AFTER_MS = 60_000;

export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number | null {
  if (!header) return null;
  const raw = header.trim();
  if (raw === '') return null;

  // delta-seconds
  if (/^\d+$/.test(raw)) {
    const ms = Number(raw) * 1000;
    if (!Number.isFinite(ms) || ms < 0) return null;
    return Math.min(ms, MAX_RETRY_AFTER_MS);
  }

  // HTTP-date
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  const ms = at - now;
  if (ms <= 0) return 0;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

/**
 * Classify an HTTP response. `serverMessage` is the parsed `{ error }` field when the body was
 * JSON — used only for PERMANENT failures, where the server's wording is the useful thing to
 * show. For transient failures we deliberately substitute our own copy, because "Internal
 * Server Error" (or a chunk of HTML) tells the customer nothing actionable.
 */
export function classifyResponse(
  status: number,
  retryAfterHeader: string | null | undefined,
  serverMessage: string | null,
  fallback: string,
): Classification {
  const retryAfterMs = parseRetryAfter(retryAfterHeader);

  if (status === 429 || (status === 503 && retryAfterMs !== null)) {
    return { transient: true, kind: 'rate-limit', retryAfterMs, message: 'Server busy — retrying shortly' };
  }
  if (isTransientStatus(status)) {
    return { transient: true, kind: 'server', retryAfterMs, message: 'Server unavailable — retrying' };
  }
  return {
    transient: false,
    kind: 'permanent',
    retryAfterMs: null,
    message: serverMessage && serverMessage.trim() !== '' ? serverMessage : fallback,
  };
}

/** A connection-level failure (fetch rejection, `xhr.onerror`, `xhr.status === 0`). */
export function networkFailure(message = 'No connection — retrying'): Classification {
  return { transient: true, kind: 'network', retryAfterMs: null, message };
}

/** A request that was alive but stopped progressing. Same retry path as a network failure. */
export function timeoutFailure(message = 'Upload stalled — retrying'): Classification {
  return { transient: true, kind: 'timeout', retryAfterMs: null, message };
}

/** A deterministic client-side rejection (bad type, oversize, invariant violation). */
export function permanentFailure(message: string): Classification {
  return { transient: false, kind: 'permanent', retryAfterMs: null, message };
}

// ── backoff ────────────────────────────────────────────────────────────────────────

/**
 * BACKOFF, derived from the system's own numbers rather than invented:
 *   • base 1000 ms — the worker's `WV2_POLL_INTERVAL_MS`; retrying faster than the backend
 *     ticks achieves nothing.
 *   • ×2 — the same factor `PeriodicScheduler.backoffFactor` uses, so the codebase has one
 *     backoff convention.
 *   • cap 30 s — `enqueueImageHardening` uses `retryDelay: 30`, and the confirm rate-limit
 *     window is 60 s, so a 30 s ceiling keeps at most two retries inside one window.
 *   • ±25 % jitter — six lanes failing together must not re-fire in lockstep. Mirrors the
 *     worker's `WV2_RECOVERY_JITTER_MS` (15 s on a 60 s interval).
 *   • 4 attempts — between the broker's `retryLimit: 3` (hardening) and `5` (cleanup); the
 *     nominal 1+2+4+8 s ≈ 15 s of added latency stays under a handful of poll ticks.
 */
export const RETRY_BASE_MS = 1000;
export const RETRY_FACTOR = 2;
export const RETRY_MAX_DELAY_MS = 30_000;
export const RETRY_JITTER = 0.25;
export const MAX_AUTO_ATTEMPTS = 4;

/**
 * Delay before automatic attempt number `autoAttempt` (0-based: 0 ⇒ the first retry).
 * `random` is injectable so the sequence can be asserted deterministically.
 */
export function backoffDelay(autoAttempt: number, random: () => number = Math.random): number {
  const n = Math.max(0, Math.floor(autoAttempt));
  const raw = Math.min(RETRY_BASE_MS * RETRY_FACTOR ** n, RETRY_MAX_DELAY_MS);
  // ±25 %, so two tasks that failed in the same millisecond do not retry in the same one.
  const factor = 1 + (random() * 2 - 1) * RETRY_JITTER;
  return Math.max(0, Math.round(raw * factor));
}
