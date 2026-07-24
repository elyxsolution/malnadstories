import type { StructuredLogger } from '@workerv2/worker-runtime';
import type { Job } from '../../job.js';
import type { ObjectStore } from '../../infra/storage/object-store.js';
import type { DatabaseAdapter } from '../../infra/database/database-adapter.js';
import type { Processor } from '../registry.js';
import { CancellationError, NONE } from '../../recovery/cancellation.js';
import type { CancellationToken } from '../../recovery/cancellation.js';
import { Pipeline } from '../pipeline/pipeline.js';
import { LoggingEventSink } from '../pipeline/events.js';
import type { ProcessorEventSink } from '../pipeline/events.js';
import { DEFAULT_RENDER_TIMEOUTS, PrintRouteError, RendererCrashedError } from './page-renderer.js';
import type { PageRenderer, RenderTimeouts } from './page-renderer.js';
import { AlbumPdfRepository } from './album-pdf-repository.js';
import type { AlbumPdfStore } from './album-pdf-repository.js';
import type { RenderContext, RenderDeps, RenderStage } from './render-context.js';
import { defaultRenderStages } from './stages.js';
import { PermanentPdfError, SupersededError, TransientPdfError } from './errors.js';
import type { PdfFailureCode } from './pdf-contract.js';

/** The album-pdf job type — matches the pg-boss queue the app enqueues onto. */
export const ALBUM_PDF_TYPE = 'album-pdf';

interface PdfPayload {
  readonly albumId: string;
  readonly token: string;
}

export interface PdfProcessorDeps {
  readonly pdf: AlbumPdfStore;
  readonly objectStore: ObjectStore;
  readonly renderer: PageRenderer;
  readonly appUrl: string;
  readonly timeouts?: RenderTimeouts;
  readonly logger: StructuredLogger;
  readonly events?: ProcessorEventSink;
  readonly stages?: readonly RenderStage[];
}

/**
 * THE PDF PROCESSOR — orchestrates the render pipeline for one `album-pdf` job. It owns payload parsing
 * and the outcome policy; the stages own the work. The print route remains the single source of truth —
 * this processor drives it via the renderer and never re-implements rendering.
 *
 * OUTCOME CONTRACT (this phase — the album-pdf queue has no broker retry): RESOLVES for every terminal
 * outcome so the broker ACKs. A superseded/already-rendered job is a silent no-op. Any real failure marks
 * `album_pdfs` = `failed` with a typed code (admin regenerate recovers it; the Phase I-3 sweep will
 * auto-redrive transient codes with a fresh token). Nothing is left stuck in `generating`.
 */
export class PdfProcessor implements Processor<PdfPayload> {
  readonly type = ALBUM_PDF_TYPE;
  private readonly pipeline: Pipeline<RenderContext, RenderDeps>;

  constructor(private readonly deps: PdfProcessorDeps) {
    const renderDeps: RenderDeps = {
      pdf: deps.pdf,
      objectStore: deps.objectStore,
      renderer: deps.renderer,
      appUrl: deps.appUrl,
      timeouts: deps.timeouts ?? DEFAULT_RENDER_TIMEOUTS,
      logger: deps.logger,
    };
    this.pipeline = new Pipeline(
      deps.stages ?? defaultRenderStages(),
      renderDeps,
      deps.events ?? new LoggingEventSink(deps.logger),
    );
  }

  async process(job: Job<PdfPayload>, cancellation: CancellationToken = NONE): Promise<void> {
    const correlationId = job.metadata.correlationId;
    const payload = parsePayload(job.payload);
    if (payload === null) {
      this.log('error', 'pdf.bad_payload', { jobId: job.id, correlationId });
      return;
    }

    const initial: RenderContext = {
      albumId: payload.albumId,
      token: payload.token,
      correlationId,
    };

    try {
      await this.pipeline.run(initial, { processor: ALBUM_PDF_TYPE, correlationId }, cancellation);
      this.log('info', 'pdf.ready', { albumId: payload.albumId, correlationId });
    } catch (error) {
      if (error instanceof CancellationError) {
        // Shutdown mid-render: leave the row `generating` (the recovery sweep re-drives) — never mark failed.
        this.log('info', 'pdf.cancelled', { albumId: payload.albumId, correlationId });
        throw error;
      }
      if (error instanceof SupersededError) {
        this.log('info', 'pdf.superseded', {
          albumId: payload.albumId,
          reason: error.message,
          correlationId,
        });
        return; // ack — a newer request owns the token, or the album is already rendered
      }
      const { code, message } = classify(error);
      try {
        await this.deps.pdf.markFailed(payload.albumId, message, code);
      } catch (dbError) {
        this.log('error', 'pdf.markfailed_failed', {
          albumId: payload.albumId,
          error: toMessage(dbError),
          correlationId,
        });
      }
      this.log('warning', 'pdf.failed', {
        albumId: payload.albumId,
        code,
        error: message,
        correlationId,
      });
      // ack — terminal 'failed' (admin regenerate; I-3 sweep auto-redrives transient codes).
    }
  }

  private log(
    level: 'debug' | 'info' | 'warning' | 'error',
    message: string,
    detail: Record<string, unknown>,
  ): void {
    this.deps.logger.log({ level, message, detail });
  }
}

/** Wire the repository over the DB adapter + the default render pipeline. */
export function createPdfProcessor(deps: {
  database: DatabaseAdapter;
  objectStore: ObjectStore;
  renderer: PageRenderer;
  appUrl: string;
  timeouts?: RenderTimeouts;
  logger: StructuredLogger;
  events?: ProcessorEventSink;
  stages?: readonly RenderStage[];
}): PdfProcessor {
  return new PdfProcessor({
    pdf: new AlbumPdfRepository(deps.database),
    objectStore: deps.objectStore,
    renderer: deps.renderer,
    appUrl: deps.appUrl,
    timeouts: deps.timeouts,
    logger: deps.logger,
    events: deps.events,
    stages: deps.stages,
  });
}

function classify(error: unknown): { code: PdfFailureCode; message: string } {
  if (error instanceof PermanentPdfError || error instanceof TransientPdfError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof PrintRouteError)
    return { code: 'print_route_error', message: error.message };
  if (error instanceof RendererCrashedError) {
    return { code: 'render_engine_failed', message: error.message };
  }
  return { code: 'render_failed', message: toMessage(error) };
}

function parsePayload(payload: unknown): PdfPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as { albumId?: unknown; token?: unknown };
  if (
    typeof p.albumId === 'string' &&
    p.albumId.length > 0 &&
    typeof p.token === 'string' &&
    p.token.length > 0
  ) {
    return { albumId: p.albumId, token: p.token };
  }
  return null;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
