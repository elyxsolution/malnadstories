// @workerv2/image-backend — the Native Image Backend. The replaceable, framework-independent
// pixel-processing backend future image processors use for DETERMINISTIC image transformations,
// plus the Pixel Gateway that turns transformed pixels into immutable, content-addressed raster
// Artifacts. Ships a pure-TypeScript deterministic REFERENCE backend (decode/resize/rotate/crop/
// ICC-family colour convert/validate) and a reusable backend contract-test harness; a native/GPU
// backend (sharp/libvips) is a reserved drop-in behind the SAME contracts.
//
// Implements NO album knowledge, NO page composition, NO PDF, NO product logic; depends on NO
// coordinator/processing/runtime and NO storage implementation (only a narrow, host-wired byte
// port). It transforms rasters and produces Artifacts — nothing more.

// --- Model ---
export type { ColorSpace, Channels, RasterImage, BackendInfo, RasterDescriptor } from './model.js';
export {
  BIT_DEPTH,
  COLOR_SPACES,
  RASTER_DESCRIPTOR_SCHEMA,
  hasAlpha,
  pixelCount,
  expectedByteLength,
} from './model.js';

// --- Operations ---
export type {
  ResizeFilter,
  RotateDegrees,
  ResizeOp,
  RotateOp,
  CropOp,
  ConvertOp,
  ImageOperation,
} from './operations.js';
export { RESIZE_FILTERS, validateOperation } from './operations.js';

// --- Backend + gateway contracts ---
export type { ImageBackend, ArtifactBytesPort, ArtifactBytesMeta } from './contracts.js';

// --- Raster IO (encode/decode + validation) ---
export { encodeRaster, decodeRaster, isRasterContainer } from './raster/container.js';
export { decodeBmp, isBmp } from './raster/bmp.js';
export { validateRaster } from './raster/validate.js';
export type { RasterLimits } from './raster/validate.js';

// --- Deterministic reference backend ---
export {
  ReferenceImageBackend,
  createReferenceBackend,
  REFERENCE_BACKEND_ID,
  REFERENCE_BACKEND_VERSION,
} from './reference/backend.js';

// --- Pixel Gateway ---
export { PixelGateway, RASTER_CONTENT_TYPE } from './gateway.js';
export type { ProducedRaster, TransformResult } from './gateway.js';

// --- Errors ---
export { BackendError } from './errors.js';

// --- Test harness (reusable doubles + fixtures; the vitest contract suite ships with the tests) ---
export {
  InMemoryArtifactBytesStore,
  memAddress,
  makeRaster,
  solidRaster,
  gradientRaster,
} from './harness.js';
