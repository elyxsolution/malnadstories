// EXIF ORIENTATION PROCESSOR (`image.exif-orientation`) — consumes the `decoded` + `metadata`
// descriptors and produces the `OrientedImage` correction: the transform that maps the source EXIF
// orientation onto the canonical display orientation (1) and the resulting dimensions. Single
// transformation: (geometry + orientation) → orientation-normalized geometry. Pure geometry — no
// pixels are moved (a later native backend applies the transform).

import { createProcessor } from '@workerv2/processor-sdk';
import type { ProcessorSpec, ProcessorDependencies } from '@workerv2/processor-sdk';
import type { Processor } from '@workerv2/processing';
import { normalizeOrientation } from '../lib/orientation.js';
import type { DecodedImage, ImageMetadata, OrientationCode } from '../model.js';
import { DECODED_SCHEMA, IMAGE_ENGINE_VERSION, METADATA_SCHEMA } from '../model.js';
import { SLOT, produceDescriptor, readDescriptor } from './common.js';

export const imageExifOrientationSpec: ProcessorSpec = {
  descriptor: {
    name: 'image.exif-orientation',
    version: IMAGE_ENGINE_VERSION,
    description:
      'Compute the orientation correction from EXIF onto the canonical display orientation.',
  },
  requiredInputs: [SLOT.decoded, SLOT.metadata],
  execute: async (ctx) => {
    const decoded = await readDescriptor<DecodedImage>(ctx, SLOT.decoded, DECODED_SCHEMA);
    const metadata = await readDescriptor<ImageMetadata>(ctx, SLOT.metadata, METADATA_SCHEMA);
    const orientation: OrientationCode = metadata.exif.orientation ?? 1;
    const oriented = normalizeOrientation(orientation, decoded.width, decoded.height);
    return { [SLOT.oriented]: await produceDescriptor(ctx, oriented) };
  },
};

/** Build the EXIF-orientation processor wired to a host's dependencies. */
export function createImageExifOrientationProcessor(deps: ProcessorDependencies): Processor {
  return createProcessor(imageExifOrientationSpec, deps);
}
