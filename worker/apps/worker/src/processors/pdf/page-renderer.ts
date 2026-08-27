/**
 * THE PAGE RENDERER PORT — the seam between the PDF pipeline and the concrete browser renderer. The
 * pipeline depends only on this interface (`url → pdf bytes`), so it is unit-tested with a fake renderer
 * (no Chromium) while `PuppeteerPageRenderer` is the production implementation. This is the placement
 * decision: browser rendering is a managed RESOURCE + an infrastructure adapter, never something the
 * pipeline owns directly.
 */

/** Per-stage render timeouts (ms). Defaults mirror the hardened V1 budgets. */
export interface RenderTimeouts {
  readonly newPageMs: number;
  readonly navigationMs: number;
  readonly readinessMs: number;
  /** In-page fonts/decode settle cap (passed into the page). */
  readonly settleMs: number;
  readonly pdfMs: number;
}

export const DEFAULT_RENDER_TIMEOUTS: RenderTimeouts = {
  newPageMs: 20_000,
  navigationMs: 45_000,
  readinessMs: 45_000,
  settleMs: 12_000,
  pdfMs: 60_000,
};

export interface RenderRequest {
  /** The print-route URL (token in the query string). NEVER log this — see `redactToken`. */
  readonly url: string;
  /**
   * The render target's ORIGIN only (`https://host:port`) — no path, no query, no token. This is
   * the safe half of the URL: it is what an operator needs to diagnose a connection failure, and
   * it can be logged, stored and shown in the admin console freely.
   */
  readonly origin: string;
  /** The in-page global that flips `true` when the album has finished painting. */
  readonly readinessFlag: string;
  readonly timeouts: RenderTimeouts;
}

export interface RenderResult {
  readonly pdf: Uint8Array;
  readonly httpStatus: number;
}

/** Raised when the print route responds with a non-OK HTTP status (permanent — the page won't render). */
export class PrintRouteError extends Error {
  constructor(readonly httpStatus: number) {
    super(`print route returned HTTP ${httpStatus}`);
    this.name = 'PrintRouteError';
  }
}

/** Raised when the renderer's browser crashed/disconnected mid-render (transient — a rebuild + retry can succeed). */
export class RendererCrashedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RendererCrashedError';
  }
}

/**
 * Why the render target could not be reached AT ALL — no HTTP response was ever produced.
 *
 *   dns       the hostname does not resolve. Almost always a wrong/typo'd APP_URL.
 *   refused   the host resolved but nothing is listening on that port. The classic symptom of a
 *             worker pointed at `localhost:3000` while the app runs somewhere else entirely.
 *   timeout   the connection hung — firewall, wrong port, or an app that never answered.
 *   tls       the certificate/handshake failed (an https URL in front of a plain-http server).
 *   blocked   Chromium refused to dial the port at all (its "unsafe port" list).
 *   network   reachable-ish but the transport failed for another reason.
 */
export type UnreachableReason = 'dns' | 'refused' | 'timeout' | 'tls' | 'blocked' | 'network';

/**
 * Raised when Chromium could not establish a connection to the configured render base URL.
 *
 * This is deliberately a DIFFERENT error from `RendererCrashedError`. "The browser died" and "the
 * application is not there" have the same symptom in Puppeteer — a rejected `page.goto` — and used
 * to collapse into one `render_failed`/`render_engine_failed`. They have completely different
 * fixes: one is retried, the other needs a human to correct configuration. Separating them is the
 * whole point of the diagnostics work.
 */
export class RenderTargetUnreachableError extends Error {
  constructor(
    readonly reason: UnreachableReason,
    /** The base URL that was attempted — origin only, never the token-bearing path. */
    readonly origin: string,
    message: string,
  ) {
    super(message);
    this.name = 'RenderTargetUnreachableError';
  }
}

/**
 * Map a Chromium/Node network failure onto a reason, or `null` when it is not a connection-level
 * failure at all. Matches Chromium's `net::ERR_*` names and Node's `errno` codes, because the
 * renderer sees both (page navigation vs. the launch/connect path).
 */
export function classifyNetworkError(message: string): UnreachableReason | null {
  const m = message.toUpperCase();
  if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|ENOTFOUND|EAI_AGAIN/.test(m)) return 'dns';
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(m)) return 'refused';
  if (/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|ETIMEDOUT/.test(m)) return 'timeout';
  if (/ERR_CERT_|ERR_SSL_|ERR_TLS_|DEPTH_ZERO_SELF_SIGNED|UNABLE_TO_VERIFY/.test(m)) return 'tls';
  // Chromium keeps a list of ports it will not dial (1, 7, 25, 6000, …). Found by the end-to-end
  // harness, which pointed at port 1 and got a message no branch recognised — so it fell through
  // to the generic path and carried the raw URL, token and all, out of the renderer.
  if (/ERR_UNSAFE_PORT|ERR_BLOCKED_BY_CLIENT|ERR_DISALLOWED_URL_SCHEME/.test(m)) return 'blocked';
  if (
    /ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_FAILED|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/.test(
      m,
    )
  ) {
    return 'network';
  }
  return null;
}

/** A one-line, actionable explanation for an operator. Contains no token and no credentials. */
export function unreachableAdvice(reason: UnreachableReason, origin: string): string {
  switch (reason) {
    case 'dns':
      return `Could not resolve the render host ${origin}. Check APP_URL — the hostname does not exist.`;
    case 'refused':
      return `Nothing is listening at ${origin}. The worker's Chromium resolves "localhost" to the WORKER's own machine, not yours — if the app runs elsewhere (a deployment, another host, or the Docker host), set APP_URL to that address.`;
    case 'timeout':
      return `Connection to ${origin} timed out. Check the port and any firewall between the worker and the app.`;
    case 'tls':
      return `TLS handshake with ${origin} failed. Check whether APP_URL should be http:// rather than https://.`;
    case 'blocked':
      return `Chromium refuses to connect to ${origin} — that port is on its blocked list. Point APP_URL at a normal port such as 3000.`;
    case 'network':
      return `The connection to ${origin} failed at the network layer.`;
  }
}

export interface PageRenderer {
  /** Drive the browser against `request.url` and return the produced PDF bytes + HTTP status. */
  render(request: RenderRequest): Promise<RenderResult>;
}
