/**
 * ALBUM PDF PIPELINE — public surface. Composed lazily (only when infrastructure is enabled) so puppeteer
 * is never loaded by the default worker. The renderer drives the app's print route (the source of truth);
 * this layer never re-implements rendering.
 */

export { PdfProcessor, createPdfProcessor, ALBUM_PDF_TYPE } from './pdf-processor.js';
export type { PdfProcessorDeps } from './pdf-processor.js';

export { PuppeteerPageRenderer } from './puppeteer-renderer.js';
export { DEFAULT_RENDER_TIMEOUTS, PrintRouteError, RendererCrashedError } from './page-renderer.js';
export type { PageRenderer, RenderRequest, RenderResult, RenderTimeouts } from './page-renderer.js';

export { defaultRenderStages } from './stages.js';
export {
  ValidateAlbumStage,
  SnapshotStage,
  PrepareRenderStage,
  RenderStep,
  UploadStage,
  FinalizeStage,
} from './stages.js';

export { AlbumPdfRepository } from './album-pdf-repository.js';
export type {
  AlbumPdfStore,
  AlbumOwner,
  PdfState,
  StaleGeneration,
} from './album-pdf-repository.js';

export { PdfRecoverableProcessor, createPdfRecoverableProcessor } from './pdf-recovery.js';
export type { PdfRecoveryDeps } from './pdf-recovery.js';

export { PermanentPdfError, TransientPdfError, SupersededError } from './errors.js';
export {
  PRINT_READY_FLAG,
  PDF_KINDS,
  DEFAULT_PDF_KIND,
  ALBUM_PDF_BASENAMES,
  isPdfKind,
  albumPdfKey,
  previewPdfKey,
  printUrl,
  hashToken,
} from './pdf-contract.js';
export type { PdfStage, PdfFailureCode, PdfKind } from './pdf-contract.js';

export type { RenderContext, RenderDeps, RenderStage } from './render-context.js';
