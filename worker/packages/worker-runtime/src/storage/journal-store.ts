import type { RunId } from '@workerv2/control-plane';
import type { JournalStore, EventSink } from '@workerv2/execution-adapter';
import type { JournalEntry } from '@workerv2/coordinator';
import type { ExecutionEvent } from '@workerv2/coordinator';
import type { StorageBackend } from './backend.js';

/**
 * The DURABLE JOURNAL STORE — persists the Coordinator's append-only execution journal per run over
 * a `StorageBackend`. Because the journal IS the state (state = fold of entries), persisting it
 * durably is what makes RESTART RECOVERY possible: a fresh runtime `load`s the journal and the
 * Coordinator re-folds it into the identical state (INV-7, driftless). Drop-in for the adapter's
 * in-memory `JournalStore`; the coordinator/adapter are unchanged.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function journalKey(runId: RunId): string {
  return `journal:${runId}`;
}

export class DurableJournalStore implements JournalStore {
  constructor(private readonly backend: StorageBackend) {}

  async append(runId: RunId, entries: readonly JournalEntry[]): Promise<void> {
    const existing = await this.load(runId);
    const merged = [...existing, ...entries];
    this.backend.put(journalKey(runId), encoder.encode(JSON.stringify(merged)));
  }

  async load(runId: RunId): Promise<readonly JournalEntry[]> {
    const bytes = this.backend.get(journalKey(runId));
    if (bytes === undefined) return [];
    return JSON.parse(decoder.decode(bytes)) as JournalEntry[];
  }
}

/**
 * PERSISTENT EVENT SINK — appends execution events to a durable per-run log for audit/observability.
 * Events are DERIVED from the journal (the journal remains the source of truth for recovery), so
 * this is purely observational; it never influences execution.
 */
function eventsKey(runId: string): string {
  return `events:${runId}`;
}

export class PersistentEventSink implements EventSink {
  constructor(private readonly backend: StorageBackend) {}

  publish(event: ExecutionEvent): void {
    const existing = this.loadEvents(event.runId);
    this.backend.put(eventsKey(event.runId), encoder.encode(JSON.stringify([...existing, event])));
  }

  /** Read the persisted event log for a run (observational). */
  loadEvents(runId: string): readonly ExecutionEvent[] {
    const bytes = this.backend.get(eventsKey(runId));
    if (bytes === undefined) return [];
    return JSON.parse(decoder.decode(bytes)) as ExecutionEvent[];
  }
}
