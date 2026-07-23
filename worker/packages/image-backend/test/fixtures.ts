// Deterministic BMP fixtures for the backend tests. Pixels are supplied TOP-DOWN, row-major, as
// [R,G,B] (24-bit) or [R,G,B,A] (32-bit); the builder writes a valid uncompressed BMP (bottom-up
// rows, 4-byte-padded, BGR(A) byte order) so `decodeBmp` has real encoded input to parse.

class ByteWriter {
  private readonly out: number[] = [];
  u8(v: number): this {
    this.out.push(v & 0xff);
    return this;
  }
  u16le(v: number): this {
    return this.u8(v).u8(v >> 8);
  }
  u32le(v: number): this {
    return this.u8(v)
      .u8(v >> 8)
      .u8(v >> 16)
      .u8(v >>> 24);
  }
  i32le(v: number): this {
    return this.u32le(v >>> 0);
  }
  ascii(text: string): this {
    for (let i = 0; i < text.length; i += 1) this.u8(text.charCodeAt(i));
    return this;
  }
  build(): Uint8Array {
    return new Uint8Array(this.out);
  }
}

function buildBmp(
  width: number,
  height: number,
  pixels: readonly (readonly number[])[],
  bitCount: 24 | 32,
): Uint8Array {
  const srcChannels = bitCount / 8;
  const rowStride = ((bitCount * width + 31) >> 5) * 4;
  const pad = rowStride - width * srcChannels;
  const dataOffset = 54;
  const imageSize = rowStride * height;

  const w = new ByteWriter();
  // File header
  w.ascii('BM')
    .u32le(dataOffset + imageSize)
    .u16le(0)
    .u16le(0)
    .u32le(dataOffset);
  // DIB (BITMAPINFOHEADER)
  w.u32le(40)
    .i32le(width)
    .i32le(height) // positive → bottom-up
    .u16le(1)
    .u16le(bitCount)
    .u32le(0) // BI_RGB
    .u32le(imageSize)
    .u32le(2835)
    .u32le(2835)
    .u32le(0)
    .u32le(0);
  // Pixel data — bottom-up rows.
  for (let fileRow = 0; fileRow < height; fileRow += 1) {
    const srcRow = height - 1 - fileRow;
    for (let x = 0; x < width; x += 1) {
      const px = pixels[srcRow * width + x] ?? [];
      const r = px[0] ?? 0;
      const g = px[1] ?? 0;
      const b = px[2] ?? 0;
      w.u8(b).u8(g).u8(r); // BGR
      if (bitCount === 32) w.u8(px[3] ?? 255); // A
    }
    for (let p = 0; p < pad; p += 1) w.u8(0);
  }
  return w.build();
}

export function buildBmp24(
  width: number,
  height: number,
  pixels: readonly (readonly number[])[],
): Uint8Array {
  return buildBmp(width, height, pixels, 24);
}

export function buildBmp32(
  width: number,
  height: number,
  pixels: readonly (readonly number[])[],
): Uint8Array {
  return buildBmp(width, height, pixels, 32);
}
