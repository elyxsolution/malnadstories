import { compileBlueprint } from '@workerv2/blueprint';
import type { Blueprint } from '@workerv2/blueprint';
import { solidRaster } from '@workerv2/image-backend';
import type { WorkerHost } from '@workerv2/worker-host';

/**
 * Seed page-source images into a host's store and build a small album blueprint referencing them:
 * a cover + `spreads` single-page spreads, each with one full-frame placement. The blueprint's
 * placement artifact keys are the seeded (content-addressed) image keys.
 */
export function seedAlbumBlueprint(host: WorkerHost, spreads = 1): Blueprint {
  const cover = host.seedRasterArtifact(solidRaster(16, 16, [200, 40, 40]));
  const spreadPlacements = [];
  for (let i = 0; i < spreads; i += 1) {
    const color: [number, number, number] = [40 + i * 20, 200 - i * 10, 40 + i * 30];
    const key = host.seedRasterArtifact(solidRaster(16, 16, color));
    spreadPlacements.push({
      pages: 1 as const,
      placements: [{ slot: 'main', artifact: key, frame: { x: 0, y: 0, w: 1, h: 1 } }],
    });
  }

  const compiled = compileBlueprint({
    albumId: 'album-1',
    title: 'Integration Album',
    cover: { placements: [{ slot: 'main', artifact: cover, frame: { x: 0, y: 0, w: 1, h: 1 } }] },
    spreads: spreadPlacements,
  });
  if (!compiled.ok) throw new Error(`blueprint compile failed: ${compiled.error.message}`);
  return compiled.value.blueprint;
}

/** Latin-1 decode for inspecting PDF bytes. */
export function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}
