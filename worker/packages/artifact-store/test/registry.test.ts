import { describe, expect, it } from 'vitest';
import { InMemoryArtifactRegistry, describeArtifact } from '@workerv2/artifact-store';
import { StorageError } from '@workerv2/infra-contracts';
import { makeRunId } from '@workerv2/control-plane';
import { bytes, provenance, unwrap } from './helpers.js';

describe('artifact registry (write-once provenance index)', () => {
  it('registers and reads back a descriptor by content address', async () => {
    const registry = new InMemoryArtifactRegistry();
    const descriptor = describeArtifact(bytes(1, 2, 3), provenance(), 'image/jpeg');
    await registry.register(descriptor);
    expect(await registry.has(descriptor.key)).toBe(true);
    expect(await registry.get(descriptor.key)).toStrictEqual(descriptor);
    expect(await registry.list()).toStrictEqual([descriptor]);
  });

  it('re-registering the identical descriptor is an idempotent no-op (INV-7)', async () => {
    const registry = new InMemoryArtifactRegistry();
    const descriptor = describeArtifact(bytes(1, 2, 3), provenance());
    await registry.register(descriptor);
    await expect(registry.register(descriptor)).resolves.toBeUndefined();
    expect((await registry.list()).length).toBe(1);
  });

  it('rejects a CONFLICTING re-registration for an existing key (write-once, INV-2)', async () => {
    const registry = new InMemoryArtifactRegistry();
    const descriptor = describeArtifact(bytes(1, 2, 3), provenance());
    await registry.register(descriptor);
    const conflicting = describeArtifact(bytes(1, 2, 3), provenance({ step: 'render' }));
    await expect(registry.register(conflicting)).rejects.toThrowError(StorageError);
    // Original untouched.
    expect(await registry.get(descriptor.key)).toStrictEqual(descriptor);
  });

  it('hands out deep-frozen descriptors (immutability)', async () => {
    const registry = new InMemoryArtifactRegistry();
    await registry.register(describeArtifact(bytes(9), provenance()));
    const [stored] = await registry.list();
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored?.provenance)).toBe(true);
    expect(Object.isFrozen(stored?.provenance.sourceAssetIds)).toBe(true);
  });

  it('queries lineage by run', async () => {
    const registry = new InMemoryArtifactRegistry();
    const run1 = provenance();
    const run2 = provenance({ runId: unwrap(makeRunId('run-2')) });
    const d1 = describeArtifact(bytes(1), run1);
    const d2 = describeArtifact(bytes(2), run2);
    const d3 = describeArtifact(bytes(3), run1);
    await registry.register(d1);
    await registry.register(d2);
    await registry.register(d3);
    expect(await registry.byRun(run1.runId)).toStrictEqual([d1, d3]);
    expect(await registry.byRun(run2.runId)).toStrictEqual([d2]);
    expect(await registry.byRun(unwrap(makeRunId('run-absent')))).toStrictEqual([]);
  });

  it('returns null/false for an unregistered key', async () => {
    const registry = new InMemoryArtifactRegistry();
    const descriptor = describeArtifact(bytes(1), provenance());
    expect(await registry.get(descriptor.key)).toBeNull();
    expect(await registry.has(descriptor.key)).toBe(false);
  });
});
