import { InMemoryRecordTable } from './record-table.js';
import type {
  AlbumRecord,
  AssetRecord,
  RunRecord,
  AuditRecordDto,
  StoredArtifact,
} from '@workerv2/infra-contracts';

/**
 * The in-memory "database": the set of storage tables plus the append-only audit log, the
 * active-run index (durable INV-6 guard), and the write-once artifact-metadata index. Concrete
 * storage lives here; nothing above it knows it is in-memory.
 */
export class Database {
  readonly albums = new InMemoryRecordTable<AlbumRecord>();
  readonly assets = new InMemoryRecordTable<AssetRecord>();
  readonly runs = new InMemoryRecordTable<RunRecord>();
  readonly audit: AuditRecordDto[] = [];
  /** albumId → active runId (at most one active run per album). */
  readonly activeRuns = new Map<string, string>();
  /** content-addressed key → artifact metadata (write-once). */
  readonly artifacts = new Map<string, StoredArtifact>();
}
