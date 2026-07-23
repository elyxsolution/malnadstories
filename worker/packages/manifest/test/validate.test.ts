import { describe, expect, it } from 'vitest';
import { validateManifest, serializeManifest, ManifestError } from '@workerv2/manifest';
import { mutableClone, sampleManifest, unwrap, unwrapErr } from './helpers.js';

type RawNode = Record<string, unknown>;

const valid = (): Record<string, unknown> => mutableClone(sampleManifest());
const nodesOf = (raw: Record<string, unknown>): RawNode[] => raw.nodes as RawNode[];

const rejects = (mutate: (raw: Record<string, unknown>) => void, fragment: string): void => {
  const input = valid();
  mutate(input);
  const error = unwrapErr(validateManifest(input));
  expect(error).toBeInstanceOf(ManifestError);
  expect(error.message).toContain(fragment);
};

describe('validateManifest (invariants M1–M11)', () => {
  it('accepts its own canonical output (gate is idempotent)', () => {
    const manifest = sampleManifest();
    const revalidated = unwrap(validateManifest(valid()));
    expect(serializeManifest(revalidated)).toBe(serializeManifest(manifest));
  });

  it('M1 rejects an unsupported schema version', () => {
    rejects((raw) => {
      raw.schemaVersion = '9.9.9';
    }, 'schema version');
  });

  it('M2 rejects an invalid album id', () => {
    rejects((raw) => {
      raw.albumId = '';
    }, 'albumId');
  });

  it('M3 rejects a malformed blueprint provenance hash', () => {
    rejects((raw) => {
      raw.blueprint = 'sha256:tooshort';
    }, 'content address');
    rejects((raw) => {
      raw.blueprint = 42;
    }, 'content address');
  });

  it('M4 rejects duplicate and unsorted node ids', () => {
    rejects((raw) => {
      const nodes = nodesOf(raw);
      const second = nodes[2];
      const first = nodes[1];
      if (second !== undefined && first !== undefined) second.id = first.id;
    }, 'Duplicate node id');
    rejects((raw) => {
      const nodes = nodesOf(raw);
      const a = nodes[1];
      const b = nodes[2];
      if (a !== undefined && b !== undefined) {
        nodes[1] = b;
        nodes[2] = a;
      }
    }, 'sorted by id');
    rejects((raw) => {
      raw.nodes = [];
    }, 'non-empty');
  });

  it('M5 rejects a bad processor, version range, and non-JSON config', () => {
    rejects((raw) => {
      const node = nodesOf(raw)[0];
      if (node !== undefined) node.processor = '  ';
    }, 'processor');
    rejects((raw) => {
      const node = nodesOf(raw)[0];
      if (node !== undefined) node.processorVersionRange = '';
    }, 'processorVersionRange');
    rejects((raw) => {
      const node = nodesOf(raw)[0];
      if (node !== undefined) node.config = { dpi: Number.NaN };
    }, 'finite');
  });

  it('M6 rejects self, unknown, and unsorted dependencies', () => {
    rejects((raw) => {
      const assemble = nodesOf(raw)[0];
      if (assemble !== undefined) assemble.dependsOn = ['assemble:album'];
    }, 'depends on itself');
    rejects((raw) => {
      const assemble = nodesOf(raw)[0];
      if (assemble !== undefined) assemble.dependsOn = ['render:zzz'];
    }, 'unknown node');
    rejects((raw) => {
      const assemble = nodesOf(raw)[0];
      if (assemble !== undefined) {
        assemble.dependsOn = ['render:spread:0000', 'render:cover', 'render:spread:0001'];
      }
    }, 'strictly ascending');
  });

  it('M7 rejects dangling/inconsistent artifact bindings', () => {
    rejects((raw) => {
      const assemble = nodesOf(raw)[0];
      const consumes = assemble?.consumes as Record<string, Record<string, unknown>>;
      const binding = consumes['page:cover'];
      if (binding !== undefined) binding.output = 'pages';
    }, 'undeclared output');
    rejects((raw) => {
      const assemble = nodesOf(raw)[0];
      if (assemble !== undefined) {
        assemble.dependsOn = ['render:spread:0000', 'render:spread:0001'];
      }
    }, 'does not declare it in dependsOn');
    rejects((raw) => {
      const render = nodesOf(raw)[1];
      const consumes = render?.consumes as Record<string, Record<string, unknown>>;
      const binding = consumes['blueprint'];
      if (binding !== undefined) binding.key = 'not a key';
    }, 'content address');
    rejects((raw) => {
      const render = nodesOf(raw)[1];
      const consumes = render?.consumes as Record<string, unknown>;
      consumes['bad slot'] = { kind: 'artifact', key: 'sha256:aa11' };
    }, 'slot name');
    rejects((raw) => {
      const render = nodesOf(raw)[1];
      const consumes = render?.consumes as Record<string, unknown>;
      consumes['x'] = { kind: 'magic' };
    }, 'binding kind');
  });

  it('M8 rejects empty and unsorted produced outputs', () => {
    rejects((raw) => {
      const render = nodesOf(raw)[1];
      if (render !== undefined) render.produces = [];
    }, 'non-empty');
    rejects((raw) => {
      const assemble = nodesOf(raw)[0];
      if (assemble !== undefined) assemble.produces = ['album', 'album'];
    }, 'strictly ascending');
  });

  it('M9 rejects invalid and unsorted capability requirements', () => {
    rejects((raw) => {
      const render = nodesOf(raw)[1];
      if (render !== undefined) render.requires = [{ name: '' }];
    }, 'invalid');
    rejects((raw) => {
      const render = nodesOf(raw)[1];
      if (render !== undefined) render.requires = [{ name: 'b' }, { name: 'a' }];
    }, 'strictly ascending');
  });

  it('M10 rejects invalid policies via the reused processing validators', () => {
    rejects((raw) => {
      const node = nodesOf(raw)[0];
      const retry = node?.retry as Record<string, unknown>;
      retry.backoff = 'sometimes';
    }, 'backoff');
    rejects((raw) => {
      const node = nodesOf(raw)[0];
      const retry = node?.retry as Record<string, unknown>;
      retry.maxAttempts = 0;
    }, 'maxAttempts');
    rejects((raw) => {
      const node = nodesOf(raw)[0];
      const cancellation = node?.cancellation as Record<string, unknown>;
      cancellation.mode = 'polite';
    }, 'cancellation mode');
    rejects((raw) => {
      const node = nodesOf(raw)[0];
      const failure = node?.failure as Record<string, unknown>;
      failure.onPermanent = 'retry';
    }, 'onPermanent');
    rejects((raw) => {
      const node = nodesOf(raw)[0];
      if (node !== undefined) node.timeout = { attemptTimeoutMs: 0 };
    }, 'attemptTimeoutMs');
  });

  it('M11 rejects a cyclic dependency graph', () => {
    const raw = valid();
    const policies = nodesOf(raw)[0];
    const template = {
      processor: 'x.y',
      consumes: {},
      produces: ['out'],
      requires: [],
      config: {},
      retry: policies?.retry,
      cancellation: policies?.cancellation,
      failure: policies?.failure,
    };
    raw.nodes = [
      { ...template, id: 'a', dependsOn: ['b'] },
      { ...template, id: 'b', dependsOn: ['a'] },
    ];
    expect(unwrapErr(validateManifest(raw)).message).toContain('cycle');
  });

  it('rejects non-object input', () => {
    expect(unwrapErr(validateManifest(null)).message).toContain('object');
    expect(unwrapErr(validateManifest([])).message).toContain('object');
  });
});
