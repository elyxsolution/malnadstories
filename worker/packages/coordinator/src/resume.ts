import type { Result } from '@workerv2/contracts';
import { ok } from '@workerv2/utils';
import type { RunId } from '@workerv2/control-plane';
import type { ExecutionGraph } from './graph.js';
import type { ExecutionState } from './execution-state.js';
import { initialExecutionState } from './execution-state.js';
import type { JournalEntry } from './journal.js';
import { applyJournalEntry } from './journal.js';
import type { CoordinatorError } from './errors.js';

/**
 * The RESUME MODEL — rebuild the exact execution state of an interrupted run by re-folding its
 * persisted journal (INV-7: crash recovery with no side-effect drift). Because the journal is
 * the single source of state change and `applyJournalEntry` is a pure, total, VALIDATING fold,
 * replaying the same entries reconstructs a byte-identical state, and a corrupt/tampered
 * journal (out-of-order seq, illegal transition, unknown node) is rejected instead of yielding
 * a nonsense state. The coordinator loads no persistence itself — a caller supplies the journal
 * it stored.
 */
export function resumeFromJournal(
  graph: ExecutionGraph,
  runId: RunId,
  journal: readonly JournalEntry[],
): Result<ExecutionState, CoordinatorError> {
  let state = initialExecutionState(graph, runId);
  for (const entry of journal) {
    const next = applyJournalEntry(graph, state, entry);
    if (!next.ok) return next;
    state = next.value;
  }
  return ok(state);
}

/** Whether a run can still be driven (not yet in a terminal lifecycle state). Pure. */
export function isResumable(state: ExecutionState): boolean {
  return state.status === 'pending' || state.status === 'running';
}
