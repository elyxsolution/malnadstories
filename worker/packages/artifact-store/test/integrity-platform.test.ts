import { describe, expect, it } from 'vitest';
import {
  ArtifactPlatform,
  InMemoryBlobStore,
  Sha256ContentAddressing,
  Sha256IntegrityVerifier,
  describeArtifact,
} from '@workerv2/artifact-store';
import { IntegrityError } from '@workerv2/infra-contracts';
import type { StorageAdapter } from '@workerv2/infra-contracts';
import { bytes, provenance } from './helpers.js';

describe('integrity verification', () => {
  const verifier = new Sha256IntegrityVerifier();
  const addressing = new Sha256ContentAddressing();

  it('passes bytes that hash to the expected address', () => {
    const data = bytes(1, 2, 3);
    expect(verifier.verify(data, addressing.address(data)).ok).toBe(true);
  });

  it('fails bytes that do not hash to the expected address', () => {
    const result = verifier.verify(bytes(1, 2, 3), addressing.address(bytes(9)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(IntegrityError);
  });
});

describe('ArtifactPlatform (assembled StorageAdapter + registry + integrity)', () => {
  it('implements the Phase-3 StorageAdapter seam', () => {
    const platform: StorageAdapter = new ArtifactPlatform();
    expect(platform.artifacts).toBeDefined();
    expect(platform.addressing).toBeDefined();
  });

  it('end-to-end: produce → store → register → verify → query lineage', async () => {
    const platform = new ArtifactPlatform(new InMemoryBlobStore());
    const data = bytes(11, 22, 33);
    const origin = provenance({ step: 'render', kind: 'document' });

    // 1. Describe (identity + provenance assembled from the bytes; time injected).
    const descriptor = describeArtifact(data, origin, 'application/pdf');

    // 2. Store the bytes under the content-derived key (write-once).
    const meta = await platform.artifacts.put(descriptor.key, data, 'application/pdf');
    expect(meta.sizeBytes).toBe(3);

    // 3. Register provenance metadata under the SAME identity.
    await platform.registry.register(descriptor);

    // 4. Read back + verify integrity.
    const read = await platform.artifacts.get(descriptor.key);
    expect(read).not.toBeNull();
    if (read !== null) expect(platform.integrity.verify(read, descriptor.key).ok).toBe(true);

    // 5. Lineage: the run's artifacts are queryable from the registry.
    const produced = await platform.registry.byRun(origin.runId);
    expect(produced.map((d) => d.key)).toStrictEqual([descriptor.key]);
    expect(produced[0]?.provenance.versions).toStrictEqual(origin.versions);
  });
});
