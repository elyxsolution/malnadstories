import type { Album, Asset, Run, AuditRecord } from '@workerv2/control-plane';
import type { AlbumId, AssetId, RunId } from '@workerv2/control-plane';

/**
 * A generic repository over an aggregate `TAggregate` keyed by `TId`. Repositories deal in
 * DOMAIN objects only (never DTOs) — mapping happens inside the concrete implementation. All
 * operations are async (a persistence boundary). Reconstituted objects are full domain aggregates.
 */
export interface Repository<TAggregate, TId> {
  findById(id: TId): Promise<TAggregate | null>;
  exists(id: TId): Promise<boolean>;
  /** Persist (insert or update) the aggregate's current state. */
  save(aggregate: TAggregate): Promise<void>;
  delete(id: TId): Promise<void>;
}

export type AlbumRepository = Repository<Album, AlbumId>;
export type AssetRepository = Repository<Asset, AssetId>;
export type RunRepository = Repository<Run, RunId>;

/**
 * Query the states of an album's runs — the read side of the one-active-run policy (INV-6). The
 * domain owns the RULE (`canStartRun`); this contract is how a concrete store supplies the data
 * the rule needs, without the domain touching persistence.
 */
export interface RunStateQuery {
  runStatesForAlbum(albumId: AlbumId): Promise<string[]>;
}

/**
 * Append-only audit sink (INV-9). Audit records are facts — this contract offers append only,
 * never update or delete.
 */
export interface AuditSink {
  append(record: AuditRecord): Promise<void>;
}
