// @workerv2/composition — the compositor MODEL. The `LayerStack` is the framework-independent,
// deterministic description of a page to rasterize: a background fill plus an ordered set of image
// layers, each with a destination rectangle, z-index, opacity, blend mode, and optional
// transform / mask / clip / frame. Everything here is DATA + geometry over the image-backend's
// `RasterImage`; no PDF, no album packaging, no vendor logic, no storage.

import type { RasterImage, RotateDegrees } from '@workerv2/image-backend';

/** An 8-bit RGBA colour (each component 0..255). Used for fills and frame borders. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** An integer pixel rectangle on the page canvas. */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The minimal blend modes the compositor supports (deterministic per-channel math). */
export type BlendMode = 'normal' | 'multiply' | 'screen';

export const BLEND_MODES: readonly BlendMode[] = ['normal', 'multiply', 'screen'];

/** How a source raster maps into its destination rectangle. */
export type FitMode = 'fill' | 'contain' | 'cover';

export const FIT_MODES: readonly FitMode[] = ['fill', 'contain', 'cover'];

/** A frame (border) drawn around a layer's destination rectangle. */
export interface FrameSpec {
  /** Border thickness in pixels (drawn inward from the destination edges). */
  readonly thickness: number;
  readonly color: Rgba;
}

/**
 * One COMPOSITING LAYER — a source raster placed into `dest` on the page canvas, with an optional
 * orthogonal rotation, a fit mode, opacity, blend mode, an optional grayscale mask, an optional
 * clip rectangle, and an optional frame border. Pure description; the compositor interprets it.
 */
export interface Layer {
  readonly raster: RasterImage;
  readonly dest: PixelRect;
  /** Stable stacking order (lower drawn first). Ties keep input order (stable sort). */
  readonly z: number;
  /** 0..1 layer opacity, multiplied into every source pixel's alpha. */
  readonly opacity: number;
  readonly blend: BlendMode;
  readonly fit: FitMode;
  /** Optional orthogonal rotation applied to the source before it is fit into `dest`. */
  readonly rotate?: RotateDegrees;
  /** Optional grayscale (1-channel) mask; resized to the fitted layer and used as per-pixel alpha. */
  readonly mask?: RasterImage;
  /** Optional clip: drawing is restricted to this rectangle (intersected with the canvas). */
  readonly clip?: PixelRect;
  /** Optional frame border drawn around `dest` after the image is composited. */
  readonly frame?: FrameSpec;
}

/**
 * The LAYER STACK — a complete, deterministic description of a page to rasterize: the pixel canvas
 * size, a background fill, and the layers to composite (in any order; the compositor sorts by z).
 */
export interface LayerStack {
  readonly width: number;
  readonly height: number;
  readonly background: Rgba;
  readonly layers: readonly Layer[];
}

/** The pixel dimensions to rasterize a page at (a deterministic render parameter). */
export interface PageRenderTarget {
  readonly width: number;
  readonly height: number;
}

// --- Produced page descriptor ---

export const PAGE_DESCRIPTOR_SCHEMA = 'workerv2.composition.page/1';

/** A JSON-safe, content-addressable summary of a rendered page Artifact. */
export interface PageDescriptor {
  readonly schema: typeof PAGE_DESCRIPTOR_SCHEMA;
  readonly surfaceId: string;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly layerCount: number;
  readonly byteLength: number;
  readonly backend: string;
  readonly backendVersion: string;
}
