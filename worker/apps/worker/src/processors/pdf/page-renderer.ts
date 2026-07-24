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
  /** The print-route URL (token in the query string). */
  readonly url: string;
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

export interface PageRenderer {
  /** Drive the browser against `request.url` and return the produced PDF bytes + HTTP status. */
  render(request: RenderRequest): Promise<RenderResult>;
}
