/**
 * Upload infrastructure — the shared entry point for every upload surface.
 *
 * Consume `useUploadManager` from a client component; everything else here is the
 * vocabulary (states, events, sessions, stats, metrics, optimistic ids) it works in.
 */
export {
  UploadManager,
  DEFAULT_UPLOAD_CONCURRENCY,
  resolveContentType,
  type ConfirmedUpload,
  type DiscardedUpload,
  type ExtractedMetadata,
  type QueuedUpload,
  type UploadManagerOptions,
} from './manager';
export {
  canExtractMetadata,
  extractImageMetadata,
  orientationSwapsAxes,
  readExifOrientation,
  type ClientImageMetadata,
} from './metadata';
export {
  MAX_AUTO_ATTEMPTS,
  RETRY_BASE_MS,
  RETRY_FACTOR,
  RETRY_JITTER,
  RETRY_MAX_DELAY_MS,
  backoffDelay,
  classifyResponse,
  isTransientStatus,
  networkFailure,
  parseRetryAfter,
  permanentFailure,
  timeoutFailure,
  type Classification,
  type FailureKind,
} from './retry';
export { useUploadManager, type UploadManagerApi, type UseUploadManagerOptions } from './use-upload-manager';
export { UploadProvider } from './upload-provider';
export { TEMP_PHOTO_PREFIX, isTempPhotoId, taskIdOfTempPhoto, tempPhotoId } from './optimistic';
export {
  UPLOAD_STATES,
  UPLOAD_STAGES,
  TERMINAL_UPLOAD_STATES,
  aggregateMetrics,
  computeStats,
  summarizeSessions,
  uploadMetrics,
  type UploadEvent,
  type UploadEventType,
  type UploadMetrics,
  type UploadSessionSummary,
  type UploadStage,
  type UploadStats,
  type UploadState,
  type UploadTask,
  type UploadTimings,
} from './types';
