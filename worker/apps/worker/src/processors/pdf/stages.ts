import type { RenderContext, RenderDeps, RenderStage } from './render-context.js';
import { PermanentPdfError, SupersededError, TransientPdfError } from './errors.js';
import { PrintRouteError, RendererCrashedError } from './page-renderer.js';
import { PRINT_READY_FLAG, hashToken, previewPdfKey, printUrl } from './pdf-contract.js';

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

    const state = await deps.pdf.findPdfState(ctx.albumId);
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
      printUrl: printUrl(deps.appUrl, ctx.albumId, ctx.token),
      r2Key: previewPdfKey(userId, ctx.albumId),
    };
  }
}

// --- 3. Prepare: mark preparing. Asset verification is the app-side render-readiness gate + the print
//        route (which serves only ready photos + resolved cover/stickers) — never duplicated here. ---
export class PrepareRenderStage implements RenderStage {
  readonly name = 'prepare' as const;
  async run(ctx: RenderContext, deps: RenderDeps): Promise<RenderContext> {
    await deps.pdf.setStage(ctx.albumId, 'preparing');
    return ctx;
  }
}

// --- 4. Render: acquire Chromium (via ResourceManager, inside the renderer), drive the print route,
//        produce the PDF. Maps renderer failures to typed PDF errors. ---
export class RenderStep implements RenderStage {
  readonly name = 'render' as const;
  async run(ctx: RenderContext, deps: RenderDeps): Promise<RenderContext> {
    await deps.pdf.setStage(ctx.albumId, 'rendering');
    const url = required(ctx.printUrl, 'printUrl');
    try {
      const result = await deps.renderer.render({
        url,
        readinessFlag: PRINT_READY_FLAG,
        timeouts: deps.timeouts,
      });
      return { ...ctx, pdfBytes: result.pdf };
    } catch (error) {
      throw toRenderError(error);
    }
  }
}

// --- 5. Upload: store the PDF under the deterministic key (overwrite-safe = idempotent). ---
export class UploadStage implements RenderStage {
  readonly name = 'upload' as const;
  async run(ctx: RenderContext, deps: RenderDeps): Promise<RenderContext> {
    await deps.pdf.setStage(ctx.albumId, 'uploading');
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

// --- 6. Finalize: point album_pdfs at the uploaded PDF (status ready). ---
export class FinalizeStage implements RenderStage {
  readonly name = 'finalize' as const;
  async run(ctx: RenderContext, deps: RenderDeps): Promise<RenderContext> {
    await deps.pdf.setStage(ctx.albumId, 'finalizing');
    const r2Key = required(ctx.r2Key, 'r2Key');
    try {
      await deps.pdf.markReady(ctx.albumId, r2Key);
    } catch (error) {
      throw new TransientPdfError(message(error), 'db_update_failed');
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
    new UploadStage(),
    new FinalizeStage(),
  ];
}

/** Map a renderer error into a typed PDF error carrying a failure code. */
function toRenderError(error: unknown): Error {
  if (error instanceof PrintRouteError)
    return new PermanentPdfError(error.message, 'print_route_error');
  if (error instanceof RendererCrashedError) {
    const code = /timeout|timed out/i.test(error.message)
      ? 'render_timeout'
      : 'render_engine_failed';
    return new TransientPdfError(error.message, code);
  }
  const msg = message(error);
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
