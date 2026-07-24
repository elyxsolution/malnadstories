/** R2 cleanup pipeline — deletes orphaned objects for the `r2-cleanup` job (idempotent + cancellable). */

export { CleanupProcessor, createCleanupProcessor, R2_CLEANUP_TYPE } from './cleanup-processor.js';
export type { CleanupProcessorDeps } from './cleanup-processor.js';
export {
  defaultCleanupStages,
  ValidateCleanupStage,
  DeleteObjectsStage,
  FinalizeCleanupStage,
} from './stages.js';
export type { CleanupContext, CleanupDeps, CleanupStage } from './cleanup-context.js';
