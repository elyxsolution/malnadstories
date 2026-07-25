import type { StructuredLogger } from '@workerv2/worker-runtime';
import type { Job } from '../../job.js';
import type { ObjectStore } from '../../infra/storage/object-store.js';
import type { DatabaseAdapter } from '../../infra/database/database-adapter.js';
import type { Processor } from '../registry.js';
import { NONE } from '../../recovery/cancellation.js';
import type { CancellationToken } from '../../recovery/cancellation.js';
import { Pipeline } from '../pipeline/pipeline.js';
import { LoggingEventSink } from '../pipeline/events.js';
import type { ProcessorEventSink, ProcessorEventType } from '../pipeline/events.js';
import type { ImageCodec } from './image-codec.js';
import type { ImageContext, ImageStage, StageDeps } from './image-context.js';
import type { PhotoRow, PhotoStore } from './photo-repository.js';
import { PhotoRepository } from './photo-repository.js';
import { PermanentImageError } from './errors.js';
import { expectedPrefix } from './keys.js';
import { defaultImageStages } from './stages.js';

/** The image-hardening job type — matches the pg-boss queue the app enqueues onto. */
export const IMAGE_HARDENING_TYPE = 'image-hardening';

/** Dependencies for the image processor. */
export interface ImageProcessorDeps {
  readonly objectStore: ObjectStore;
  readonly codec: ImageCodec;
  readonly photos: PhotoStore;
  readonly logger: StructuredLogger;
  readonly stages: readonly ImageStage[];
  readonly events?: ProcessorEventSink;
}

interface ImagePayload {
  readonly photoId: string;
}

/**
 * THE IMAGE PROCESSOR — orchestrates the composable pipeline for one `image-hardening` job. It owns the
 * decisions the stages should not: payload parsing, the idempotent SKIP/RECONCILE for an already-processed
 * photo, the eligibility + defense-in-depth checks, and the permanent-vs-transient failure policy. The
 * actual work is delegated to the injected `ImageStage[]`, so the processor stays small and the pipeline
 * stays extensible.
 *
 * OUTCOME CONTRACT (drives ack vs. retry): this method RESOLVES for every terminal outcome — success, a
 * permanent rejection (photo marked `rejected`), an already-done photo, a vanished row, or a poison
 * payload — so the broker ACKs. It REJECTS only for transient failures, so the broker retries.
 *
 * OBSERVABILITY (Phase I-4): this processor performs NO logging, metrics, or tracing of its own. Every
 * terminal outcome is stated ONCE as a `ProcessorEvent`; the Observability layer decides the severity,
 * the counter, and the span attributes. That is why there is no logger call anywhere below — the
 * `logger` dependency exists solely to be handed to the stages.
 */
export class ImageProcessor implements Processor<ImagePayload> {
  readonly type = IMAGE_HARDENING_TYPE;
  private readonly pipeline: Pipeline<ImageContext, StageDeps>;
  private readonly events: ProcessorEventSink;

  constructor(private readonly deps: ImageProcessorDeps) {
    const stageDeps: StageDeps = {
      objectStore: deps.objectStore,
      codec: deps.codec,
      photos: deps.photos,
      logger: deps.logger,
    };
    this.events = deps.events ?? new LoggingEventSink(deps.logger);
    this.pipeline = new Pipeline(deps.stages, stageDeps, this.events);
  }

