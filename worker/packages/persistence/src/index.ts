// @workerv2/persistence — the concrete in-memory State Store / persistence engine implementing
// the Phase 3 infrastructure contracts. Storage-engine-agnostic (the storage primitive is
// isolated); a durable backend implements the same contracts later. No business logic.

export { ConcurrencyError } from './errors.js';

// --- Storage primitive (isolated from persistence models) ---
export type { VersionedRecord, RecordTable } from './store/record-table.js';
export { InMemoryRecordTable } from './store/record-table.js';
export { TableTransaction } from './store/table-transaction.js';
export { Database } from './store/database.js';

// --- Repositories (transaction-bound) ---
export {
  TransactionalAlbumRepository,
  TransactionalAssetRepository,
  TransactionalRunRepository,
} from './repositories.js';

// --- Unit of Work + Run Registry ---
export { InMemoryUnitOfWork } from './unit-of-work.js';
export { RunRegistry } from './run-registry.js';

// --- Infrastructure validation ---
export {
  validateAlbumRecord,
  validateAssetRecord,
  validateRunRecord,
  albumRecordValidator,
  assetRecordValidator,
  runRecordValidator,
} from './validation.js';

// --- State Store (engine facade) ---
export { StateStore } from './state-store.js';
