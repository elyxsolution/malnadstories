// TRANSFORM APPLICATION — fit a source raster into a destination box, returning an RGBA raster of
// exactly the destination size, ready to composite. All scaling/cropping/padding runs through the
// replaceable `ImageBackend` (so a future GPU backend accelerates it) and is deterministic. Three
// fit modes: `fill` (stretch), `cover` (scale to fill + centre-crop), `contain` (scale to fit +
// centre-pad transparent).

import type { ImageBackend, RasterImage } from '@workerv2/image-backend';
import type { FitMode } from './model.js';

/** Convert any raster to 8-bit sRGB RGBA (the compositing working format). */
export function toRgba(backend: ImageBackend, raster: RasterImage): RasterImage {
  if (raster.channels === 4 && raster.colorSpace === 'srgb') return raster;
  return backend.convert(raster, { op: 'convert', colorSpace: 'srgb', channels: 4 });
}

/** Fit `raster` into a `destW`×`destH` RGBA raster under `fit`. */
export function fitRaster(
  backend: ImageBackend,
  raster: RasterImage,
  destW: number,
  destH: number,
  fit: FitMode,
): RasterImage {
  const rgba = toRgba(backend, raster);
  switch (fit) {
    case 'fill':
      return backend.resize(rgba, { op: 'resize', width: destW, height: destH });
    case 'cover':
      return fitCover(backend, rgba, destW, destH);
    case 'contain':
      return fitContain(backend, rgba, destW, destH);
    default:
      return backend.resize(rgba, { op: 'resize', width: destW, height: destH });
  }
}

function fitCover(
  backend: ImageBackend,
  rgba: RasterImage,
  destW: number,
  destH: number,
): RasterImage {
  const scale = Math.max(destW / rgba.width, destH / rgba.height);
  const iw = Math.max(destW, Math.round(rgba.width * scale));
  const ih = Math.max(destH, Math.round(rgba.height * scale));
  const scaled = backend.resize(rgba, { op: 'resize', width: iw, height: ih });
  const cropX = Math.floor((iw - destW) / 2);
  const cropY = Math.floor((ih - destH) / 2);
  return backend.crop(scaled, { op: 'crop', x: cropX, y: cropY, width: destW, height: destH });
}

function fitContain(
  backend: ImageBackend,
  rgba: RasterImage,
  destW: number,
  destH: number,
): RasterImage {
  const scale = Math.min(destW / rgba.width, destH / rgba.height);
  const iw = Math.min(destW, Math.max(1, Math.round(rgba.width * scale)));
  const ih = Math.min(destH, Math.max(1, Math.round(rgba.height * scale)));
  const scaled = backend.resize(rgba, { op: 'resize', width: iw, height: ih });

  // Centre the scaled image on a transparent dest-sized RGBA canvas.
  const out = new Uint8Array(destW * destH * 4); // all zero → fully transparent
  const offX = Math.floor((destW - iw) / 2);
  const offY = Math.floor((destH - ih) / 2);
  for (let y = 0; y < ih; y += 1) {
    const srcStart = y * iw * 4;
    const dstStart = ((offY + y) * destW + offX) * 4;
    out.set(scaled.data.subarray(srcStart, srcStart + iw * 4), dstStart);
  }
  return { width: destW, height: destH, channels: 4, colorSpace: 'srgb', bitDepth: 8, data: out };
}
