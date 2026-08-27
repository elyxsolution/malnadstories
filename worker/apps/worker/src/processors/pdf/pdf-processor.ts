import type { StructuredLogger } from '@workerv2/worker-runtime';
import type { Job } from '../../job.js';
import type { ObjectStore } from '../../infra/storage/object-store.js';
import type { DatabaseAdapter } from '../../infra/database/database-adapter.js';
import type { Processor } from '../registry.js';
import { CancellationError, NONE } from '../../recovery/cancellation.js';
import type { CancellationToken } from '../../recovery/cancellation.js';
import { Pipeline } from '../pipeline/pipeline.js';
import { LoggingEventSink } from '../pipeline/events.js';
import type { ProcessorEventSink, ProcessorEventType } from '../pipeline/events.js';
import { DEFAULT_RENDER_TIMEOUTS, PrintRouteError, RendererCrashedError } from './page-renderer.js';
import type { PageRenderer, RenderTimeouts } from './page-renderer.js';
import { AlbumPdfRepository } from './album-pdf-repository.js';
import type { AlbumPdfStore } from './album-pdf-repository.js';
import type { RenderContext, RenderDeps, RenderStage } from './render-context.js';
import { defaultRenderStages } from './stages.js';
import { PermanentPdfError, SupersededError, TransientPdfError } from './errors.js';
import { DEFAULT_PDF_KIND, isPdfKind } from './pdf-contract.js';
import type { PdfFailureCode, PdfKind } from './pdf-contract.js';

/** The album-pdf job type — matches the pg-boss queue the app enqueues onto. */
export const ALBUM_PDF_TYPE = 'album-pdf';

interface PdfPayload {
  readonly albumId: string;
  readonly token: string;
  /**
   * WHICH artifact to render (0058). ABSENT MEANS 'preview': a job enqueued before this deploy is
   * still sitting in the queue with a two-field payload, and it must run as what it was — the
   * customer's preview — not be rejected or silently rendered as something else.
   */
  readonly kind: PdfKind;
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
 *
 * OBSERVABILITY (Phase I-4): no logging, metrics, or tracing happens here. Every outcome is stated once
 * as a `ProcessorEvent` and the Observability layer derives the log line, the counter, and the span.
 */
export class PdfProcessor implements Processor<PdfPayload> {
  readonly type = ALBUM_PDF_TYPE;
  private readonly pipeline: Pipeline<RenderContext, RenderDeps>;
  private readonly events: ProcessorEventSink;

  constructor(private readonly deps: PdfProcessorDeps) {
    const renderDeps: RenderDeps = {
      pdf: deps.pdf,
      objectStore: deps.objectStore,
      renderer: deps.renderer,
      appUrl: deps.appUrl,
      timeouts: deps.timeouts ?? DEFAULT_RENDER_TIMEOUTS,
      logger: deps.logger,
    };
    this.events = deps.events ?? new LoggingEventSink(deps.logger);
    this.pipeline = new Pipeline(deps.stages ?? defaultRenderStages(), renderDeps, this.events);
  }

  async process(job: Job<PdfPayload>, cancellation: CancellationToken = NONE): Promise<void> {
    const correlationId = job.metadata.correlationId;
    const payload = parsePayload(job.payload);
    if (payload === null) {
      this.emit('processor.rejected', correlationId, { reason: 'bad_payload', jobId: job.id });
      return;
    }

    const initial: RenderContext = {
      albumId: payload.albumId,
      token: payload.token,
      kind: payload.kind,
      correlationId,
    };

    try {
      await this.pipeline.run(
        initial,
        { processor: ALBUM_PDF_TYPE, correlationId, detail: { albumId: payload.albumId, kind: payload.kind } },
        cancellation,
      );
      this.emit('processor.result', correlationId, {
        albumId: payload.albumId,
        kind: payload.kind,
        outcome: 'ready',
      });
    } catch (error) {
      if (error instanceof CancellationError) {
        // Shutdown mid-render: leave the row `generating` (the recovery sweep re-drives) — never mark failed.
        this.emit('processor.skipped', correlationId, {
          reason: 'cancelled',
          albumId: payload.albumId,
          kind: payload.kind,
        });
        throw error;
      }
      if (error instanceof SupersededError) {
        // Ack — a newer request owns the token, or the album is already rendered.
        this.emit('processor.skipped', correlationId, {
          reason: 'superseded',
          albumId: payload.albumId,
          kind: payload.kind,
          note: error.message,
        });
        return;
      }
      const { code, message } = classify(error);
      try {
        await this.deps.pdf.markFailed(payload.albumId, payload.kind, message, code);
      } catch (dbError) {
        // The render already failed; failing to RECORD that is a second, separate fault worth its
        // own event — it is the case that leaves a row stuck in `generating` until the sweep heals it.
        this.emit('processor.failed', correlationId, {
          reason: 'markfailed_failed',
          albumId: payload.albumId,
          kind: payload.kind,
          error: toMessage(dbError),
        });
      }
      this.emit('processor.rejected', correlationId, {
        reason: code,
        albumId: payload.albumId,
        kind: payload.kind,
        error: message,
      });
      // ack — terminal 'failed' (admin regenerate; the I-3 sweep auto-redrives transient codes).
    }
  }

  /** State one terminal outcome as an event. The observability layer decides how it is reported. */
  private emit(
    type: ProcessorEventType,
    correlationId: string,
    detail: Record<string, unknown>,
  ): void {
    this.events.emit({
      type,
      processor: ALBUM_PDF_TYPE,
      correlationId,
      at: new Date().toISOString(),
      detail,
    });
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
  const p = payload as { albumId?: unknown; token?: unknown; kind?: unknown };
  if (
    typeof p.albumId === 'string' &&
    p.albumId.length > 0 &&
    typeof p.token === 'string' &&
    p.token.length > 0
  ) {
    // An absent or unrecognised kind falls back to 'preview' rather than rejecting the job: that
    // is what a pre-0058 payload means, and rejecting it would strand a customer's preview.
    return { albumId: p.albumId, token: p.token, kind: isPdfKind(p.kind) ? p.kind : DEFAULT_PDF_KIND };
  }
  return null;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
