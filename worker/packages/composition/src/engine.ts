// The PAGE COMPOSITION ENGINE — the top-level entry point that transforms a Blueprint surface +
// normalized image Artifacts into a rendered page Artifact. It resolves each placement's image
// Artifact (decode via the ImageBackend through the Pixel Gateway), builds the layer stack,
// rasterizes it deterministically, VALIDATES the rendered page, and produces an immutable,
// content-addressed page raster Artifact. It performs no storage of its own (the injected byte
// port does), generates no PDF, and holds no album-packaging or vendor logic.

import type { StorageKey } from '@workerv2/infra-contracts';
import type { ArtifactBytesPort, ImageBackend, RasterImage } from '@workerv2/image-backend';
import { PixelGateway } from '@workerv2/image-backend';
import type { Blueprint } from '@workerv2/blueprint';
import type { LayerStack, PageDescriptor, PageRenderTarget } from './model.js';
import { PAGE_DESCRIPTOR_SCHEMA } from './model.js';
import { rasterizeStack } from './compositor.js';
import { validateComposedPage, validateLayerStack } from './validate.js';
import { findSurface, surfaceArtifacts, surfaceToLayerStack } from './blueprint-adapter.js';
import type { SurfaceCompositionOptions } from './blueprint-adapter.js';
import { CompositionError } from './errors.js';

/** A rendered page: its Artifact identity + descriptor + the in-memory raster. */
export interface RenderedPage {
  readonly key: StorageKey;
  readonly descriptor: PageDescriptor;
  readonly page: RasterImage;
}

export class CompositionEngine {
  private readonly gateway: PixelGateway;

  constructor(
    private readonly backend: ImageBackend,
    store: ArtifactBytesPort,
  ) {
    this.gateway = new PixelGateway(backend, store);
  }

  /**
   * Rasterize a layer stack directly (no blueprint) — the pure compositor path, exposed for
   * callers that build stacks themselves. Deterministic; no I/O.
   */
  rasterize(stack: LayerStack): RasterImage {
    const check = validateLayerStack(stack);
    if (!check.ok) throw new CompositionError(`Invalid layer stack: ${check.error}`);
    return rasterizeStack(this.backend, stack);
  }

  /**
   * Compose a Blueprint surface into a rendered page Artifact: resolve artifacts → build stack →
   * rasterize → validate → produce. Consumes only blueprint data + the resolved Artifacts (+ the
   * deterministic target/options).
   */
  async composeSurface(
    blueprint: Blueprint,
    surfaceId: string,
    target: PageRenderTarget,
    options: SurfaceCompositionOptions = {},
  ): Promise<RenderedPage> {
    if (!isPositiveInt(target.width) || !isPositiveInt(target.height)) {
      throw new CompositionError('Render target must have positive integer dimensions', {
        target: { width: target.width, height: target.height },
      });
    }
    const surface = findSurface(blueprint, surfaceId);

    // Resolve every referenced image Artifact to a decoded raster.
    const resolved = new Map<StorageKey, RasterImage>();
    for (const artifact of surfaceArtifacts(blueprint, surface)) {
      resolved.set(artifact, await this.gateway.decode(artifact));
    }

    const stack = surfaceToLayerStack(blueprint, surface, target, resolved, options);
    const stackCheck = validateLayerStack(stack);
    if (!stackCheck.ok) throw new CompositionError(`Invalid layer stack: ${stackCheck.error}`);

    const page = rasterizeStack(this.backend, stack);

    const pageCheck = validateComposedPage(this.backend, page, target);
    if (!pageCheck.ok) throw new CompositionError(`Invalid rendered page: ${pageCheck.error}`);

    const produced = await this.gateway.produce(page, { kind: 'derivative' });
    return {
      key: produced.key,
      descriptor: describePage(surfaceId, page, stack, this.backend),
      page,
    };
  }
}

function describePage(
  surfaceId: string,
  page: RasterImage,
  stack: LayerStack,
  backend: ImageBackend,
): PageDescriptor {
  return {
    schema: PAGE_DESCRIPTOR_SCHEMA,
    surfaceId,
    width: page.width,
    height: page.height,
    channels: page.channels,
    layerCount: stack.layers.length,
    byteLength: page.data.length,
    backend: backend.info.id,
    backendVersion: backend.info.version,
  };
}

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
