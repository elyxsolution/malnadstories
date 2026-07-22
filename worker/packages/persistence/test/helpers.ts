import type { Result } from '@workerv2/contracts';
import {
  Album,
  Run,
  VersionSet,
  makeAlbumId,
  makeRunId,
  makeActorId,
  makeEventId,
  makeAuditId,
  makeTimestamp,
  makeActor,
} from '@workerv2/control-plane';
import type { DomainContext } from '@workerv2/control-plane';

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

export function newAlbum(id = 'alb-1', title = 'Goa'): Album {
  return unwrap(Album.create({ id: unwrap(makeAlbumId(id)), title }, ctx())).aggregate;
}

export function newRun(id = 'run-1', albumId = 'alb-1'): Run {
  const versions = unwrap(VersionSet.create({ workerRuntime: '1.0.0' }));
  return Run.create(
    { id: unwrap(makeRunId(id)), albumId: unwrap(makeAlbumId(albumId)), versions },
    ctx(),
  ).aggregate;
}
