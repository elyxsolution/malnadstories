import type { Result } from '@workerv2/contracts';
import {
  Album,
  Asset,
  Run,
  VersionSet,
  recordTransition,
  makeAlbumId,
  makeAssetId,
  makeRunId,
  makeActorId,
  makeEventId,
  makeAuditId,
  makeTimestamp,
  makeActor,
} from '@workerv2/control-plane';
import type { DomainContext, AuditRecord } from '@workerv2/control-plane';

export function unwrap<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`unwrap() called on Err: ${String(r.error)}`);
  return r.value;
}

export function ctx(occurredAt = '2026-07-22T00:00:00Z'): DomainContext {
  return {
    actor: makeActor(unwrap(makeActorId('sys')), 'system'),
    occurredAt: unwrap(makeTimestamp(occurredAt)),
    eventId: unwrap(makeEventId('evt-1')),
    auditId: unwrap(makeAuditId('aud-1')),
  };
}

export function sampleAlbum(): Album {
  return unwrap(Album.create({ id: unwrap(makeAlbumId('alb-1')), title: 'Goa Trip' }, ctx()))
    .aggregate;
}

export function sampleAsset(): Asset {
  return Asset.create(
    { id: unwrap(makeAssetId('ast-1')), albumId: unwrap(makeAlbumId('alb-1')) },
    ctx(),
  ).aggregate;
}

export function sampleRun(): Run {
  const versions = unwrap(VersionSet.create({ workerRuntime: '1.0.0', manifest: '0.1.0' }));
  return Run.create(
    { id: unwrap(makeRunId('run-1')), albumId: unwrap(makeAlbumId('alb-1')), versions },
    ctx(),
  ).aggregate;
}

export function sampleAudit(): AuditRecord {
  return recordTransition({
    id: unwrap(makeAuditId('aud-1')),
    occurredAt: unwrap(makeTimestamp('2026-07-22T00:00:00Z')),
    actor: makeActor(unwrap(makeActorId('sys')), 'system'),
    entityType: 'album',
    entityId: 'alb-1',
    action: 'album.building',
    fromState: 'draft',
    toState: 'building',
    metadata: { note: 'ok' },
  });
}
