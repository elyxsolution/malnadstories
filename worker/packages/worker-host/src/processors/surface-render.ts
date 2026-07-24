import { createProcessor, abortPermanent } from '@workerv2/processor-sdk';
import type { ProcessorDependencies } from '@workerv2/processor-sdk';
import type { Processor } from '@workerv2/processing';
import { parseBlueprint } from '@workerv2/blueprint';
import { CompositionEngine } from '@workerv2/composition';
import type { ImageBackend, ArtifactBytesPort } from '@workerv2/image-backend';
import { RENDER_SURFACE_PROCESSOR, BLUEPRINT_INPUT, PAGE_OUTPUT } from '@workerv2/manifest';
import { REFERENCE_BACKEND_VERSION } from '@workerv2/image-backend';
import type { RenderTarget } from '../config.js';

/**
 * The `surface.render` ADAPTER PROCESSOR — a thin composition-root binding of the Manifest's render
 * processor NAME to the existing `CompositionEngine`. It contains NO rendering algorithm: it reads
 * the `blueprint` input artifact, asks the engine to compose the surface named in `config.surface`,
 * and returns the produced `page` artifact identity. The engine (ADR-0016) does the compositing and
 * produces the content-addressed page raster through the shared store; the SDK gives the uniform
 * lifecycle/validation. Registering this NAME is what lets the Coordinator execute the manifest.
 */
export interface SurfaceRenderDeps {
  readonly backend: ImageBackend;
  readonly store: ArtifactBytesPort;
  readonly renderTarget: RenderTarget;
  readonly processorDeps: ProcessorDependencies;
}

export function createSurfaceRenderProcessor(deps: SurfaceRenderDeps): Processor {
  const engine = new CompositionEngine(deps.backend, deps.store);
  return createProcessor(
    {
      descriptor: {
        name: RENDER_SURFACE_PROCESSOR,
        version: REFERENCE_BACKEND_VERSION,
        description:
          'Compose a blueprint surface into a rendered page Artifact (CompositionEngine).',
      },
      requiredInputs: [BLUEPRINT_INPUT],
      execute: async (ctx) => {
        const parsed = parseBlueprint(await ctx.readText(BLUEPRINT_INPUT));
        if (!parsed.ok) abortPermanent(`invalid blueprint input: ${parsed.error.message}`);
        const surfaceId = ctx.config['surface'];
        if (typeof surfaceId !== 'string') abortPermanent('render config.surface must be a string');

        const rendered = await engine.composeSurface(parsed.value, surfaceId, deps.renderTarget);
        return { [PAGE_OUTPUT]: rendered.key };
      },
    },
    deps.processorDeps,
  );
}
