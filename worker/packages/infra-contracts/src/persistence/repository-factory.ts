import type { Brand } from '@workerv2/contracts';
import type { Repository } from './repository.js';

/**
 * A typed handle identifying a repository, enabling GENERIC resolution (like a DI token). Keeps
 * the Unit of Work and factory agnostic of the concrete set of repositories, so new aggregate
 * repositories can be added without changing these contracts.
 */
export interface RepositoryToken<TAggregate, TId> {
  readonly name: string;
  /** Phantom — never present at runtime. */
  readonly __aggregate?: TAggregate;
  readonly __id?: TId;
}

/** Create a repository token. Identity is its `name`. */
export function repositoryToken<TAggregate, TId>(name: string): RepositoryToken<TAggregate, TId> {
  return { name };
}

/** A branded key alias for readability where a token identity is passed around as a string. */
export type RepositoryName = Brand<string, 'RepositoryName'>;

/** Resolves repositories by token. Concrete factories are provided by adapters. */
export interface RepositoryFactory {
  get<TAggregate, TId>(token: RepositoryToken<TAggregate, TId>): Repository<TAggregate, TId>;
}
