// IMAGE DECODE PROCESSOR (`image.decode`) — reads the raw image artifact and produces the
// structural `DecodedImage` descriptor (format, geometry, bit depth, channels, colour type, alpha,
// ICC presence). Single transformation: encoded bytes → decoded structure. An undecodable input is
// a `permanent` failure. No pixels are emitted (a full pixel decode is a deferred native backend).

import { createProcessor, abortPermanent } from '@workerv2/processor-sdk';
import type { ProcessorSpec, ProcessorDependencies } from '@workerv2/processor-sdk';
import type { Processor } from '@workerv2/processing';
import { decodeImage } from '../lib/decode.js';
import { IMAGE_ENGINE_VERSION } from '../model.js';
import { SLOT, produceDescriptor } from './common.js';

export const imageDecodeSpec: ProcessorSpec = {
  descriptor: {
    name: 'image.decode',
    version: IMAGE_ENGINE_VERSION,
    description: 'Structurally decode an encoded image to its geometry + pixel-format descriptor.',
  },
  requiredInputs: [SLOT.image],
  execute: async (ctx) => {
    const bytes = await ctx.read(SLOT.image);
    const decoded = decodeImage(bytes);
    if (decoded === null) abortPermanent('Image could not be structurally decoded');
    return { [SLOT.decoded]: await produceDescriptor(ctx, decoded) };
  },
};

/** Build the decode processor wired to a host's dependencies. */
export function createImageDecodeProcessor(deps: ProcessorDependencies): Processor {
  return createProcessor(imageDecodeSpec, deps);
}
