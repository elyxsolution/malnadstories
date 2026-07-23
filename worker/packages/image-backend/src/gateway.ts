// The PIXEL GATEWAY — the bridge future image processors use to run deterministic pixel work and
// turn the result into an immutable, content-addressed raster Artifact. It composes an
// `ImageBackend` (the replaceable pixel engine) with an `ArtifactBytesPort` (the host's
// content-addressed store). The gateway itself holds no album/render/PDF/product logic and no
// coordinator awareness — it decodes bytes, applies a declarative operation pipeline, VALIDATES
// the output, and only then produces the Artifact.

import type { StorageKey } from '@workerv2/infra-contracts';
import type { ArtifactBytesMeta, ArtifactBytesPort, ImageBackend } from './contracts.js';
import type { RasterDescriptor, RasterImage } from './model.js';
import { RASTER_DESCRIPTOR_SCHEMA } from './model.js';
import type { ImageOperation } from './operations.js';
import { validateOperation } from './operations.js';
import { BackendError } from './errors.js';

export const RASTER_CONTENT_TYPE = 'application/vnd.workerv2.raster';

/** The result of producing a raster Artifact: its content address + a JSON-safe descriptor. */
export interface ProducedRaster {
  readonly key: StorageKey;
  readonly descriptor: RasterDescriptor;
}

/** The result of a full transform: the produced Artifact plus the in-memory raster it produced. */
export interface TransformResult extends ProducedRaster {
  readonly image: RasterImage;
}

export class PixelGateway {
  constructor(
    private readonly backend: ImageBackend,
    private readonly store: ArtifactBytesPort,
  ) {}

  /** Read an Artifact's bytes and decode them to a raster via the backend. */
  async decode(key: StorageKey): Promise<RasterImage> {
    const bytes = await this.store.read(key);
    return this.backend.decode(bytes);
  }

  /** Apply an operation pipeline PURELY (no I/O) — deterministic; used directly in tests. */
  applyOperations(image: RasterImage, operations: readonly ImageOperation[]): RasterImage {
    let current = image;
    for (const operation of operations) {
      const check = validateOperation(operation);
      if (!check.ok)
        throw new BackendError(`Invalid operation: ${check.error}`, { op: operation.op });
      current = this.backend.apply(current, operation);
    }
    return current;
  }

  /** Validate a raster, encode it, and produce a content-addressed Artifact. */
  async produce(image: RasterImage, meta?: ArtifactBytesMeta): Promise<ProducedRaster> {
    const validation = this.backend.validate(image);
    if (!validation.ok) throw validation.error; // never produce an invalid raster Artifact
    const bytes = this.backend.encode(image);
    const key = await this.store.write(bytes, {
      contentType: RASTER_CONTENT_TYPE,
      kind: 'derivative',
      ...meta,
    });
    return { key, descriptor: this.describe(image) };
  }

  /** Full pipeline: read → decode → apply operations → validate → produce. */
  async transform(
    key: StorageKey,
    operations: readonly ImageOperation[],
    meta?: ArtifactBytesMeta,
  ): Promise<TransformResult> {
    const decoded = await this.decode(key);
    const transformed = this.applyOperations(decoded, operations);
    const produced = await this.produce(transformed, meta);
    return { ...produced, image: transformed };
  }

  /** A JSON-safe, content-addressable descriptor of a raster (geometry + format + backend). */
  describe(image: RasterImage): RasterDescriptor {
    return {
      schema: RASTER_DESCRIPTOR_SCHEMA,
      width: image.width,
      height: image.height,
      channels: image.channels,
      colorSpace: image.colorSpace,
      bitDepth: image.bitDepth,
      byteLength: image.data.length,
      backend: this.backend.info,
    };
  }
}
