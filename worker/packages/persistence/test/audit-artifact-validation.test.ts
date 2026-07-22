import { describe, expect, it } from 'vitest';
import { StateStore, validateAlbumRecord, validateRunRecord } from '@workerv2/persistence';
import { StorageError } from '@workerv2/infra-contracts';
import type { StorageKey, StoredArtifact } from '@workerv2/infra-contracts';
import {
  recordTransition,
  makeAuditId,
  makeActorId,
  makeTimestamp,
  makeActor,
} from '@workerv2/control-plane';
import { unwrap } from './helpers.js';

const key = 'sha256:abc' as unknown as StorageKey;
const meta: StoredArtifact = { key, sizeBytes: 3, contentType: 'application/pdf' };

function auditRecord() {
  return recordTransition({
    id: unwrap(makeAuditId('aud-9')),
    occurredAt: unwrap(makeTimestamp('2026-07-22T00:00:00Z')),
    actor: makeActor(unwrap(makeActorId('sys')), 'system'),
    entityType: 'album',
    entityId: 'alb-1',
    action: 'album.building',
    fromState: 'draft',
    toState: 'building',
  });
}

describe('audit persistence (append-only, INV-9)', () => {
  it('appends audit records within a transaction', async () => {
    const store = new StateStore();
    await store.transaction(async (uow) => {
      await uow.audit.append(auditRecord());
    });
    const log = store.auditLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ id: 'aud-9', action: 'album.building', toState: 'building' });
  });

  it('does not persist audit on rollback', async () => {
    const store = new StateStore();
    await expect(
      store.transaction(async (uow) => {
        await uow.audit.append(auditRecord());
        throw new Error('boom');
      }),
    ).rejects.toThrow();
    expect(store.auditLog()).toHaveLength(0);
  });
});

describe('artifact metadata persistence (write-once, INV-2/INV-10)', () => {
  it('stores metadata and refuses to overwrite a key', async () => {
    const store = new StateStore();
    await store.transaction(async (uow) => uow.putArtifactMetadata(meta));
    expect(store.artifactMetadata(key)).toStrictEqual(meta);
    await expect(
      store.transaction(async (uow) => uow.putArtifactMetadata({ ...meta, sizeBytes: 9 })),
    ).rejects.toBeInstanceOf(StorageError);
    expect(store.artifactMetadata(key)?.sizeBytes).toBe(3);
  });
});

describe('infrastructure validation (unknown → DTO)', () => {
  it('accepts a well-formed record and rejects malformed input', () => {
    const good = validateAlbumRecord({
      id: 'a',
      title: 't',
      status: 'draft',
      createdAt: 'x',
      updatedAt: 'y',
    });
    expect(good.ok).toBe(true);
    expect(validateAlbumRecord({ id: 1 }).ok).toBe(false);
    expect(validateAlbumRecord(null).ok).toBe(false);
    expect(
      validateRunRecord({
        id: 'r',
        albumId: 'a',
        status: 's',
        versions: 'nope',
        createdAt: 'x',
        updatedAt: 'y',
      }).ok,
    ).toBe(false);
    expect(
      validateRunRecord({
        id: 'r',
        albumId: 'a',
        status: 's',
        versions: { workerRuntime: '1.0.0' },
        createdAt: 'x',
        updatedAt: 'y',
      }).ok,
    ).toBe(true);
  });
});
