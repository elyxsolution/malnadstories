// COLOR PROFILE NORMALIZER (`image.color-normalize`) — consumes the `decoded` descriptor and
// produces the `NormalizedColor` plan: the source colour type / channels / ICC, the canonical
// target (sRGB) with a canonical channel layout, and whether a conversion is actually required.
// Single transformation: pixel-format facts → colour-normalization plan. The pixel conversion
// itself is a deferred native backend behind the same processor contract.

import { createProcessor } from '@workerv2/processor-sdk';
import type { ProcessorSpec, ProcessorDependencies } from '@workerv2/processor-sdk';
import type { Processor } from '@workerv2/processing';
import type { DecodedImage, NormalizedColor } from '../model.js';
import { COLOR_SCHEMA, DECODED_SCHEMA, IMAGE_ENGINE_VERSION } from '../model.js';
import { SLOT, produceDescriptor, readDescriptor } from './common.js';

export const imageColorNormalizeSpec: ProcessorSpec = {
  descriptor: {
    name: 'image.color-normalize',
    version: IMAGE_ENGINE_VERSION,
    description: 'Plan normalization of an image into the canonical sRGB working colour space.',
  },
  requiredInputs: [SLOT.decoded],
  execute: async (ctx) => {
    const decoded = await readDescriptor<DecodedImage>(ctx, SLOT.decoded, DECODED_SCHEMA);
    const targetChannels: 3 | 4 = decoded.hasAlpha ? 4 : 3;
    // A conversion is required unless the source is already sRGB-shaped: no embedded ICC profile,
    // an already-RGB(A) colour type, and 8-bit depth.
    const alreadyCanonical =
      !decoded.icc.present &&
      (decoded.colorType === 'rgb' || decoded.colorType === 'rgba') &&
      decoded.bitDepth === 8;

    const normalized: NormalizedColor = {
      schema: COLOR_SCHEMA,
      engineVersion: IMAGE_ENGINE_VERSION,
      sourceColorType: decoded.colorType,
      sourceChannels: decoded.channels,
      sourceHasAlpha: decoded.hasAlpha,
      sourceIcc: decoded.icc,
      targetColorSpace: 'srgb',
      targetChannels,
      requiresConversion: !alreadyCanonical,
    };
    return { [SLOT.color]: await produceDescriptor(ctx, normalized) };
  },
};

/** Build the colour-profile normalizer wired to a host's dependencies. */
export function createImageColorNormalizeProcessor(deps: ProcessorDependencies): Processor {
  return createProcessor(imageColorNormalizeSpec, deps);
}
