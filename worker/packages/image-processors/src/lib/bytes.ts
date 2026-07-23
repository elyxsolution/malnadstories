// Pure, bounds-checked byte reading over a `Uint8Array`. All image-container parsing goes through
// this so index access is always safe (the workspace enables `noUncheckedIndexedAccess`) and
// endianness is explicit. No allocation beyond small slices; deterministic on every platform.

/** Raised when a parser reads past the end of the buffer — caught + turned into a parse failure. */
export class ByteRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ByteRangeError';
  }
}

/** A cursor-free reader: every read is explicit about offset + endianness. */
export class ByteReader {
  constructor(private readonly data: Uint8Array) {}

  get length(): number {
    return this.data.length;
  }

  /** A single byte (0..255). */
  u8(offset: number): number {
    const value = this.data[offset];
    if (value === undefined) throw new ByteRangeError(`u8 out of range at ${offset}`);
    return value;
  }

  /** A big-endian unsigned 16-bit integer. */
  u16be(offset: number): number {
    return (this.u8(offset) << 8) | this.u8(offset + 1);
  }

  /** A little-endian unsigned 16-bit integer. */
  u16le(offset: number): number {
    return this.u8(offset) | (this.u8(offset + 1) << 8);
  }

  /** A big-endian unsigned 32-bit integer. */
  u32be(offset: number): number {
    return (
      (this.u8(offset) * 0x1000000 +
        (this.u8(offset + 1) << 16) +
        (this.u8(offset + 2) << 8) +
        this.u8(offset + 3)) >>>
      0
    );
  }

  /** A little-endian unsigned 32-bit integer. */
  u32le(offset: number): number {
    return (
      (this.u8(offset) +
        (this.u8(offset + 1) << 8) +
        (this.u8(offset + 2) << 16) +
        this.u8(offset + 3) * 0x1000000) >>>
      0
    );
  }

  /** An endian-parameterized unsigned 16-bit read (TIFF/EXIF use a byte-order flag). */
  u16(offset: number, littleEndian: boolean): number {
    return littleEndian ? this.u16le(offset) : this.u16be(offset);
  }

  /** An endian-parameterized unsigned 32-bit read. */
  u32(offset: number, littleEndian: boolean): number {
    return littleEndian ? this.u32le(offset) : this.u32be(offset);
  }

  /** Whether `bytes` appears exactly at `offset`. */
  matchesAt(offset: number, bytes: readonly number[]): boolean {
    if (offset + bytes.length > this.data.length) return false;
    for (let i = 0; i < bytes.length; i += 1) {
      if (this.data[offset + i] !== bytes[i]) return false;
    }
    return true;
  }

  /** An ASCII string of `length` bytes at `offset` (non-ASCII bytes pass through as code points). */
  ascii(offset: number, length: number): string {
    if (offset + length > this.data.length) {
      throw new ByteRangeError(`ascii out of range at ${offset}..${offset + length}`);
    }
    let out = '';
    for (let i = 0; i < length; i += 1) out += String.fromCharCode(this.u8(offset + i));
    return out;
  }
}

/** ASCII byte sequences for the magic-byte and marker comparisons the parsers use. */
export function asciiBytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) out.push(text.charCodeAt(i) & 0xff);
  return out;
}