  async process(job: Job<ImagePayload>, cancellation: CancellationToken = NONE): Promise<void> {
    const correlationId = job.metadata.correlationId;
    const photoId = parsePhotoId(job.payload);
    if (photoId === null) {
      // A malformed payload can never be fixed by retrying — drop it (ack), loudly.
      this.emit('processor.rejected', correlationId, { reason: 'bad_payload', jobId: job.id });
      return;
    }

    const photo = await this.deps.photos.findById(photoId);
    if (photo === null) {
      // Row deleted mid-flight — nothing to do.
      this.emit('processor.skipped', correlationId, { reason: 'photo_missing', photoId });
      return;
    }
    if (photo.status === 'rejected') {
      this.emit('processor.skipped', correlationId, { reason: 'already_rejected', photoId });
      return; // terminal — idempotent no-op
    }
    if (photo.status === 'ready') {
      // Already processed — idempotent no-op. Any deferred raw cleanup (a crash between mark-ready and
      // raw-delete) is reconciled by the Recovery Coordinator's `orphan-raw` sweep, not here — the
      // processor stays focused on processing.
      this.emit('processor.skipped', correlationId, { reason: 'already_ready', photoId });
      return;
    }

    const ineligible = this.rejectionReason(photo);
    if (ineligible !== null) {
      await this.deps.photos.markRejected(photoId);
      this.emit('processor.rejected', correlationId, { reason: 'ineligible', photoId, ineligible });
      return;
    }

    await this.runPipeline(photo, correlationId, cancellation);
  }

  /**
   * Run the shared pipeline (which emits the `processor.*`/`stage.*` progress events). Map a permanent
   * stage failure to `rejected` (ack); rethrow a transient one (nack → broker retry).
   */
  private async runPipeline(
    photo: PhotoRow,
    correlationId: string,
    cancellation: CancellationToken,
  ): Promise<void> {
    const initial: ImageContext = {
      photoId: photo.id,
      userId: photo.userId,
      albumId: photo.albumId as string, // guaranteed non-null by rejectionReason()
      rawKey: photo.rawKey as string, // guaranteed non-null by rejectionReason()
      originalFilename: photo.originalFilename,
    };

    try {
      const ctx = await this.pipeline.run(
        initial,
        { processor: this.type, correlationId, detail: { photoId: photo.id } },
        cancellation,
      );
      // The pipeline already emitted `processor.completed` (timing). This adds the DOMAIN result the
      // pipeline cannot know — the sanitized dimensions the album will be laid out against.
      this.emit('processor.result', correlationId, {
        photoId: photo.id,
        width: ctx.width ?? null,
        height: ctx.height ?? null,
      });
    } catch (error) {
      if (error instanceof PermanentImageError) {
        await this.deps.photos.markRejected(photo.id);
        this.emit('processor.rejected', correlationId, {
          reason: 'undecodable',
          photoId: photo.id,
          error: error.message,
        });
        return; // terminal → ack
      }
      throw error; // transient → nack → broker retry
    }
  }

  /** Eligibility + defense-in-depth checks. Returns a rejection reason, or `null` when the photo is processable. */
  private rejectionReason(photo: PhotoRow): string | null {
    if (photo.rawKey === null) return 'no raw object key';
    if (photo.albumId === null) return 'photo is not attached to an album';
    if (!photo.rawKey.startsWith(expectedPrefix(photo.userId, photo.albumId))) {
      return `unexpected key prefix: ${photo.rawKey}`;
    }
    return null;
  }

  /** State one terminal outcome as an event. The observability layer decides how it is reported. */
  private emit(
    type: ProcessorEventType,
    correlationId: string,
    detail: Record<string, unknown>,
  ): void {
    this.events.emit({
      type,
      processor: this.type,
      correlationId,
      at: new Date().toISOString(),
      detail,
    });
  }
}

/** Build the image processor: wire the repository over the DB adapter + the default stage pipeline. */
export function createImageProcessor(deps: {
  objectStore: ObjectStore;
  database: DatabaseAdapter;
  codec: ImageCodec;
  logger: StructuredLogger;
  events?: ProcessorEventSink;
  /** Override the pipeline (tests); defaults to the production ordered stages. */
  stages?: readonly ImageStage[];
}): ImageProcessor {
  return new ImageProcessor({
    objectStore: deps.objectStore,
    codec: deps.codec,
    photos: new PhotoRepository(deps.database),
    logger: deps.logger,
    events: deps.events,
    stages: deps.stages ?? defaultImageStages(),
  });
}

function parsePhotoId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as { photoId?: unknown }).photoId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
