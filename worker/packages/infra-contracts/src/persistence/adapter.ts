import type { AlbumId, AssetId, RunId } from '@workerv2/control-plane';
import type { Album, Asset, Run } from '@workerv2/control-plane';
import type { TransactionManager } from './unit-of-work.js';
import type { RunStateQuery } from './repository.js';
import { repositoryToken } from './repository-factory.js';
import type { RepositoryToken } from './repository-factory.js';

/**
 * The top-level persistence seam a concrete backend (e.g. Postgres) implements. It exposes a
 * `TransactionManager` (the only way to obtain transactional repositories) and read-side queries
 * that do not require a transaction. No database-specific surface leaks through this contract.
 */
export interface PersistenceAdapter {
  readonly transactions: TransactionManager;
  readonly runStateQuery: RunStateQuery;
}

/** Well-known repository tokens for the domain aggregates (used with a `RepositoryFactory`). */
export const ALBUM_REPOSITORY: RepositoryToken<Album, AlbumId> = repositoryToken('album');
export const ASSET_REPOSITORY: RepositoryToken<Asset, AssetId> = repositoryToken('asset');
export const RUN_REPOSITORY: RepositoryToken<Run, RunId> = repositoryToken('run');
