import type { Result } from '@workerv2/contracts';
import type { Blueprint, BlueprintSource } from '@workerv2/blueprint';
import { compileBlueprint } from '@workerv2/blueprint';
import type { CompiledManifest, Manifest } from '@workerv2/manifest';
import { compileManifest } from '@workerv2/manifest';

export function unwrap<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`unwrap() called on Err: ${String(r.error)}`);
  return r.value;
}

export function unwrapErr<E>(r: Result<unknown, E>): E {
  if (r.ok) throw new Error('unwrapErr() called on Ok');
  return r.error;
}

export const rect = (
  x = 0,
  y = 0,
  w = 1,
  h = 1,
): { x: number; y: number; w: number; h: number } => ({ x, y, w, h });

/** A small, realistic blueprint source: cover (photo + title) + 2 spreads. */
export function sampleSource(overrides: Partial<BlueprintSource> = {}): BlueprintSource {
  return {
    albumId: 'alb-1',
    title: 'Goa 2026',
    cover: {
      placements: [{ slot: 'hero', artifact: 'sha256:c0ffee', frame: rect() }],
      texts: [{ content: 'Goa 2026', frame: rect(0.1, 0.8, 0.8, 0.1) }],
    },
    spreads: [
      {
        pages: 1,
        placements: [
          { slot: 'inset', artifact: 'sha256:bb22', frame: rect(0.6, 0.6, 0.3, 0.3) },
          { slot: 'main', artifact: 'sha256:aa11', frame: rect() },
        ],
      },
      {
        pages: 2,
        placements: [{ slot: 'pano', artifact: 'sha256:dd44', frame: rect(0, 0.1, 1, 0.8) }],
        texts: [{ content: 'Sunset at Om Beach', frame: rect(0.3, 0.9, 0.4, 0.08) }],
      },
    ],
    ...overrides,
  };
}

export function sampleBlueprint(overrides: Partial<BlueprintSource> = {}): Blueprint {
  return unwrap(compileBlueprint(sampleSource(overrides))).blueprint;
}

export function compiled(overrides: Partial<BlueprintSource> = {}): CompiledManifest {
  return unwrap(compileManifest(sampleBlueprint(overrides)));
}

export function sampleManifest(overrides: Partial<BlueprintSource> = {}): Manifest {
  return compiled(overrides).manifest;
}

/** A structural (unfrozen, plain) clone for invariant-violation tests. */
export function mutableClone(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
