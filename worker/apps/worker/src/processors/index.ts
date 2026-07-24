/**
 * PROCESSORS LAYER — the registry, the shared pipeline/event model, the processor-path job runner, and
 * the concrete-processor factories. This is the extensible edge of the worker: new job kinds are added
 * by registering a `Processor` here, never by touching the Worker Runtime or the consume loop.
 *
 * Exports are explicit (not `export *`) because the image and PDF sub-pipelines each define same-named
 * stage classes (`FinalizeStage`, `UploadStage`); those live in their own sub-barrels. This top barrel
 * carries only what composition + other layers need.
 */

export { ProcessorRegistry, DuplicateProcessorError } from './registry.js';
export type { Processor } from './registry.js';

export { ProcessorJobRunner } from './runner.js';

// Shared execution model + events (no name collisions).
export * from './pipeline/index.js';

// Concrete processor factories + entrypoints (the pieces composition wires).
export { ImageProcessor, createImageProcessor, IMAGE_HARDENING_TYPE } from './image/index.js';
export { createSharpImageCodec, createImageRecoverableProcessor } from './image/index.js';
export { PdfProcessor, createPdfProcessor, ALBUM_PDF_TYPE } from './pdf/index.js';
export { PuppeteerPageRenderer, DEFAULT_RENDER_TIMEOUTS } from './pdf/index.js';
export { createPdfRecoverableProcessor } from './pdf/index.js';
export type { PageRenderer } from './pdf/index.js';
export { CleanupProcessor, createCleanupProcessor, R2_CLEANUP_TYPE } from './cleanup/index.js';
