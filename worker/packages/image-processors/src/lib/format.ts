// Deterministic image-format detection by MAGIC BYTES (never by extension — there are no file
// names here, only content). Recognizes the seven foundation formats; returns `null` for anything
// unrecognized so the validator can reject it as an unsupported/spoofed input.

import { ByteReader } from './bytes.js';
import type { ImageFormat } from '../model.js';

/** Detect the container format of `data` from its leading bytes, or `null` if unrecognized. */
export function detectFormat(data: Uint8Array): ImageFormat | null {
  const r = new ByteReader(data);

  // JPEG: FF D8 FF
  if (r.matchesAt(0, [0xff, 0xd8, 0xff])) return 'jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (r.matchesAt(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';

  // GIF: "GIF87a" / "GIF89a"
  if (r.matchesAt(0, [0x47, 0x49, 0x46, 0x38])) return 'gif';

  // WEBP: "RIFF"????"WEBP"
  if (r.matchesAt(0, [0x52, 0x49, 0x46, 0x46]) && r.matchesAt(8, [0x57, 0x45, 0x42, 0x50])) {
    return 'webp';
  }

  // BMP: "BM"
  if (r.matchesAt(0, [0x42, 0x4d])) return 'bmp';

  // TIFF: "II*\0" (little-endian) or "MM\0*" (big-endian)
  if (r.matchesAt(0, [0x49, 0x49, 0x2a, 0x00]) || r.matchesAt(0, [0x4d, 0x4d, 0x00, 0x2a])) {
    return 'tiff';
  }

  // HEIC/HEIF: "....ftyp" + a HEIF-family brand at bytes 8..11.
  if (r.matchesAt(4, [0x66, 0x74, 0x79, 0x70])) {
    const brand = safeAscii(r, 8, 4);
    if (brand !== null && HEIF_BRANDS.has(brand)) return 'heic';
  }

  return null;
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

function safeAscii(r: ByteReader, offset: number, length: number): string | null {
  try {
    return r.ascii(offset, length);
  } catch {
    return null;
  }
}
