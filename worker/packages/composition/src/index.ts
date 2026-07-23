// @workerv2/composition — the Page Composition Engine. The deterministic compositor that transforms
// Blueprint surfaces + normalized image Artifacts into rendered, content-addressed page Artifacts:
// layer stack, transform application, masks, clipping, frames, background fills, z-ordering, the
// minimal blend modes, page rasterization, and composition validation. Pixel work runs through the
// replaceable `ImageBackend` (future GPU acceleration behind the same contract).
//
// Implements NO PDF generation, NO album packaging, NO vendor/printing logic; performs NO storage of
// its own (a host-wired byte port does); introduces no business logic. It composites layers and
// produces page rasters — nothing more.

// --- Model ---
export type {
  Rgba,
  PixelRect,
  BlendMode,
  FitMode,
  FrameSpec,
  Layer,
  LayerStack,
  PageRenderTarget,
  PageDescriptor,
} from './model.js';
export { BLEND_MODES, FIT_MODES, PAGE_DESCRIPTOR_SCHEMA } from './model.js';

// --- Colour / blend primitives ---
export { compositePixel, fillRgba, clampByte, WHITE, TRANSPARENT } from './color.js';

// --- Transform application (fit) ---
export { fitRaster, toRgba } from './fit.js';

// --- Canvas + compositor ---
export { Canvas } from './canvas.js';
export { rasterizeStack } from './compositor.js';

// --- Validation ---
export { validateLayerStack, validateComposedPage } from './validate.js';

// --- Blueprint adapter ---
export {
  findSurface,
  placementsOf,
  rectToPixels,
  surfaceToLayerStack,
  surfaceArtifacts,
} from './blueprint-adapter.js';
export type { SurfaceCompositionOptions, SurfaceNode } from './blueprint-adapter.js';

// --- Engine ---
export { CompositionEngine } from './engine.js';
export type { RenderedPage } from './engine.js';

// --- Errors ---
export { CompositionError } from './errors.js';
