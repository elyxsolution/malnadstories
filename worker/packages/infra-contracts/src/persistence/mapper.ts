import type { Result } from '@workerv2/contracts';
import type { ValidationError } from '@workerv2/errors';
import type { Album, Asset, Run, AuditRecord } from '@workerv2/control-plane';
import type { AlbumRecord, AssetRecord, RunRecord, AuditRecordDto } from './dto.js';

/**
 * The bidirectional mapping contract between a domain object and its persistence record — the
 * ANTI-CORRUPTION LAYER. `toRecord` serializes a domain object for storage; `toDomain`
 * reconstitutes a domain object from a record (validating on the way in). Repositories return
 * DOMAIN objects via a mapper — they never expose persistence models.
 *
 * The inbound half (`toDomain`) requires a domain reconstitution path and is realized by concrete
 * mappers alongside the adapters (a later phase); this package provides the contract plus concrete
 * OUTBOUND mappers below.
 */
export interface RecordMapper<TDomain, TRecord> {
  toRecord(domain: TDomain): TRecord;
  toDomain(record: TRecord): Result<TDomain, ValidationError>;
}

export type AlbumRecordMapper = RecordMapper<Album, AlbumRecord>;
export type AssetRecordMapper = RecordMapper<Asset, AssetRecord>;
export type RunRecordMapper = RecordMapper<Run, RunRecord>;
export type AuditRecordMapper = RecordMapper<AuditRecord, AuditRecordDto>;

// --- Concrete outbound mappers (domain → persistence). Pure, deterministic, no I/O. ---

export function albumToRecord(album: Album): AlbumRecord {
  return {
    id: album.id,
    title: album.title,
    status: album.status,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
  };
}

export function assetToRecord(asset: Asset): AssetRecord {
  return {
    id: asset.id,
    albumId: asset.albumId,
    status: asset.status,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

export function runToRecord(run: Run): RunRecord {
  return {
    id: run.id,
    albumId: run.albumId,
    status: run.status,
    versions: run.versions.toJSON(),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function auditToRecord(record: AuditRecord): AuditRecordDto {
  return {
    id: record.id,
    occurredAt: record.occurredAt,
    actorId: record.actor.id,
    actorKind: record.actor.kind,
    entityType: record.entityType,
    entityId: record.entityId,
    action: record.action,
    ...(record.fromState !== undefined ? { fromState: record.fromState } : {}),
    ...(record.toState !== undefined ? { toState: record.toState } : {}),
    ...(record.metadata !== undefined ? { metadata: record.metadata } : {}),
  };
}
