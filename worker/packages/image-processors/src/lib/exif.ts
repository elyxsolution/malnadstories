// Pure EXIF reader — extracts orientation + a few camera/capture tags from a TIFF IFD block,
// whether embedded in a JPEG APP1 segment or the file itself is a TIFF. Deliberately narrow: it
// reads only the tags the foundation processors act on (Orientation, Make, Model,
// DateTimeOriginal). Fully bounds-checked; a malformed block yields partial/empty data rather than
// throwing, so a slightly-corrupt EXIF never fails an otherwise-valid image.

import { ByteReader, ByteRangeError } from './bytes.js';
import type { ExifData, OrientationCode } from '../model.js';

const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;

const NUL = String.fromCharCode(0);

const TYPE_SIZES: Readonly<Record<number, number>> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
};

interface Mutable {
  orientation?: OrientationCode;
  dateTimeOriginal?: string;
  make?: string;
  model?: string;
}

/** Parse EXIF from a whole file (JPEG APP1 or a TIFF container). Returns `{}` when there is none. */
export function parseExif(data: Uint8Array, format: 'jpeg' | 'tiff'): ExifData {
  try {
    const reader = new ByteReader(data);
    const tiffStart = format === 'tiff' ? 0 : findJpegExifStart(reader);
    if (tiffStart === null) return {};
    return parseTiff(reader, tiffStart);
  } catch {
    // A corrupt EXIF block must never sink an otherwise-valid image.
    return {};
  }
}

/** Locate the TIFF header inside a JPEG's APP1 "Exif\0\0" segment; `null` if absent. */
function findJpegExifStart(r: ByteReader): number | null {
  let offset = 2; // skip SOI (FF D8)
  while (offset + 4 <= r.length) {
    if (r.u8(offset) !== 0xff) return null;
    const marker = r.u8(offset + 1);
    // Standalone markers without a length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) return null; // start of scan — no more metadata segments
    const segLength = r.u16be(offset + 2);
    if (segLength < 2) return null;
    if (marker === 0xe1 && r.matchesAt(offset + 4, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00])) {
      return offset + 10; // after FFE1 + length(2) + "Exif\0\0"(6)
    }
    offset += 2 + segLength;
  }
  return null;
}

/** Parse IFD0 (+ the Exif SubIFD) starting from a TIFF header at `tiffStart`. */
function parseTiff(r: ByteReader, tiffStart: number): ExifData {
  const byteOrder = r.u16be(tiffStart);
  const le = byteOrder === 0x4949; // "II"
  if (!le && byteOrder !== 0x4d4d) return {}; // not a valid byte-order mark
  const out: Mutable = {};

  const ifd0 = r.u32(tiffStart + 4, le);
  const exifIfdPointer = readIfd(r, tiffStart, tiffStart + ifd0, le, out);
  if (exifIfdPointer !== null) readIfd(r, tiffStart, tiffStart + exifIfdPointer, le, out);

  return { ...out };
}

/** Read one IFD's entries into `out`; returns the Exif SubIFD offset if this IFD declares one. */
function readIfd(
  r: ByteReader,
  tiffStart: number,
  ifdOffset: number,
  le: boolean,
  out: Mutable,
): number | null {
  if (ifdOffset + 2 > r.length) return null;
  const count = r.u16(ifdOffset, le);
  let exifIfd: number | null = null;

  for (let i = 0; i < count; i += 1) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > r.length) break;
    const tag = r.u16(entry, le);
    const type = r.u16(entry + 2, le);
    const valueCount = r.u32(entry + 4, le);
    const typeSize = TYPE_SIZES[type];
    if (typeSize === undefined) continue;
    const valueBytes = typeSize * valueCount;
    const valueAt = valueBytes <= 4 ? entry + 8 : tiffStart + r.u32(entry + 8, le);

    switch (tag) {
      case TAG_ORIENTATION: {
        if (type === 3) {
          const v = r.u16(valueAt, le);
          if (v >= 1 && v <= 8) out.orientation = v as OrientationCode;
        }
        break;
      }
      case TAG_MAKE:
        setAscii(r, valueAt, valueCount, (s) => (out.make = s));
        break;
      case TAG_MODEL:
        setAscii(r, valueAt, valueCount, (s) => (out.model = s));
        break;
      case TAG_DATETIME_ORIGINAL:
        setAscii(r, valueAt, valueCount, (s) => (out.dateTimeOriginal = s));
        break;
      case TAG_EXIF_IFD:
        if (type === 4) exifIfd = r.u32(entry + 8, le);
        break;
      default:
        break;
    }
  }
  return exifIfd;
}

/** Read a NUL-terminated ASCII value and hand the trimmed, non-empty string to `assign`. */
function setAscii(
  r: ByteReader,
  offset: number,
  count: number,
  assign: (value: string) => void,
): void {
  try {
    const raw = r.ascii(offset, count);
    const nul = raw.indexOf(NUL);
    const trimmed = (nul >= 0 ? raw.slice(0, nul) : raw).trim();
    if (trimmed.length > 0) assign(trimmed);
  } catch (error) {
    if (!(error instanceof ByteRangeError)) throw error;
  }
}
