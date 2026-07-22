/**
 * The low-level STORAGE primitive — a versioned key/record table, generic over the record type
 * `T` and ignorant of any domain meaning. This is where "storage concerns" live, isolated from
 * the persistence models: a durable engine (SQL, KV) would provide its own `RecordTable` while
 * repositories, mappers, and the Unit of Work stay unchanged.
 */
export interface VersionedRecord<T> {
  readonly version: number;
  readonly record: T;
}

export interface RecordTable<T> {
  get(id: string): VersionedRecord<T> | undefined;
  has(id: string): boolean;
  entries(): Array<[string, VersionedRecord<T>]>;
  /** Low-level write used by transaction commit — not called directly by repositories. */
  set(id: string, versioned: VersionedRecord<T>): void;
  remove(id: string): void;
}

/** In-memory `RecordTable` backing the reference engine. */
export class InMemoryRecordTable<T> implements RecordTable<T> {
  private readonly rows = new Map<string, VersionedRecord<T>>();

  get(id: string): VersionedRecord<T> | undefined {
    return this.rows.get(id);
  }
  has(id: string): boolean {
    return this.rows.has(id);
  }
  entries(): Array<[string, VersionedRecord<T>]> {
    return [...this.rows.entries()];
  }
  set(id: string, versioned: VersionedRecord<T>): void {
    this.rows.set(id, versioned);
  }
  remove(id: string): void {
    this.rows.delete(id);
  }
}
