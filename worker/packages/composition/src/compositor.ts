// The COMPOSITOR — deterministically rasterize a `LayerStack` into a single RGBA page raster.
// Z-ordering (stable), transform application (orthogonal rotate + fit into the destination),
// masks, clipping, frames, background fill, and the minimal blend modes all resolve here. Pixel
// work (rotate/resize/crop/convert) runs through the replaceable `ImageBackend`, so a future GPU
// backend accelerates composition without any change here. Pure over its inputs: no I/O, no
// randomness, no ambient time.

import type { ImageBackend, RasterImage } from '@workerv2/image-backend';
import type { Layer, LayerStack } from './model.js';
import { Canvas } from './canvas.js';
import { fitRaster, toRgba } from './fit.js';

/** Rasterize a layer stack to an RGBA page raster (deterministic). */
export function rasterizeStack(backend: ImageBackend, stack: LayerStack): RasterImage {
  const canvas = new Canvas(stack.width, stack.height, stack.background);
  for (const layer of orderByZ(stack.layers)) {
    drawLayer(backend, canvas, layer);
  }
  return canvas.toRaster();
}

/** Stable sort by z (ties keep input order — determinism does not depend on the sort algorithm). */
function orderByZ(layers: readonly Layer[]): Layer[] {
  return layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => a.layer.z - b.layer.z || a.index - b.index)
    .map((entry) => entry.layer);
}

function drawLayer(backend: ImageBackend, canvas: Canvas, layer: Layer): void {
  const { dest } = layer;
  if (dest.width <= 0 || dest.height <= 0) return;

  // Transform: orthogonal rotate first (if any), then fit into the destination box.
  const rotated =
    layer.rotate === undefined
      ? layer.raster
      : backend.rotate(layer.raster, { op: 'rotate', degrees: layer.rotate });
  const fitted = fitRaster(backend, rotated, dest.width, dest.height, layer.fit);

  // Mask: resize to the fitted layer (grayscale), then sample as per-pixel alpha.
  const maskGray = layer.mask === undefined ? undefined : maskFor(backend, layer, dest);

  canvas.compositeLayer(fitted, dest.x, dest.y, layer.opacity, layer.blend, maskGray, layer.clip);

  if (layer.frame !== undefined) canvas.drawFrame(dest, layer.frame);
}

/** Resize a layer's mask to the fitted destination and return its grayscale bytes. */
function maskFor(backend: ImageBackend, layer: Layer, dest: Layer['dest']): Uint8Array {
  const mask = layer.mask as RasterImage;
  const gray =
    mask.channels === 1 ? mask : backend.convert(mask, { op: 'convert', colorSpace: 'gray' });
  const sized =
    gray.width === dest.width && gray.height === dest.height
      ? gray
      : backend.resize(gray, { op: 'resize', width: dest.width, height: dest.height });
  return sized.data;
}

export { toRgba };
