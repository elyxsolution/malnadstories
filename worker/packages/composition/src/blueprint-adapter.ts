// BLUEPRINT ADAPTER — map a Blueprint SURFACE (cover or spread) + its resolved image rasters into
// a `LayerStack` the compositor rasterizes. This is the only place blueprint data is read: each
// placement becomes an image layer whose destination is its normalized frame projected onto the
// pixel canvas, and whose z-index is its order within the surface (deterministic — the blueprint
// canonicalizes placement order). Text nodes are NOT rasterized here (glyph rendering needs a font
// engine — a separate concern); they are ignored by the compositor. Compositing attributes the
// blueprint does not carry (background, fit, frame, opacity) come from deterministic options.

import type { StorageKey } from '@workerv2/infra-contracts';
import type { RasterImage } from '@workerv2/image-backend';
import type {
  Blueprint,
  BlueprintNode,
  BlueprintNodeId,
  BlueprintRect,
  PlacementNode,
} from '@workerv2/blueprint';
import { nodeById } from '@workerv2/blueprint';
import type {
  FitMode,
  FrameSpec,
  Layer,
  LayerStack,
  PageRenderTarget,
  PixelRect,
  Rgba,
} from './model.js';
import { WHITE } from './color.js';
import { CompositionError } from './errors.js';

/** Deterministic options for projecting a surface onto pixels (not blueprint data). */
export interface SurfaceCompositionOptions {
  /** Page background fill (default: opaque white). */
  readonly background?: Rgba;
  /** How each placement's image fits its frame (default: `cover`). */
  readonly fit?: FitMode;
  /** Optional frame border drawn around every placement. */
  readonly frame?: FrameSpec;
  /** Per-placement opacity (default: 1). */
  readonly opacity?: number;
}

/** A surface node the compositor can render (has child placements). */
export type SurfaceNode = Extract<BlueprintNode, { kind: 'cover' | 'spread' }>;

/** Find a renderable surface (cover/spread) by id, or throw a `CompositionError`. */
export function findSurface(blueprint: Blueprint, surfaceId: string): SurfaceNode {
  const node = nodeById(blueprint, surfaceId as BlueprintNodeId);
  if (node === undefined)
    throw new CompositionError(`Surface "${surfaceId}" not found`, { surfaceId });
  if (node.kind !== 'cover' && node.kind !== 'spread') {
    throw new CompositionError(`Node "${surfaceId}" is not a renderable surface`, {
      surfaceId,
      kind: node.kind,
    });
  }
  return node;
}

/** The placement children of a surface, in the blueprint's canonical (deterministic) order. */
export function placementsOf(blueprint: Blueprint, surface: SurfaceNode): PlacementNode[] {
  const placements: PlacementNode[] = [];
  for (const childId of surface.children) {
    const child = nodeById(blueprint, childId);
    if (child !== undefined && child.kind === 'placement') placements.push(child);
  }
  return placements;
}

/** Project a normalized blueprint rect onto the pixel canvas (deterministic rounding). */
export function rectToPixels(rect: BlueprintRect, target: PageRenderTarget): PixelRect {
  const x = Math.round(rect.x * target.width);
  const y = Math.round(rect.y * target.height);
  const width = Math.max(1, Math.round(rect.w * target.width));
  const height = Math.max(1, Math.round(rect.h * target.height));
  return { x, y, width, height };
}

/**
 * Build a `LayerStack` for a surface. `resolved` maps each placement's artifact identity to its
 * decoded raster; a missing entry is a `CompositionError` (the engine resolves these before
 * calling this pure function).
 */
export function surfaceToLayerStack(
  blueprint: Blueprint,
  surface: SurfaceNode,
  target: PageRenderTarget,
  resolved: ReadonlyMap<StorageKey, RasterImage>,
  options: SurfaceCompositionOptions = {},
): LayerStack {
  const fit = options.fit ?? 'cover';
  const opacity = options.opacity ?? 1;
  const layers: Layer[] = placementsOf(blueprint, surface).map((placement, index) => {
    const raster = resolved.get(placement.artifact);
    if (raster === undefined) {
      throw new CompositionError(`Unresolved artifact for placement "${placement.slot}"`, {
        slot: placement.slot,
        artifact: placement.artifact,
      });
    }
    const dest = rectToPixels(placement.frame, target);
    const layer: Layer = {
      raster,
      dest,
      z: index,
      opacity,
      blend: 'normal',
      fit,
      clip: dest,
      ...(options.frame === undefined ? {} : { frame: options.frame }),
    };
    return layer;
  });

  return {
    width: target.width,
    height: target.height,
    background: options.background ?? WHITE,
    layers,
  };
}

/** The distinct artifact identities a surface references (for the engine to resolve). */
export function surfaceArtifacts(blueprint: Blueprint, surface: SurfaceNode): StorageKey[] {
  const seen = new Set<StorageKey>();
  for (const placement of placementsOf(blueprint, surface)) seen.add(placement.artifact);
  return [...seen];
}
