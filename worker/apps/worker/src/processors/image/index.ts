/**
 * IMAGE PROCESSING PIPELINE — public surface. Composed lazily (only when infrastructure is enabled) so
 * the native image stack is never loaded by the default worker.
 */

export { ImageProcessor, createImageProcessor, IMAGE_HARDENING_TYPE } from './image-processor.js';
export type { ImageProcessorDeps } from './image-processor.js';

export { createSharpImageCodec, SharpImageCodec } from './sharp-image-codec.js';
export type { ImageCodec, Raster, JpegOptions } from './image-codec.js';
export {
  ALLOWED_MIME,
  HEIC_MIME,
  MAX_PIXELS,
  MAX_DIMENSION,
  MAX_BYTES,
  MASTER_QUALITY,
  THUMBNAIL_QUALITY,
  THUMBNAIL_MAX_EDGE,
} from './image-codec.js';

export { defaultImageStages } from './stages.js';
export {
  LoadStage,
  ValidateStage,
  DecodeStage,
  MetadataStage,
  NormalizeStage,
  MasterStage,
  ThumbnailStage,
  PersistStage,
  FinalizeStage,
} from './stages.js';

export { PhotoRepository } from './photo-repository.js';
export type { PhotoRow, ReadyFields, PhotoStore } from './photo-repository.js';

export { ImageRecoverableProcessor, createImageRecoverableProcessor } from './image-recovery.js';
export type { ImageRecoveryDeps } from './image-recovery.js';

export { PermanentImageError, TransientImageError } from './errors.js';
export { derivedKeys, expectedPrefix } from './keys.js';

export type { ImageContext, ImageStage, StageDeps, ProcessingStage } from './image-context.js';
