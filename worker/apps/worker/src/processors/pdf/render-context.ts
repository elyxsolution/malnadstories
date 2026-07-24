import type { StructuredLogger } from '@workerv2/worker-runtime';
import type { ObjectStore } from '../../infra/storage/object-store.js';
import type { Stage } from '../pipeline/pipeline.js';
import type { AlbumPdfStore } from './album-pdf-repository.js';
import type { PageRenderer, RenderTimeouts } from './page-renderer.js';

/**
 * THE RENDER CONTEXT — the immutable value threaded through the PDF pipeline. Seeded from the job
 * ({albumId, token}); each stage returns a new context augmented with its output. No mutable album data
 * ever enters the context: the album's CONTENT is read live by the print route (the source of truth) at
 * render time; the worker only carries the frozen render REFERENCE (validated owner + URL + target key).
 */
export interface RenderContext {
  readonly albumId: string;
  readonly token: string;
  readonly correlationId: string;

  readonly userId?: string;
  readonly printUrl?: string;
  readonly r2Key?: string;
  readonly pdfBytes?: Uint8Array;
}

/** Dependencies handed to every render stage (injected once per job). */
export interface RenderDeps {
  readonly pdf: AlbumPdfStore;
  readonly objectStore: ObjectStore;
  readonly renderer: PageRenderer;
  /** Base URL Chromium navigates to (the app's origin). */
  readonly appUrl: string;
  readonly timeouts: RenderTimeouts;
  readonly logger: StructuredLogger;
}

export type RenderStage = Stage<RenderContext, RenderDeps>;
