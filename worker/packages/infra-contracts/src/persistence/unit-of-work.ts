import type { RepositoryFactory } from './repository-factory.js';

/**
 * A transaction boundary — commit persists all work atomically; rollback discards it. Generic:
 * a concrete adapter maps this onto its native transaction (SQL tx, etc.).
 */
export interface Transaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  readonly active: boolean;
}

/**
 * A Unit of Work: a transactional scope that hands out repositories (via the generic factory)
 * and commits/rolls back all of them together. Kept generic so multiple persistence technologies
 * can implement it — it names no specific database and no specific repository set.
 */
export interface UnitOfWork extends RepositoryFactory, Transaction {}

/**
 * Runs work inside a Unit of Work, committing on success and rolling back if the work throws.
 * The single entry point through which callers obtain transactional persistence — they never
 * manage transactions by hand.
 */
export interface TransactionManager {
  withUnitOfWork<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}
