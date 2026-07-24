/**
 * DATABASE ADAPTER CONTRACT — the worker's clean, business-logic-free seam onto Supabase Postgres.
 *
 * It exposes only generic primitives: parameterized `query`, real `transaction`s, a `healthCheck`, and
 * connection lifecycle (`connect`/`close`). It knows NOTHING about photos, albums, orders, or any
 * table — those belong to future processors, which will build repositories ON TOP of this seam. Keeping
 * the adapter table-agnostic is what lets it be injected, faked, and reasoned about in isolation.
 *
 * Access is service-role: the worker connects over the DIRECT (session) connection, which is the only
 * transport that supports real transactions (the transaction pooler cannot). RLS-bypass semantics come
 * from that privileged connection — the adapter itself adds no authorization logic.
 */

/** A transaction scope — the subset of operations valid inside `transaction`. */
export interface DatabaseTransaction {
  /** Run a parameterized query within the transaction. */
  query<T = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<readonly T[]>;
}

export type DatabaseHealth = 'healthy' | 'unhealthy';

/** The database seam a concrete backend (Supabase Postgres) implements. */
export interface DatabaseAdapter {
  /** Open the connection pool and verify connectivity. Idempotent. */
  connect(): Promise<void>;
  /** Run a parameterized query and return the rows. */
  query<T = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<readonly T[]>;
  /** Run `fn` inside a single transaction; commit on resolve, roll back on reject. */
  transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
  /** Report connectivity with a cheap round-trip (`select 1`). */
  healthCheck(): Promise<DatabaseHealth>;
  /** Drain and close the connection pool. Idempotent. */
  close(): Promise<void>;
}
