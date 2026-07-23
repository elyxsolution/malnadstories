// FORMAT NORMALIZER (`image.format-normalize`) — consumes the `decoded` descriptor and produces
// the `NormalizedFormat` plan: the canonical delivery container and whether a transcode is
// required. Deterministic rule: alpha-bearing sources normalize to PNG (lossless, alpha-preserving),
// everything else to JPEG — unless config forces a target. Single transformation: source format →
// canonical format decision. The transcode itself is a deferred native backend.

import { createProcessor, requireConfig } from '@workerv2/processor-sdk';
import type { ProcessorSpec, ProcessorDependencies } from '@workerv2/processor-sdk';
import type { Processor } from '@workerv2/processing';
import { parseFormatConfig } from '../lib/config.js';
import type { DecodedImage, NormalizedFormat, TargetFormat } from '../model.js';
import {
  DECODED_SCHEMA,
  FORMAT_CONTENT_TYPES,
  FORMAT_SCHEMA,
  IMAGE_ENGINE_VERSION,
} from '../model.js';
import { SLOT, produceDescriptor, readDescriptor } from './common.js';

export const imageFormatNormalizeSpec: ProcessorSpec = {
  descriptor: {
    name: 'image.format-normalize',
    version: IMAGE_ENGINE_VERSION,
    description:
      'Decide the canonical delivery format (alpha → PNG, else JPEG) and transcode need.',
  },
  requiredInputs: [SLOT.decoded],
  execute: async (ctx) => {
    const options = requireConfig(ctx, parseFormatConfig);
    const decoded = await readDescriptor<DecodedImage>(ctx, SLOT.decoded, DECODED_SCHEMA);
    const targetFormat: TargetFormat = options.forceTarget ?? (decoded.hasAlpha ? 'png' : 'jpeg');

    const normalized: NormalizedFormat = {
      schema: FORMAT_SCHEMA,
      engineVersion: IMAGE_ENGINE_VERSION,
      sourceFormat: decoded.format,
      targetFormat,
      requiresTranscode: decoded.format !== targetFormat,
      contentType: FORMAT_CONTENT_TYPES[targetFormat],
    };
    return { [SLOT.format]: await produceDescriptor(ctx, normalized) };
  },
};

/** Build the format normalizer wired to a host's dependencies. */
export function createImageFormatNormalizeProcessor(deps: ProcessorDependencies): Processor {
  return createProcessor(imageFormatNormalizeSpec, deps);
}
