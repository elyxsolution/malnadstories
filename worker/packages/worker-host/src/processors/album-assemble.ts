import { createProcessor, abortPermanent } from '@workerv2/processor-sdk';
import type { ProcessorDependencies } from '@workerv2/processor-sdk';
import type { Processor } from '@workerv2/processing';
import type { StorageKey } from '@workerv2/infra-contracts';
import { parseBlueprint, nodeById } from '@workerv2/blueprint';
import type { Blueprint, BlueprintNodeId } from '@workerv2/blueprint';
import { buildDocument, serializeDocument } from '@workerv2/document';
import type { DocumentPageInput, PrintProfile } from '@workerv2/document';
import { ASSEMBLE_ALBUM_PROCESSOR, BLUEPRINT_INPUT, ALBUM_OUTPUT } from '@workerv2/manifest';

/** The assemble adapter's implementation version (a host binding, not a new algorithm). */
const ASSEMBLE_PROCESSOR_VERSION = '1.0.0';

/**
 * The `album.assemble` ADAPTER PROCESSOR — a thin composition-root binding of the Manifest's
 * assemble processor NAME to the existing Document Builder (ADR-0017). It contains NO new document
 * format: it reads the `blueprint` + each surface's rendered `page` input (in the manifest's
 * semantic `config.surfaces` order), assembles an immutable Document referencing those page
 * Artifacts, and produces the canonical Document as the `album` output. Ordering + cover
 * classification come from the blueprint; nothing here invents assembly semantics.
 */
export interface AlbumAssembleDeps {
  readonly printProfile: PrintProfile;
  readonly processorDeps: ProcessorDependencies;
}

export function createAlbumAssembleProcessor(deps: AlbumAssembleDeps): Processor {
  return createProcessor(
    {
      descriptor: {
        name: ASSEMBLE_ALBUM_PROCESSOR,
        version: ASSEMBLE_PROCESSOR_VERSION,
        description:
          'Assemble rendered page Artifacts into an immutable Document (Document Builder).',
      },
      requiredInputs: [BLUEPRINT_INPUT],
      execute: async (ctx) => {
        const parsed = parseBlueprint(await ctx.readText(BLUEPRINT_INPUT));
        if (!parsed.ok) abortPermanent(`invalid blueprint input: ${parsed.error.message}`);
        const blueprint = parsed.value;

        const surfaces = ctx.config['surfaces'];
        if (!Array.isArray(surfaces)) abortPermanent('assemble config.surfaces must be an array');

        const pages: DocumentPageInput[] = surfaces.map((surfaceId, index) => {
          if (typeof surfaceId !== 'string') abortPermanent('surface id must be a string');
          return {
            index,
            artifact: ctx.input(`page:${surfaceId}`),
            kind: surfaceKind(blueprint, surfaceId),
          };
        });

        const album = nodeById(blueprint, blueprint.root as BlueprintNodeId);
        const title =
          album !== undefined && album.kind === 'album' ? album.title : blueprint.albumId;

        const built = buildDocument({
          metadata: { albumId: blueprint.albumId, title },
          printProfile: deps.printProfile,
          pages,
        });
        if (!built.ok) abortPermanent(`document assembly failed: ${built.error.message}`);

        const key: StorageKey = await ctx.produceText(serializeDocument(built.value.document), {
          contentType: 'application/json',
          kind: 'document',
        });
        return { [ALBUM_OUTPUT]: key };
      },
    },
    deps.processorDeps,
  );
}

function surfaceKind(blueprint: Blueprint, surfaceId: string): 'cover' | 'page' {
  const node = nodeById(blueprint, surfaceId as BlueprintNodeId);
  return node !== undefined && node.kind === 'cover' ? 'cover' : 'page';
}
