import { PersistenceError } from '@workerv2/infra-contracts';
import type {
  AlbumRepository,
  AssetRepository,
  RunRepository,
  AlbumRecord,
  AssetRecord,
  RunRecord,
} from '@workerv2/infra-contracts';
import {
  albumToRecord,
  recordToAlbum,
  assetToRecord,
  recordToAsset,
  runToRecord,
  recordToRun,
} from '@workerv2/infra-contracts';
import type { Album, Asset, Run, AlbumId, AssetId, RunId } from '@workerv2/control-plane';
import type { TableTransaction } from './store/table-transaction.js';

/**
 * Transaction-bound repositories. Each maps DOMAIN ↔ record via the explicit mappers and reads
 * through the domain reconstitution path — so a corrupt record surfaces as a `PersistenceError`
 * (never a malformed aggregate), DTOs never escape, and no aggregate invariant can be bypassed.
 * Repositories hold NO business logic — only map + stage.
 */
export class TransactionalAlbumRepository implements AlbumRepository {
  constructor(private readonly tx: TableTransaction<AlbumRecord>) {}

  async findById(id: AlbumId): Promise<Album | null> {
    const record = this.tx.read(id);
    if (record === undefined) return null;
    const domain = recordToAlbum(record);
    if (!domain.ok) throw new PersistenceError('Corrupt album record', { cause: domain.error });
    return domain.value;
  }
  async exists(id: AlbumId): Promise<boolean> {
    return this.tx.has(id);
  }
  async save(aggregate: Album): Promise<void> {
    this.tx.stagePut(aggregate.id, albumToRecord(aggregate));
  }
  async delete(id: AlbumId): Promise<void> {
    this.tx.stageDelete(id);
  }
}

export class TransactionalAssetRepository implements AssetRepository {
  constructor(private readonly tx: TableTransaction<AssetRecord>) {}

  async findById(id: AssetId): Promise<Asset | null> {
    const record = this.tx.read(id);
    if (record === undefined) return null;
    const domain = recordToAsset(record);
    if (!domain.ok) throw new PersistenceError('Corrupt asset record', { cause: domain.error });
    return domain.value;
  }
  async exists(id: AssetId): Promise<boolean> {
    return this.tx.has(id);
  }
  async save(aggregate: Asset): Promise<void> {
    this.tx.stagePut(aggregate.id, assetToRecord(aggregate));
  }
  async delete(id: AssetId): Promise<void> {
    this.tx.stageDelete(id);
  }
}

export class TransactionalRunRepository implements RunRepository {
  constructor(private readonly tx: TableTransaction<RunRecord>) {}

  async findById(id: RunId): Promise<Run | null> {
    const record = this.tx.read(id);
    if (record === undefined) return null;
    const domain = recordToRun(record);
    if (!domain.ok) throw new PersistenceError('Corrupt run record', { cause: domain.error });
    return domain.value;
  }
  async exists(id: RunId): Promise<boolean> {
    return this.tx.has(id);
  }
  async save(aggregate: Run): Promise<void> {
    this.tx.stagePut(aggregate.id, runToRecord(aggregate));
  }
  async delete(id: RunId): Promise<void> {
    this.tx.stageDelete(id);
  }
  /** Records for an album — the read side of the run registry (INV-6). */
  recordsForAlbum(albumId: string): RunRecord[] {
    return this.tx.allRecords().filter((r) => r.albumId === albumId);
  }
}
