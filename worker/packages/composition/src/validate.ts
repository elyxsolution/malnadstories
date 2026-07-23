// COMPOSITION VALIDATION — two gates. `validateLayerStack` checks a stack is well-formed BEFORE
// rasterizing (positive canvas, legal fit/blend/opacity, sane layer geometry). `validateComposedPage`
// checks the rendered raster BEFORE it is produced as an Artifact (matches the target, is RGBA, and
// its byte length is consistent). An invalid page is never produced.

import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import type { ImageBackend, RasterImage } from '@workerv2/image-backend';
import { BLEND_MODES, FIT_MODES } from './model.js';
import type { LayerStack, PageRenderTarget } from './model.js';

/** Validate a layer stack before rasterization. */
export function validateLayerStack(stack: LayerStack): Result<void, string> {
  if (!isPositiveInt(stack.width) || !isPositiveInt(stack.height)) {
    return err('layer stack canvas must have positive integer dimensions');
  }
  for (let i = 0; i < stack.layers.length; i += 1) {
    const layer = stack.layers[i];
    if (layer === undefined) continue;
    const where = `layer ${i}`;
    if (!FIT_MODES.includes(layer.fit)) return err(`${where}: unknown fit mode`);
    if (!BLEND_MODES.includes(layer.blend)) return err(`${where}: unknown blend mode`);
    if (!(layer.opacity >= 0 && layer.opacity <= 1))
      return err(`${where}: opacity must be in [0,1]`);
    if (!isPositiveInt(layer.dest.width) || !isPositiveInt(layer.dest.height)) {
      return err(`${where}: destination must have positive integer size`);
    }
    if (!Number.isInteger(layer.dest.x) || !Number.isInteger(layer.dest.y)) {
      return err(`${where}: destination position must be integer pixels`);
    }
  }
  return ok(undefined);
}

/** Validate a rendered page raster against its target, using the backend's raster gate too. */
export function validateComposedPage(
  backend: ImageBackend,
  page: RasterImage,
  target: PageRenderTarget,
): Result<void, string> {
  if (page.width !== target.width || page.height !== target.height) {
    return err('rendered page dimensions do not match the render target');
  }
  if (page.channels !== 4) return err('rendered page must be RGBA (4 channels)');
  const rasterCheck = backend.validate(page);
  if (!rasterCheck.ok)
    return err(`rendered page failed raster validation: ${rasterCheck.error.message}`);
  return ok(undefined);
}

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
