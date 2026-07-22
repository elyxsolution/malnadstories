import { ConcurrencyError } from '../errors.js';
import type { RecordTable } from './record-table.js';

/**
 * Per-table transactional staging with OPTIMISTIC concurrency. Reads record the version they saw
 * (identity map); writes are staged, not applied. At commit, `validate()` checks that every
 * touched row is still at the version it was read at (and that inserts don't collide), then
 * `apply()` writes atomically with the version incremented. This is the mechanism behind the
 * Unit of Work's all-or-nothing commit.
 */
export class TableTransaction<T> {
  private readonly loadedVersion = new Map<string, number>();
  private readonly puts = new Map<string, T>();
  private readonly deletes = new Set<string>();

  constructor(
    private readonly table: RecordTable<T>,
    private readonly label: string,
  ) {}

  /** Read the current record for `id` (read-your-writes), recording the version seen. */
  read(id: string): T | undefined {
    if (this.deletes.has(id)) return undefined;
    const staged = this.puts.get(id);
    if (staged !== undefined) return staged;
    const row = this.table.get(id);
    if (row === undefined) return undefined;
    if (!this.loadedVersion.has(id)) this.loadedVersion.set(id, row.version);
    return row.record;
  }

  has(id: string): boolean {
    return this.read(id) !== undefined;
  }

  stagePut(id: string, record: T): void {
    this.puts.set(id, record);
    this.deletes.delete(id);
  }

  stageDelete(id: string): void {
    // Record the version being deleted (so a stale delete is detected).
    this.read(id);
    this.deletes.add(id);
    this.puts.delete(id);
  }

  /** Live records merged with staged puts/deletes — for queries within the transaction. */
  allRecords(): T[] {
    const byId = new Map<string, T>();
    for (const [id, versioned] of this.table.entries()) byId.set(id, versioned.record);
    for (const id of this.deletes) byId.delete(id);
    for (const [id, record] of this.puts) byId.set(id, record);
    return [...byId.values()];
  }

  /** Optimistic validation. Throws `ConcurrencyError` if any staged change is stale/colliding. */
  validate(): void {
    for (const [id] of this.puts) {
      const live = this.table.get(id);
      const loaded = this.loadedVersion.get(id);
      if (loaded === undefined) {
        if (live !== undefined) {
          throw new ConcurrencyError(`Insert conflict on ${this.label} "${id}"`, {
            context: { table: this.label, id },
          });
        }
      } else if (live === undefined || live.version !== loaded) {
        throw new ConcurrencyError(`Stale ${this.label} "${id}" (optimistic lock failed)`, {
          context: { table: this.label, id, expected: loaded, actual: live?.version ?? null },
        });
      }
    }
    for (const id of this.deletes) {
      const live = this.table.get(id);
      const loaded = this.loadedVersion.get(id);
      if (live !== undefined && loaded !== undefined && live.version !== loaded) {
        throw new ConcurrencyError(`Stale delete of ${this.label} "${id}"`, {
          context: { table: this.label, id },
        });
      }
    }
  }

  /** Apply staged changes to the table (call only after `validate()` across all tables). */
  apply(): void {
    for (const [id, record] of this.puts) {
      const loaded = this.loadedVersion.get(id);
      this.table.set(id, { version: (loaded ?? 0) + 1, record });
    }
    for (const id of this.deletes) this.table.remove(id);
  }
}
