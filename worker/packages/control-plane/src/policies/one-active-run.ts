import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { PolicyViolationError } from '../errors.js';
import type { RunState } from '../lifecycle/run.js';
import { isActiveRunState } from '../lifecycle/run.js';

/**
 * INV-6 — at most one active run per album. A pure policy over the states of an album's
 * existing runs: starting a new run is permitted only when none are active (pending/running).
 * The domain expresses the rule; the runtime enforces serialization against real state later.
 */
export function canStartRun(
  existingRunStates: readonly RunState[],
): Result<void, PolicyViolationError> {
  const activeCount = existingRunStates.filter(isActiveRunState).length;
  if (activeCount > 0) {
    return err(
      new PolicyViolationError(
        'An active run already exists for this album (INV-6: one active run per album)',
        { context: { activeCount } },
      ),
    );
  }
  return ok(undefined);
}
