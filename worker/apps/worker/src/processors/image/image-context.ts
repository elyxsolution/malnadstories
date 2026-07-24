import type { StructuredLogger } from '@workerv2/worker-runtime';
import type { ObjectStore } from '../../infra/storage/object-store.js';
import type { Stage } from '../pipeline/pipeline.js';
import type { ImageCodec, Raster } from './image-codec.js';
import type { PhotoStore } from './photo-repository.js';

/**
 * PROCESSING STAGES — a structured, in-memory progress vocabulary used for logging, diagnostics, and
 * recovery reasoning. It is intentionally NOT persisted: capturing per-stage progress in the database
 * would require a schema change (forbidden this phase) and, more importantly, is unnecessary — the
 * pipeline is idempotent and cheap to replay, so recovery re-runs the whole pipeline from the top rather
 * than resuming mid-stage. In-memory + structured logs give full observability with zero schema cost.
 */
export type ProcessingStage =
  | 'pending'
  | 'loading'
  | 'validating'
  | 'decoding'
  | 'metadata'
  | 'normalizing'
  | 'resizing'
  | 'thumbnail'
  | 'persisting'
  | 'finalizing'
  | 'ready'
  | 'rejected';

/**
 * THE IMAGE CONTEXT — the immutable value threaded through the pipeline. Each stage RECEIVES a context
 * and RETURNS a new one augmented with its output (no hidden globals, no shared mutable state), so every
 * stage is independently testable and new stages are insertable without rewiring. The seed fields come
 * from the job + photo row; the rest accrue as stages run.
 */
export interface ImageContext {
  // --- Seed (from the job + the photos row) ---
  readonly photoId: string;
  readonly userId: string;
  readonly albumId: string;
  readonly rawKey: string;
  readonly originalFilename: string;

  // --- Accrued by stages ---
  readonly rawBytes?: Uint8Array;
  readonly mime?: string;
  readonly decodable?: Uint8Array;
  readonly takenAt?: Date | null;
  readonly raster?: Raster;
  readonly width?: number;
  readonly height?: number;
  readonly masterBytes?: Uint8Array;
  readonly thumbBytes?: Uint8Array;
  readonly sanitizedKey?: string;
  readonly thumbKey?: string;
}

/** Dependencies handed to every stage. Injected once per job; stages take exactly what they need. */
export interface StageDeps {
  readonly objectStore: ObjectStore;
  readonly codec: ImageCodec;
  readonly photos: PhotoStore;
  readonly logger: StructuredLogger;
}

/**
 * One image pipeline stage — the shared `Stage` execution model bound to the image context + deps. Its
 * `name` is a `ProcessingStage` (the progress vocabulary), so every image stage plugs into the same
 * `Pipeline` + `ProcessorEvent` machinery the PDF processor uses.
 */
export type ImageStage = Stage<ImageContext, StageDeps> & { readonly name: ProcessingStage };
