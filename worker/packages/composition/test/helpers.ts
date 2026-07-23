import type { Result } from '@workerv2/contracts';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { RasterImage } from '@workerv2/image-backend';
import { InMemoryArtifactBytesStore, encodeRaster, solidRaster } from '@workerv2/image-backend';
import type { Blueprint, BlueprintRect, PlacementSource } from '@workerv2/blueprint';
import { compileBlueprint } from '@workerv2/blueprint';

export function unwrap<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`unwrap on Err: ${String(r.error)}`);
  return r.value;
}

/** Seed a raster into a byte store and return its content address (as a placement artifact key). */
export function seedRaster(store: InMemoryArtifactBytesStore, raster: RasterImage): StorageKey {
  return store.seed(encodeRaster(raster));
}

/** A content-address-shaped fake key (`mem:<hex>`) for adapter tests that don't touch a store. */
export function fakeKey(hex: string): StorageKey {
  return `mem:${hex}` as StorageKey;
}

/** A solid RGB raster of one colour. */
export function solid(width: number, height: number, rgb: [number, number, number]): RasterImage {
  return solidRaster(width, height, rgb);
}

export function rect(x: number, y: number, w: number, h: number): BlueprintRect {
  return { x, y, w, h };
}

/** Build a single-spread blueprint whose placements reference the given artifact keys. */
export function singleSpreadBlueprint(
  placements: readonly PlacementSource[],
  albumId = 'album-1',
): Blueprint {
  const compiled = unwrap(
    compileBlueprint({
      albumId,
      title: 'Test',
      spreads: [{ pages: 1, placements }],
    }),
  );
  return compiled.blueprint;
}

export { InMemoryArtifactBytesStore };
