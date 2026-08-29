import type { RenderContext, RenderDeps, RenderStage } from './render-context.js';
import { PermanentPdfError, SupersededError, TransientPdfError } from './errors.js';
import {
  PrintRouteError,
  RendererCrashedError,
  RenderTargetUnreachableError,
} from './page-renderer.js';
import { PRINT_READY_FLAG, albumPdfKey, hashToken, printUrl, redactToken } from './pdf-contract.js';
import { verifyPdfGeometry } from './pdf-geometry.js';

/**
 * THE RENDER STAGES — a composable rendering pipeline over the print route (the source of truth). Each
 * stage takes a context + injected deps and returns an augmented context; progress is written to
 * `album_pdfs.stage` as it advances.
 *
 * Placement note (cleaner than the prompt's literal split): "acquire renderer", "render", and "generate
 * PDF" are UNIFIED in `RenderStep`, because the `PageRenderer` port encapsulates all three — it acquires
 * Chromium from the ResourceManager, drives the print route, and returns PDF bytes. Splitting them into
 * separate stages would leak live browser/page handles into the (otherwise pure, value-only) context.
 * The worker never launches a browser and never re-implements rendering.
 */

// --- 1. Validate: album exists + the token is the current, unexpired one ---
export class ValidateAlbumStage implements RenderStage {
  readonly name = 'validate' as const;
  async run(ctx: RenderContext, deps: RenderDeps): Promise<RenderContext> {
    const owner = await deps.pdf.findAlbumOwner(ctx.albumId);
    if (owner === null) throw new PermanentPdfError('album not found', 'album_missing');

    const state = await deps.pdf.findPdfState(ctx.albumId, ctx.kind);
    if (state !== null && state.status === 'ready') {
      throw new SupersededError('album already rendered'); // idempotent skip on redelivery
    }
    if (state === null || state.tokenHash !== hashToken(ctx.token)) {
      throw new SupersededError('print token superseded by a newer request');
    }
    if (state.tokenExpiresAt === null || new Date(state.tokenExpiresAt).getTime() <= Date.now()) {
      throw new PermanentPdfError('print token expired before generation', 'token_expired');
    }
    return { ...ctx, userId: owner.userId };
  }
}

// --- 2. Snapshot: freeze the render reference (URL + target key). No mutable data enters rendering. ---
export class SnapshotStage implements RenderStage {
  readonly name = 'snapshot' as const;
  async run(ctx: RenderContext, deps: RenderDeps): Promise<RenderContext> {
    const userId = required(ctx.userId, 'userId');
    return {
      ...ctx,
      printUrl: printUrl(deps.appUrl, ctx.albumId, ctx.token, ctx.kind),
      r2Key: albumPdfKey(userId, ctx.albumId, ctx.kind),
    };
  }
}

// --- 3. Prepare: mark preparing. Asset verification is the app-side render-readiness gate + the print
//        route (which serves only ready photos + resolved cover/stickers) — never duplicated here. ---
export class PrepareRenderStage implements RenderStage {
  readonly name = 'prepare' as const;
  async run(ctx: RenderContext, deps: RenderDeps): Promise<RenderContext> {
    await deps.pdf.setStage(ctx.albumId, ctx.kind, 'preparing');
    return ctx;
  }
}

// --- 4. Render: acquire Chromium (via ResourceManager, inside the renderer), drive the print route,
//        produce the PDF. Maps renderer failures to typed PDF errors. ---
export class RenderStep implements RenderStage {
  readonly name = 'render' as const;
  async run(ctx: RenderContext, deps: RenderDeps): Promise<RenderContext> {
    await deps.pdf.setStage(ctx.albumId, ctx.kind, 'rendering');
    const url = required(ctx.printUrl, 'printUrl');
    try {
      const result = await deps.renderer.render({
        url,
        // Origin only — the safe half of the URL, for diagnostics that must never carry the token.
        origin: new URL(deps.appUrl).origin,
        readinessFlag: PRINT_READY_FLAG,
        timeouts: deps.timeouts,
      });
      return { ...ctx, pdfBytes: result.pdf };
    } catch (error) {
      throw toRenderError(error);
    }
  }
}

// --- 5. Verify geometry: the rendered bytes are only a candidate until their printed geometry is
//        checked. NOTHING is uploaded, marked ready, or shown to anyone before this passes. ---
export class VerifyGeometryStage implements RenderStage {
  readonly name = 'verify' as const;
  async run(ctx: RenderContext, deps: RenderDeps): Promise<RenderContext> {
    const pdfBytes = required(ctx.pdfBytes, 'pdfBytes');
    const verdict = verifyPdfGeometry(pdfBytes, ctx.kind);
    if (!verdict.ok) {
      /**
       * TRANSIENT, deliberately. The enlarged-sheet failure was intermittent — the same album and
       * the same code produced a correct file on one run and a broken one on the next — so a fresh
       * render is a genuine remedy, and the recovery sweep is the mechanism that already exists to
       * try it. It re-drives with a new token, counts the attempt, and gives up at the cap, which
       * leaves the row `failed` with this code for an admin: loud, not silent.
       *
       * Throwing here also means the bytes simply go out of scope. They are never written to R2, so
       * a bad render can neither be persisted, replace a good PDF at the same deterministic key,
       * be marked ready, nor be handed to a customer or a printer.
       */
      deps.logger.log({
        level: 'warning',
        message: 'pdf.geometry_rejected',
        detail: {
          albumId: ctx.albumId,
          kind: ctx.kind,
          pages: verdict.pages.length,
          reason: verdict.reason,
        },
      });
      throw new TransientPdfError(
        `rendered PDF failed geometry verification — ${verdict.reason}`,
        'render_geometry_invalid',
      );
    }
    return ctx;
  }
}

