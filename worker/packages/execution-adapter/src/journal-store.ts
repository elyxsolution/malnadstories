import type { RunId } from '@workerv2/control-plane';
import type { JournalEntry } from '@workerv2/coordinator';
import type { JournalStore } from './contracts.js';

/**
 * The reference JOURNAL PERSISTENCE — an in-memory, append-only `JournalStore`. It is a plain
 * byte-free record keeper with NO database, file, or network: exactly the seam a durable store
 * (SQL/KV) drops into later. The adapter persists through the interface only; it never knows
 * whether the backend is memory or Postgres.
 */
export class InMemoryJournalStore implements JournalStore {
  private readonly journals = new Map<string, JournalEntry[]>();

  async append(runId: RunId, entries: readonly JournalEntry[]): Promise<void> {
    const existing = this.journals.get(runId) ?? [];
    existing.push(...entries);
    this.journals.set(runId, existing);
    return Promise.resolve();
  }

  async load(runId: RunId): Promise<readonly JournalEntry[]> {
    return Promise.resolve([...(this.journals.get(runId) ?? [])]);
  }
}
