// Deterministic image-byte FIXTURES for the foundation-processor tests. Each builder emits the
// minimal valid header the pure parsers read — enough to exercise format detection, dimensions,
// colour, and EXIF, without embedding real pixel data. A tiny little-endian byte writer keeps the
// EXIF/TIFF layout math honest.

/** A minimal growable byte writer (push primitives; `bytes()` finalizes). */
export class ByteWriter {
  private readonly out: number[] = [];

  u8(value: number): this {
    this.out.push(value & 0xff);
    return this;
  }
  u16be(value: number): this {
    return this.u8(value >> 8).u8(value);
  }
  u16le(value: number): this {
    return this.u8(value).u8(value >> 8);
  }
  u32be(value: number): this {
    return this.u8(value >>> 24)
      .u8(value >> 16)
      .u8(value >> 8)
      .u8(value);
  }
  u32le(value: number): this {
    return this.u8(value)
      .u8(value >> 8)
      .u8(value >> 16)
      .u8(value >>> 24);
  }
  ascii(text: string): this {
    for (let i = 0; i < text.length; i += 1) this.u8(text.charCodeAt(i));
    return this;
  }
  bytes(values: readonly number[]): this {
    for (const v of values) this.u8(v);
    return this;
  }
  get length(): number {
    return this.out.length;
  }
  build(): Uint8Array {
    return new Uint8Array(this.out);
  }
}

// --- PNG ---

export interface PngOptions {
  width: number;
  height: number;
  bitDepth?: number;
  colorType?: number; // 0 gray, 2 rgb, 3 palette, 4 gray+alpha, 6 rgba
  icc?: string; // include an iCCP chunk with this profile name
}

export function buildPng(opts: PngOptions): Uint8Array {
  const w = new ByteWriter();
  w.bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // signature
  // IHDR
  w.u32be(13).ascii('IHDR');
  w.u32be(opts.width).u32be(opts.height);
  w.u8(opts.bitDepth ?? 8)
    .u8(opts.colorType ?? 2)
    .u8(0)
    .u8(0)
    .u8(0);
  w.u32be(0); // CRC (unchecked by the parser)
  if (opts.icc !== undefined) {
    const name = opts.icc;
    const dataLen = name.length + 1 + 1 + 2; // name + NUL + compression + 2 profile bytes
    w.u32be(dataLen).ascii('iCCP');
    w.ascii(name).u8(0).u8(0).u8(0x78).u8(0x9c);
    w.u32be(0);
  }
  w.u32be(0).ascii('IEND').u32be(0); // IEND
  return w.build();
}

// --- GIF ---

export function buildGif(width: number, height: number): Uint8Array {
  const w = new ByteWriter();
  w.ascii('GIF89a').u16le(width).u16le(height).u8(0x00).u8(0).u8(0);
  return w.build();
}

// --- BMP ---

export function buildBmp(width: number, height: number, bitCount = 24): Uint8Array {
  const w = new ByteWriter();
  w.ascii('BM').u32le(0).u16le(0).u16le(0).u32le(54); // file header
  w.u32le(40); // DIB header size (BITMAPINFOHEADER)
  w.u32le(width).u32le(height).u16le(1).u16le(bitCount);
  w.u32le(0).u32le(0).u32le(0).u32le(0).u32le(0).u32le(0);
  return w.build();
}

// --- WebP (VP8L lossless / VP8X extended) ---

export function buildWebpLossless(width: number, height: number, alpha = false): Uint8Array {
  const body = new ByteWriter();
  body.ascii('VP8L').u32le(5); // chunk header (size is nominal)
  body.u8(0x2f);
  const w14 = (width - 1) & 0x3fff;
  const h14 = (height - 1) & 0x3fff;
  const b0 = w14 & 0xff;
  const b1 = ((w14 >> 8) & 0x3f) | ((h14 & 0x03) << 6);
  const b2 = (h14 >> 2) & 0xff;
  const b3 = ((h14 >> 10) & 0x0f) | (alpha ? 0x10 : 0x00);
  body.u8(b0).u8(b1).u8(b2).u8(b3);
  return wrapRiff(body.build());
}

export function buildWebpExtended(width: number, height: number, alpha = false): Uint8Array {
  const body = new ByteWriter();
  body.ascii('VP8X').u32le(10);
  body
    .u8(alpha ? 0x10 : 0x00)
    .u8(0)
    .u8(0)
    .u8(0); // flags + reserved
  body
    .u8((width - 1) & 0xff)
    .u8(((width - 1) >> 8) & 0xff)
    .u8(((width - 1) >> 16) & 0xff);
  body
    .u8((height - 1) & 0xff)
    .u8(((height - 1) >> 8) & 0xff)
    .u8(((height - 1) >> 16) & 0xff);
  return wrapRiff(body.build());
}

