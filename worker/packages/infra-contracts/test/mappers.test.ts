import { describe, expect, it } from 'vitest';
import {
  albumToRecord,
  assetToRecord,
  runToRecord,
  auditToRecord,
} from '@workerv2/infra-contracts';
import { sampleAlbum, sampleAsset, sampleRun, sampleAudit } from './helpers.js';

describe('outbound mappers (domain → persistence)', () => {
  it('albumToRecord flattens the aggregate to a DTO', () => {
    const record = albumToRecord(sampleAlbum());
    expect(record).toStrictEqual({
      id: 'alb-1',
      title: 'Goa Trip',
      status: 'draft',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    });
  });

  it('assetToRecord carries albumId + status', () => {
    expect(assetToRecord(sampleAsset())).toStrictEqual({
      id: 'ast-1',
      albumId: 'alb-1',
      status: 'incoming',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    });
  });

  it('runToRecord serializes the frozen version set', () => {
    expect(runToRecord(sampleRun())).toStrictEqual({
      id: 'run-1',
      albumId: 'alb-1',
      status: 'pending',
      versions: { workerRuntime: '1.0.0', manifest: '0.1.0' },
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    });
  });

  it('auditToRecord flattens actor + omits absent optionals', () => {
    expect(auditToRecord(sampleAudit())).toStrictEqual({
      id: 'aud-1',
      occurredAt: '2026-07-22T00:00:00.000Z',
      actorId: 'sys',
      actorKind: 'system',
      entityType: 'album',
      entityId: 'alb-1',
      action: 'album.building',
      fromState: 'draft',
      toState: 'building',
      metadata: { note: 'ok' },
    });
  });

  it('is a pure projection — the domain object is unaffected', () => {
    const album = sampleAlbum();
    albumToRecord(album);
    expect(album.status).toBe('draft');
    expect(Object.isFrozen(album)).toBe(true);
  });
});
