'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { pageAspect, pairAspect, FALLBACK_DIMENSIONS, type ProductDimensions } from '@/lib/products/model';

/**
 * Builder-scoped dimensions context (Phase B).
 *
 * The SINGLE source of on-screen geometry for the whole builder tree — every page/pair/cover
 * container, crop-frame aspect, and QR/sticker square-ratio derives from here, so the builder
 * renders at the SAME proportions the print route (Phase A) prints at. No `3:4` / `3:2` / `6×8`
 * constants remain in the rendering components; they read `page` / `pair` from this context.
 *
 *   page = one physical page's aspect (width / height, e.g. A4 ≈ 0.7071)
 *   pair = the OPEN pair (two pages side by side) = 2 × page
 *
 * A sane default (FALLBACK_DIMENSIONS = the legacy 6×8in) means a component rendered outside a
 * provider never crashes — it just gets the legacy proportions, preserving old behaviour.
 */
export type BuilderDimensions = { dims: ProductDimensions; page: number; pair: number };

const DEFAULT: BuilderDimensions = {
  dims: FALLBACK_DIMENSIONS,
  page: pageAspect(FALLBACK_DIMENSIONS),
  pair: pairAspect(FALLBACK_DIMENSIONS),
};

const DimensionsContext = createContext<BuilderDimensions>(DEFAULT);

export function DimensionsProvider({
  dimensions,
  children,
}: {
  dimensions: ProductDimensions;
  children: ReactNode;
}) {
  const value = useMemo<BuilderDimensions>(
    () => ({ dims: dimensions, page: pageAspect(dimensions), pair: pairAspect(dimensions) }),
    [dimensions],
  );
  return <DimensionsContext.Provider value={value}>{children}</DimensionsContext.Provider>;
}

export function useBuilderDimensions(): BuilderDimensions {
  return useContext(DimensionsContext);
}