function wrapRiff(chunk: Uint8Array): Uint8Array {
  const w = new ByteWriter();
  w.ascii('RIFF')
    .u32le(4 + chunk.length)
    .ascii('WEBP');
  for (const b of chunk) w.u8(b);
  return w.build();
}

// --- TIFF + EXIF (shared IFD builder) ---

interface IfdEntry {
  tag: number;
  type: number; // 2 ASCII, 3 SHORT, 4 LONG
  values: number[] | string; // numbers for SHORT/LONG, string for ASCII
}

const TYPE_SIZE: Record<number, number> = { 2: 1, 3: 2, 4: 4 };

/**
 * Build a TIFF byte block (little-endian) from IFD0 entries + an optional Exif SubIFD (used for
 * both standalone TIFF fixtures and the EXIF block embedded in a JPEG APP1).
 */
export function buildTiff(ifd0: IfdEntry[], exifSub?: IfdEntry[]): Uint8Array {
  // Layout offsets are relative to the TIFF start.
  const headerSize = 8;
  const ifd0Size = 2 + ifd0.length * 12 + 4;
  let cursor = headerSize + ifd0Size; // data pool for IFD0 begins here
  const pool0: { offset: number; bytes: number[] }[] = [];

  const ifd0Resolved = ifd0.map((e) => {
    const { inline, poolBytes } = encodeValue(e);
    if (poolBytes !== null) {
      const offset = cursor;
      pool0.push({ offset, bytes: poolBytes });
      cursor += poolBytes.length;
      return { entry: e, valueField: offset };
    }
    return { entry: e, valueField: inline };
  });

  // Exif SubIFD (if any) sits after IFD0's data pool.
  let exifIfdOffset = 0;
  let exifBlock: number[] = [];
  if (exifSub !== undefined) {
    exifIfdOffset = cursor;
    const built = buildIfdBlock(exifSub, exifIfdOffset);
    exifBlock = built.bytes;
    cursor += built.bytes.length;
  }

  const w = new ByteWriter();
  w.ascii('II').u16le(0x002a).u32le(8); // header → IFD0 at 8
  w.u16le(ifd0.length);
  for (const { entry, valueField } of ifd0Resolved) {
    const isExifPointer = entry.tag === 0x8769;
    w.u16le(entry.tag).u16le(entry.type).u32le(valueCount(entry));
    w.u32le(isExifPointer ? exifIfdOffset : valueField);
  }
  w.u32le(0); // no next IFD
  // IFD0 data pool
  for (const { bytes } of pool0) for (const b of bytes) w.u8(b);
  // Exif SubIFD block
  for (const b of exifBlock) w.u8(b);
  return w.build();
}

function buildIfdBlock(entries: IfdEntry[], blockStart: number): { bytes: number[] } {
  const ifdSize = 2 + entries.length * 12 + 4;
  let cursor = blockStart + ifdSize;
  const pool: { bytes: number[] }[] = [];
  const resolved = entries.map((e) => {
    const { inline, poolBytes } = encodeValue(e);
    if (poolBytes !== null) {
      const offset = cursor;
      pool.push({ bytes: poolBytes });
      cursor += poolBytes.length;
      return { entry: e, valueField: offset };
    }
    return { entry: e, valueField: inline };
  });

  const w = new ByteWriter();
  w.u16le(entries.length);
  for (const { entry, valueField } of resolved) {
    w.u16le(entry.tag).u16le(entry.type).u32le(valueCount(entry)).u32le(valueField);
  }
  w.u32le(0);
  for (const { bytes } of pool) for (const b of bytes) w.u8(b);
  return { bytes: Array.from(w.build()) };
}

function valueCount(e: IfdEntry): number {
  return typeof e.values === 'string' ? e.values.length + 1 : e.values.length;
}

function encodeValue(e: IfdEntry): { inline: number; poolBytes: number[] | null } {
  const size = TYPE_SIZE[e.type] ?? 1;
  const count = valueCount(e);
  const totalBytes = size * count;
  if (typeof e.values === 'string') {
    const bytes = [...e.values].map((c) => c.charCodeAt(0));
    bytes.push(0); // NUL terminator
    if (totalBytes <= 4) {
      // Inline ASCII, little-endian packed into the 4-byte value field.
      let inline = 0;
      for (let i = 0; i < bytes.length; i += 1) inline |= (bytes[i] ?? 0) << (8 * i);
      return { inline: inline >>> 0, poolBytes: null };
    }
    return { inline: 0, poolBytes: bytes };
  }
  // Numeric SHORT/LONG — single value inline (little-endian).
  const value = e.values[0] ?? 0;
  return { inline: value >>> 0, poolBytes: null };
}

