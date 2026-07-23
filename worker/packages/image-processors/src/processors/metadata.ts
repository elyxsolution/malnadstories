// METADATA EXTRACTOR PROCESSOR (`image.metadata`) — reads the raw image artifact and produces the
// `ImageMetadata` descriptor (format, byte size, intrinsic dimensions, and EXIF
// orientation/camera/capture facts). Single transformation: encoded bytes → self-declared
// metadata. Metadata is RECORDED THROUGH the produced artifact, never a side channel.

import { createProcessor, abortPermanent } from '@workerv2/processor-sdk';
import type { ProcessorSpec, ProcessorDependencies } from '@workerv2/processor-sdk';
import type { Processor } from '@workerv2/processing';
import { extractMetadata } from '../lib/metadata.js';
import { IMAGE_ENGINE_VERSION } from '../model.js';
import { SLOT, produceDescriptor } from './common.js';

export const imageMetadataSpec: ProcessorSpec = {
  descriptor: {
    name: 'image.metadata',
    version: IMAGE_ENGINE_VERSION,
    description: 'Extract format, dimensions, and EXIF metadata from an image into a descriptor.',
  },
  requiredInputs: [SLOT.image],
  execute: async (ctx) => {
    const bytes = await ctx.read(SLOT.image);
    const metadata = extractMetadata(bytes);
    if (metadata === null) abortPermanent('Unrecognized image format; cannot extract metadata');
    return { [SLOT.metadata]: await produceDescriptor(ctx, metadata) };
  },
};

/** Build the metadata extractor processor wired to a host's dependencies. */
export function createImageMetadataProcessor(deps: ProcessorDependencies): Processor {
  return createProcessor(imageMetadataSpec, deps);
}
