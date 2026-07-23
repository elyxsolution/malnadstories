// Metadata EXTRACTION — what a file declares about itself: format, byte size, intrinsic
// dimensions (when the header exposes them), and EXIF camera/orientation/capture facts. Distinct
// from `decode`, which reports the raster's pixel facts. Resilient: geometry or EXIF that fails to
// parse degrades to `null`/`{}` rather than failing the whole extraction.

import { detectFormat } from './format.js';
import { decodeImage } from './decode.js';
import { parseExif } from './exif.js';
import type { ImageMetadata } from '../model.js';
import { IMAGE_ENGINE_VERSION, METADATA_SCHEMA } from '../model.js';

/** Extract the file's self-declared metadata, or `null` if the container is unrecognized. */
export function extractMetadata(data: Uint8Array): ImageMetadata | null {
  const format = detectFormat(data);
  if (format === null) return null;

  const decoded = decodeImage(data);
  const dimensions = decoded === null ? null : { width: decoded.width, height: decoded.height };

  const exif = format === 'jpeg' || format === 'tiff' ? parseExif(data, format) : {};
  const hasExif = Object.keys(exif).length > 0;

  return {
    schema: METADATA_SCHEMA,
    engineVersion: IMAGE_ENGINE_VERSION,
    format,
    byteLength: data.length,
    dimensions,
    hasExif,
    exif,
  };
}