// --- 6. Upload: store the PDF under the deterministic key (overwrite-safe = idempotent). ---
export class UploadStage implements RenderStage {
  readonly name = 'upload' as const;
  async run(ctx: RenderContext, deps: RenderDeps): Promise<RenderContext> {
    await deps.pdf.setStage(ctx.albumId, ctx.kind, 'uploading');
    const r2Key = required(ctx.r2Key, 'r2Key');
    const pdfBytes = required(ctx.pdfBytes, 'pdfBytes');
    try {
      await deps.objectStore.write(r2Key, pdfBytes, { contentType: 'application/pdf' });
    } catch (error) {
      throw new TransientPdfError(message(error), 'upload_failed');
    }
    return ctx;
  }
}

// --- 7. Finalize: point album_pdfs at the uploaded PDF (status ready). ---
export class FinalizeStage implements RenderStage {
  readonly name = 'finalize' as const;
  async run(ctx: RenderContext, deps: RenderDeps): Promise<RenderContext> {
    await deps.pdf.setStage(ctx.albumId, ctx.kind, 'finalizing');
    const r2Key = required(ctx.r2Key, 'r2Key');
    let owned: boolean;
    try {
      owned = await deps.pdf.markReady(ctx.albumId, ctx.kind, r2Key);
    } catch (error) {
      throw new TransientPdfError(message(error), 'db_update_failed');
    }

    // OWNERSHIP LOST MID-FLIGHT (Phase 6 Prompt 10). The bytes are already in R2 (UploadStage),
    // but the `album_pdfs` row is gone — the album was deleted while this render was running and
    // the CASCADE removed the row that held the key. Nothing in the database names this object
    // any more, and `deleteAlbum` cannot have enqueued it for cleanup because `r2_key` was still
    // null when it collected keys. The orphan-scan tooling deliberately ignores `preview.pdf`, so
    // an object left here would never be reclaimed by anything, ever.
    //
    // COMPENSATE, then fail. R2 DeleteObject is idempotent (a missing key is a no-op), so this is
    // safe on redelivery and safe if `deleteAlbum`'s own cleanup job already removed the key. The
    // delete is best-effort: if it fails we still refuse to report success, because a job that
    // claimed `ready` here would leave a permanently ownerless object AND a customer-visible PDF
    // that no row points at.
    if (!owned) {
      try {
        await deps.objectStore.delete(r2Key);
      } catch {
        // Swallowed deliberately: the throw below is the real signal. Reporting success is the
        // one outcome that must never happen.
      }
      throw new PermanentPdfError(
        'album deleted while its PDF was rendering; uploaded object was cleaned up',
        'album_missing',
      );
    }
    return ctx;
  }
}

/** The default, ordered render pipeline. New stages are inserted here without touching the runtime. */
export function defaultRenderStages(): readonly RenderStage[] {
  return [
    new ValidateAlbumStage(),
    new SnapshotStage(),
    new PrepareRenderStage(),
    new RenderStep(),
    new VerifyGeometryStage(),
    new UploadStage(),
    new FinalizeStage(),
  ];
}

/**
 * Map a renderer error into a typed PDF error carrying a failure code.
 *
 * CONNECTIVITY IS ITS OWN CLASS. "The app is unreachable" used to arrive here as a
 * `RendererCrashedError` and be recorded as `render_engine_failed` — an answer that sends an
 * operator to look at Chromium when the actual fault is a base URL pointing at a host that is not
 * running the app. It is now typed, kept TRANSIENT (the app may simply not be up yet, and the
 * recovery sweep should re-drive), and carries an origin plus an actionable sentence.
 */
function toRenderError(error: unknown): Error {
  if (error instanceof RenderTargetUnreachableError) {
    const code = error.reason === 'dns' ? 'render_dns_failed' : 'render_unreachable';
    return new TransientPdfError(redactToken(error.message), code);
  }
  if (error instanceof PrintRouteError)
    return new PermanentPdfError(redactToken(error.message), 'print_route_error');
  if (error instanceof RendererCrashedError) {
    const code = /timeout|timed out/i.test(error.message)
      ? 'render_timeout'
      : 'render_engine_failed';
    return new TransientPdfError(redactToken(error.message), code);
  }
  const msg = redactToken(message(error));
  if (/0 bytes/i.test(msg)) return new PermanentPdfError(msg, 'render_empty');
  if (/timeout|timed out/i.test(msg)) return new TransientPdfError(msg, 'render_timeout');
  return new TransientPdfError(msg, 'render_failed');
}

function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new Error(`render pipeline invariant violated: "${field}" missing`);
  }
  return value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
