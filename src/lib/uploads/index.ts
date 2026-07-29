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
export { useUploadManager, type UploadManagerApi, type UseUploadManagerOptions } from './use-upload-manager';
export { TEMP_PHOTO_PREFIX, isTempPhotoId, taskIdOfTempPhoto, tempPhotoId } from './optimistic';
export {
  UPLOAD_STATES,
  TERMINAL_UPLOAD_STATES,
  aggregateMetrics,
  computeStats,
  summarizeSessions,
  uploadMetrics,
  type UploadEvent,
  type UploadEventType,
  type UploadMetrics,
  type UploadSessionSummary,
  type UploadStats,
  type UploadState,
  type UploadTask,
  type UploadTimings,
} from './types';
