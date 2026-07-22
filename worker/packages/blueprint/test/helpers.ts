import type { Result } from '@workerv2/contracts';
import type { Blueprint, BlueprintSource, CompiledBlueprint } from '@workerv2/blueprint';
import { compileBlueprint } from '@workerv2/blueprint';

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
): { x: number; y: number; w: number; h: number } => ({
  x,
  y,
  w,
  h,
});

/** A small, realistic source: cover (1 photo + title text) + 2 spreads. */
export function sampleSource(overrides: Partial<BlueprintSource> = {}): BlueprintSource {
  return {
    albumId: 'alb-1',
    title: 'Goa 2026',
    cover: {
      placements: [{ slot: 'hero', artifact: 'sha256:c0ffee', frame: rect(0, 0, 1, 1) }],
      texts: [{ content: 'Goa 2026', frame: rect(0.1, 0.8, 0.8, 0.1) }],
    },
    spreads: [
      {
        pages: 1,
        placements: [
          { slot: 'main', artifact: 'sha256:aa11', frame: rect(0, 0, 1, 1) },
          { slot: 'inset', artifact: 'sha256:bb22', frame: rect(0.6, 0.6, 0.3, 0.3) },
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

export function compiled(overrides: Partial<BlueprintSource> = {}): CompiledBlueprint {
  return unwrap(compileBlueprint(sampleSource(overrides)));
}

export function sampleBlueprint(overrides: Partial<BlueprintSource> = {}): Blueprint {
  return compiled(overrides).blueprint;
}

/** A structural (unfrozen, plain) clone of a blueprint for invariant-violation tests. */
export function mutableClone(blueprint: Blueprint): Record<string, unknown> {
  return JSON.parse(JSON.stringify(blueprint)) as Record<string, unknown>;
}