export interface ExifOptions {
  orientation?: number;
  make?: string;
  model?: string;
  dateTimeOriginal?: string;
}

/** Build a standalone TIFF file carrying dimensions + optional EXIF tags. */
export function buildTiffImage(width: number, height: number, exif: ExifOptions = {}): Uint8Array {
  return buildTiff(ifd0Entries(width, height, exif), subIfdEntries(exif));
}

function ifd0Entries(width: number, height: number, exif: ExifOptions): IfdEntry[] {
  const entries: IfdEntry[] = [
    { tag: 0x0100, type: 4, values: [width] }, // ImageWidth
    { tag: 0x0101, type: 4, values: [height] }, // ImageLength
    { tag: 0x0102, type: 3, values: [8] }, // BitsPerSample
    { tag: 0x0115, type: 3, values: [3] }, // SamplesPerPixel
  ];
  if (exif.orientation !== undefined) {
    entries.push({ tag: 0x0112, type: 3, values: [exif.orientation] });
  }
  if (exif.make !== undefined) entries.push({ tag: 0x010f, type: 2, values: exif.make });
  if (exif.model !== undefined) entries.push({ tag: 0x0110, type: 2, values: exif.model });
  if (exif.dateTimeOriginal !== undefined) {
    entries.push({ tag: 0x8769, type: 4, values: [0] }); // Exif SubIFD pointer (patched by builder)
  }
  return entries.sort((a, b) => a.tag - b.tag);
}

function subIfdEntries(exif: ExifOptions): IfdEntry[] | undefined {
  if (exif.dateTimeOriginal === undefined) return undefined;
  return [{ tag: 0x9003, type: 2, values: exif.dateTimeOriginal }];
}

// --- JPEG (SOI + optional EXIF APP1 + optional ICC APP2 + SOF0 + EOI) ---

export interface JpegOptions {
  width: number;
  height: number;
  components?: number; // 1 gray, 3 ycbcr, 4 cmyk
  exif?: ExifOptions;
  icc?: boolean;
}

export function buildJpeg(opts: JpegOptions): Uint8Array {
  const w = new ByteWriter();
  w.bytes([0xff, 0xd8]); // SOI

  if (opts.exif !== undefined) {
    const tiff = buildTiffExif(opts.exif);
    const segLen = 2 + 6 + tiff.length; // length field + "Exif\0\0" + TIFF
    w.bytes([0xff, 0xe1]).u16be(segLen).ascii('Exif').u8(0).u8(0);
    for (const b of tiff) w.u8(b);
  }

  if (opts.icc === true) {
    const marker = 'ICC_PROFILE ';
    const segLen = 2 + marker.length + 4; // length + marker + a little profile
    w.bytes([0xff, 0xe2]).u16be(segLen).ascii(marker).u8(1).u8(1).u8(0).u8(0);
  }

  // SOF0
  const components = opts.components ?? 3;
  const sofLen = 8 + components * 3;
  w.bytes([0xff, 0xc0]).u16be(sofLen).u8(8).u16be(opts.height).u16be(opts.width).u8(components);
  for (let i = 0; i < components; i += 1)
    w.u8(i + 1)
      .u8(0x11)
      .u8(0);
  w.bytes([0xff, 0xd9]); // EOI
  return w.build();
}

/** The EXIF TIFF block only (IFD0 dimensions omitted — JPEG geometry lives in the SOF). */
function buildTiffExif(exif: ExifOptions): Uint8Array {
  const entries: IfdEntry[] = [];
  if (exif.orientation !== undefined) {
    entries.push({ tag: 0x0112, type: 3, values: [exif.orientation] });
  }
  if (exif.make !== undefined) entries.push({ tag: 0x010f, type: 2, values: exif.make });
  if (exif.model !== undefined) entries.push({ tag: 0x0110, type: 2, values: exif.model });
  if (exif.dateTimeOriginal !== undefined) {
    entries.push({ tag: 0x8769, type: 4, values: [0] });
  }
  entries.sort((a, b) => a.tag - b.tag);
  return buildTiff(entries, subIfdEntries(exif));
}
