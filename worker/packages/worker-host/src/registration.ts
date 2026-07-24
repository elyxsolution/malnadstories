import { InMemoryProcessorRegistry } from '@workerv2/execution-adapter';
import type { ProcessorDependencies } from '@workerv2/processor-sdk';
import type { ImageBackend, ArtifactBytesPort } from '@workerv2/image-backend';
import { createImageFoundationProcessors } from '@workerv2/image-processors';
import { createPdfExportProcessor } from '@workerv2/pdf-export';
import type { RenderTarget } from './config.js';
import type { PrintProfile } from '@workerv2/document';
import { createSurfaceRenderProcessor } from './processors/surface-render.js';
import { createAlbumAssembleProcessor } from './processors/album-assemble.js';

/**
 * PROCESSOR REGISTRATION — the host wires EVERY completed processor into one resolver: the six image
 * foundation processors (validate/decode/metadata/exif-orientation/color-normalize/format-normalize),
 * the `surface.render` composition adapter, the `album.assemble` document adapter, and the
 * `document.export.pdf` exporter. Each remains independently deployable + testable; the host merely
 * registers them. Every processor shares the ONE injected `ArtifactGateway` (the host store), so all
 * Artifact identities stay consistent across the pipeline.
 */
export interface RegistrationDeps {
  readonly processorDeps: ProcessorDependencies;
  readonly backend: ImageBackend;
  readonly store: ArtifactBytesPort;
  readonly renderTarget: RenderTarget;
  readonly printProfile: PrintProfile;
}

export function registerProcessors(deps: RegistrationDeps): InMemoryProcessorRegistry {
  const registry = new InMemoryProcessorRegistry();

  for (const processor of createImageFoundationProcessors(deps.processorDeps)) {
    registry.register(processor);
  }

  registry.register(
    createSurfaceRenderProcessor({
      backend: deps.backend,
      store: deps.store,
      renderTarget: deps.renderTarget,
      processorDeps: deps.processorDeps,
    }),
  );
  registry.register(
    createAlbumAssembleProcessor({
      printProfile: deps.printProfile,
      processorDeps: deps.processorDeps,
    }),
  );
  registry.register(createPdfExportProcessor(deps.processorDeps));

  return registry;
}
