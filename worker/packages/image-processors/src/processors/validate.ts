// IMAGE VALIDATION PROCESSOR (`image.validate`) — the safety gate. Reads the raw image artifact,
// confirms it is a recognized + allowed format, that it decodes structurally, and that its byte
// size and dimensions are within bounds INCLUDING a decompression-bomb pixel guard. A valid image
// yields a `ValidationReport` artifact; an invalid one is a `permanent` failure (retrying cannot
// fix bad bytes). Single transformation: raw bytes → validation verdict. No album knowledge.

import { createProcessor, requireConfig, ensure, abortPermanent } from '@workerv2/processor-sdk';
import type { ProcessorSpec, ProcessorDependencies } from '@workerv2/processor-sdk';
import type { Processor } from '@workerv2/processing';
import { detectFormat } from '../lib/format.js';
import { decodeImage } from '../lib/decode.js';
import { parseValidationConfig } from '../lib/config.js';
import type { ValidationReport } from '../model.js';
import { IMAGE_ENGINE_VERSION, VALIDATION_SCHEMA } from '../model.js';
import { SLOT, produceDescriptor } from './common.js';

export const imageValidationSpec: ProcessorSpec = {
  descriptor: {
    name: 'image.validate',
    version: IMAGE_ENGINE_VERSION,
    description:
      'Validate a raw image: recognized+allowed format, decodable, within size/pixel limits.',
  },
  requiredInputs: [SLOT.image],
  execute: async (ctx) => {
    const limits = requireConfig(ctx, parseValidationConfig);
    const bytes = await ctx.read(SLOT.image);

    ensure(
      bytes.length <= limits.maxBytes,
      `Image exceeds the maximum byte size (${bytes.length} > ${limits.maxBytes})`,
      { byteLength: bytes.length, maxBytes: limits.maxBytes },
    );

    const format = detectFormat(bytes);
    if (format === null) abortPermanent('Unsupported or unrecognized image format');
    ensure(limits.allowedFormats.includes(format), `Format "${format}" is not allowed`, {
      format,
      allowed: limits.allowedFormats,
    });

    const decoded = decodeImage(bytes);
    if (decoded === null) abortPermanent('Image could not be structurally decoded', { format });

    ctx.reportProgress({ fraction: 0.5, phase: 'execute', message: 'geometry checks' });

    ensure(
      decoded.width <= limits.maxWidth && decoded.height <= limits.maxHeight,
      `Image dimensions exceed limits (${decoded.width}x${decoded.height})`,
      { width: decoded.width, height: decoded.height },
    );

    const pixels = decoded.width * decoded.height;
    ensure(
      pixels <= limits.maxPixels,
      `Image exceeds the maximum pixel count (decompression-bomb guard): ${pixels} > ${limits.maxPixels}`,
      { pixels, maxPixels: limits.maxPixels },
    );

    const report: ValidationReport = {
      schema: VALIDATION_SCHEMA,
      engineVersion: IMAGE_ENGINE_VERSION,
      ok: true,
      format,
      width: decoded.width,
      height: decoded.height,
      pixels,
      byteLength: bytes.length,
    };
    return { [SLOT.report]: await produceDescriptor(ctx, report) };
  },
};

/** Build the validation processor wired to a host's dependencies. */
export function createImageValidationProcessor(deps: ProcessorDependencies): Processor {
  return createProcessor(imageValidationSpec, deps);
}
