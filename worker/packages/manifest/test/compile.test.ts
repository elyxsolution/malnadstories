import { describe, expect, it } from 'vitest';
import { hashBlueprint } from '@workerv2/blueprint';
import { NO_RETRY, DEFAULT_CANCELLATION, DEFAULT_FAILURE_POLICY } from '@workerv2/processing';
import {
  compileManifest,
  attachTrace,
  nodeById,
  ASSEMBLE_NODE_ID,
  ASSEMBLE_ALBUM_PROCESSOR,
  RENDER_SURFACE_PROCESSOR,
  RENDER_CAPABILITY,
  ASSEMBLE_CAPABILITY,
  BLUEPRINT_INPUT,
  PAGE_OUTPUT,
  ALBUM_OUTPUT,
} from '@workerv2/manifest';
import { compiled, sampleBlueprint, unwrap, unwrapErr } from './helpers.js';

describe('compileManifest (the canonical translation)', () => {
  it('derives one render node per surface + one assemble node, with stable ids', () => {
    const manifest = compiled().manifest;
    expect(manifest.nodes.map((n) => n.id)).toEqual([
      'assemble:album',
      'render:cover',
      'render:spread:0000',
      'render:spread:0001',
    ]);
    expect(manifest.albumId).toBe('alb-1');
    expect(manifest.blueprint).toBe(hashBlueprint(sampleBlueprint()));
  });

  it("render nodes consume the blueprint artifact + that surface's placed images, and produce a page", () => {
    const manifest = compiled().manifest;
    const bpHash = hashBlueprint(sampleBlueprint());
    const spread0 = nodeById(manifest, 'render:spread:0000');
    expect(spread0?.processor).toBe(RENDER_SURFACE_PROCESSOR);
    expect(spread0?.consumes).toEqual({
      [BLUEPRINT_INPUT]: { kind: 'artifact', key: bpHash },
      'image:inset': { kind: 'artifact', key: 'sha256:bb22' },
      'image:main': { kind: 'artifact', key: 'sha256:aa11' },
    });
    expect(spread0?.produces).toEqual([PAGE_OUTPUT]);
    expect(spread0?.requires).toEqual([{ name: RENDER_CAPABILITY }]);
    expect(spread0?.config).toEqual({ surface: 'spread:0000', pages: 1 });
    expect(spread0?.dependsOn).toEqual([]);

    const cover = nodeById(manifest, 'render:cover');
    expect(cover?.config).toEqual({ surface: 'cover' });
    expect(cover?.consumes['image:hero']).toEqual({ kind: 'artifact', key: 'sha256:c0ffee' });
  });

  it('the assemble node consumes every page output in dependency-declared order', () => {
    const manifest = compiled().manifest;
    const assemble = nodeById(manifest, ASSEMBLE_NODE_ID);
    expect(assemble?.processor).toBe(ASSEMBLE_ALBUM_PROCESSOR);
    expect(assemble?.dependsOn).toEqual([
      'render:cover',
      'render:spread:0000',
      'render:spread:0001',
    ]);
    expect(assemble?.consumes['page:cover']).toEqual({
      kind: 'step-output',
      stepId: 'render:cover',
      output: PAGE_OUTPUT,
    });
    expect(assemble?.consumes['page:spread:0001']).toEqual({
      kind: 'step-output',
      stepId: 'render:spread:0001',
      output: PAGE_OUTPUT,
    });
    expect(assemble?.produces).toEqual([ALBUM_OUTPUT]);
    expect(assemble?.requires).toEqual([{ name: ASSEMBLE_CAPABILITY }]);
    // Semantic surface order is preserved in config (arrays keep order in canonical JSON).
    expect(assemble?.config).toEqual({ surfaces: ['cover', 'spread:0000', 'spread:0001'] });
  });

  it('is deterministic: recompiling the same blueprint yields the same identity', () => {
    const a = compiled();
    const b = compiled();
    expect(a.hash).toBe(b.hash);
    expect(a.canonical).toBe(b.canonical);
  });

  it('deep-freezes the compiled manifest', () => {
    const result = compiled();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.manifest)).toBe(true);
    expect(Object.isFrozen(result.manifest.nodes[0])).toBe(true);
    expect(() => {
      (result.manifest as { albumId: string }).albumId = 'x';
    }).toThrow();
  });

  it('a cover-less blueprint compiles without a render:cover node', () => {
    const source = { cover: undefined };
    const manifest = compiled(source).manifest;
    expect(manifest.nodes.map((n) => n.id)).toEqual([
      'assemble:album',
      'render:spread:0000',
      'render:spread:0001',
    ]);
    const assemble = nodeById(manifest, ASSEMBLE_NODE_ID);
    expect(assemble?.config).toEqual({ surfaces: ['spread:0000', 'spread:0001'] });
  });

  it('applies default declarative policies (no retry, cooperative cancellation)', () => {
    const node = nodeById(compiled().manifest, 'render:cover');
    expect(node?.retry).toEqual(NO_RETRY);
    expect(node?.cancellation).toEqual(DEFAULT_CANCELLATION);
    expect(node?.failure).toEqual(DEFAULT_FAILURE_POLICY);
    expect(node?.timeout).toBeUndefined();
  });

  it('accepts policy overrides — and rejects invalid ones through the gate', () => {
    const withPolicies = unwrap(
      compileManifest(sampleBlueprint(), {
        policies: {
          retry: { maxAttempts: 3, backoff: 'exponential', initialDelayMs: 500 },
          timeout: { attemptTimeoutMs: 60_000 },
        },
      }),
    );
    const node = nodeById(withPolicies.manifest, 'render:cover');
    expect(node?.retry.maxAttempts).toBe(3);
    expect(node?.timeout).toEqual({ attemptTimeoutMs: 60_000 });
    // Policy overrides change manifest content — and therefore identity.
    expect(withPolicies.hash).not.toBe(compiled().hash);

    const error = unwrapErr(
      compileManifest(sampleBlueprint(), {
        policies: { retry: { maxAttempts: 0, backoff: 'none', initialDelayMs: 0 } },
      }),
    );
    expect(error.message).toContain('maxAttempts');
  });
});

describe('traces (identity-neutral provenance)', () => {
  it('a trace rides on the wrapper without changing canonical form or hash', () => {
    const bare = compiled();
    const traced = unwrap(
      compileManifest(sampleBlueprint(), { trace: { resolvers: ['layout@1.0.0'] } }),
    );
    expect(traced.trace).toEqual({ resolvers: ['layout@1.0.0'] });
    expect(traced.hash).toBe(bare.hash);
    expect(traced.canonical).toBe(bare.canonical);
    // The canonical byte form never mentions the trace.
    expect(traced.canonical.includes('resolvers')).toBe(false);
  });

  it('attachTrace returns a new frozen wrapper with identity carried over unchanged', () => {
    const bare = compiled();
    const traced = attachTrace(bare, { note: 'attached later' });
    expect(traced).not.toBe(bare);
    expect(traced.trace).toEqual({ note: 'attached later' });
    expect(traced.hash).toBe(bare.hash);
    expect(traced.canonical).toBe(bare.canonical);
    expect(traced.manifest).toBe(bare.manifest);
    expect(Object.isFrozen(traced)).toBe(true);
    expect(bare.trace).toBeUndefined();
  });
});
