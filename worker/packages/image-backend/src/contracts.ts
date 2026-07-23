// BACKEND CONTRACTS — the replaceable seam. `ImageBackend` is the framework-independent interface
// every pixel backend implements (the pure-TS reference here; a native sharp/libvips or GPU
// backend later, behind the SAME contract). `ArtifactBytesPort` is the narrow artifact I/O the
// Pixel Gateway needs — structurally compatible with the Processor SDK's `ArtifactGateway`, so a
// host wires ONE concrete content-addressed store to both without this package depending on the
// SDK. Nothing here knows about albums, pages, PDFs, products, or the coordinator.

import type { Result } from '@workerv2/contracts';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { ValidationError } from '@workerv2/errors';
import type { BackendInfo, RasterImage } from './model.js';
import type { ConvertOp, CropOp, ImageOperation, ResizeOp, RotateOp } from './operations.js';

/**
 * A PIXEL BACKEND — decodes encoded bytes to a raster, applies deterministic transformations, and
 * encodes a raster back to bytes. The interface is intentionally minimal and total: each method is
 * a pure function of its inputs (no ambient state, no I/O), so any implementation can be swapped in
 * and proven against the shared contract-test suite. `validate` is the output gate a producer runs
 * before an Artifact is created.
 */
export interface ImageBackend {
  readonly info: BackendInfo;

  /** Decode encoded bytes (canonical raster container or an uncompressed format) to a raster. */
  decode(bytes: Uint8Array): RasterImage;
  /** Encode a raster to the canonical, deterministic container bytes. */
  encode(image: RasterImage): Uint8Array;

  resize(image: RasterImage, op: ResizeOp): RasterImage;
  rotate(image: RasterImage, op: RotateOp): RasterImage;
  crop(image: RasterImage, op: CropOp): RasterImage;
  /** Channel + colour-space conversion (the deterministic ICC-family transforms). */
  convert(image: RasterImage, op: ConvertOp): RasterImage;

  /** Dispatch a declarative operation to the matching transform. */
  apply(image: RasterImage, operation: ImageOperation): RasterImage;

  /** Validate a raster's internal consistency — the output gate before producing an Artifact. */
  validate(image: RasterImage): Result<void, ValidationError>;
}

/**
 * The narrow ARTIFACT BYTE PORT the Pixel Gateway reads/writes through. Content-addressed +
 * write-once: writing identical bytes returns the same key (idempotent). Structurally a subset of
 * the SDK's `ArtifactGateway`, so a host passes the same store to both without coupling this
 * package to the SDK.
 */
export interface ArtifactBytesPort {
  read(key: StorageKey): Promise<Uint8Array>;
  write(content: Uint8Array, meta?: ArtifactBytesMeta): Promise<StorageKey>;
}

/** Optional metadata a producer may attach to a written raster Artifact. */
export interface ArtifactBytesMeta {
  readonly contentType?: string;
  readonly kind?: 'canonical' | 'derivative' | 'document' | 'other';
}
