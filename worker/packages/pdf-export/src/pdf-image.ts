import type { RasterImage } from '@workerv2/image-backend';
import { PdfExportError } from './errors.js';

/**
 * Pack a decoded page RASTER into a PDF image XObject's samples. This is FORMAT PACKING, not image
 * processing: it selects/de-interleaves 8-bit channels into the PDF colour-space layout with ZERO
 * pixel transformation — no resampling, no filtering, no colour conversion. Grayscale → DeviceGray;
 * RGB → DeviceRGB; RGBA → DeviceRGB samples plus a DeviceGray soft-mask (the alpha channel).
 */

export type PdfColorSpace = 'DeviceRGB' | 'DeviceGray';

export interface PdfImage {
  readonly width: number;
  readonly height: number;
  readonly colorSpace: PdfColorSpace;
  /** The colour samples (RGB, or gray) in row-major order. */
  readonly samples: Uint8Array;
  /** The soft-mask (alpha) samples, when the source raster had an alpha channel. */
  readonly smask?: Uint8Array;
}

/** Convert a decoded raster into PDF image samples (+ optional soft mask). */
export function rasterToPdfImage(raster: RasterImage): PdfImage {
  const { width, height, channels, data } = raster;
  const pixels = width * height;

  if (channels === 1) {
    return { width, height, colorSpace: 'DeviceGray', samples: new Uint8Array(data) };
  }
  if (channels === 3) {
    return { width, height, colorSpace: 'DeviceRGB', samples: new Uint8Array(data) };
  }
  if (channels === 4) {
    const rgb = new Uint8Array(pixels * 3);
    const alpha = new Uint8Array(pixels);
    for (let p = 0; p < pixels; p += 1) {
      const s = p * 4;
      const d = p * 3;
      rgb[d] = data[s] as number;
      rgb[d + 1] = data[s + 1] as number;
      rgb[d + 2] = data[s + 2] as number;
      alpha[p] = data[s + 3] as number;
    }
    return { width, height, colorSpace: 'DeviceRGB', samples: rgb, smask: alpha };
  }
  throw new PdfExportError(`unsupported channel count ${channels} for PDF embedding`);
}
