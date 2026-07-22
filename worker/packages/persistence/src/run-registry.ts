import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { RUN_REPOSITORY } from '@workerv2/infra-contracts';
import { canStartRun, PolicyViolationError } from '@workerv2/control-plane';
import type { Run, RunState, AlbumId } from '@workerv2/control-plane';
import type { Database } from './store/database.js';
import type { InMemoryUnitOfWork } from './unit-of-work.js';

/**
 * The Run Registry — the DURABLE enforcement of INV-6 (one active run per album). The domain owns
 * the RULE (`canStartRun`); this enforces it against persisted state: a pre-check within the
 * transaction, plus a commit-time active-run guard (so concurrent transactions cannot both start a
 * run for the same album). It performs no business orchestration — only reservation bookkeeping.
 */
export class RunRegistry {
  constructor(private readonly db: Database) {}

  /** The currently active run for an album, if any. */
  activeRunId(albumId: AlbumId): string | null {
    return this.db.activeRuns.get(albumId) ?? null;
  }

  /**
   * Reserve the album's single active-run slot and persist the run — atomically with the rest of
   * the unit of work. Returns a `PolicyViolationError` if a run is already active for the album.
   */
  async start(uow: InMemoryUnitOfWork, run: Run): Promise<Result<void, PolicyViolationError>> {
    const existingStates = uow.runsForAlbum(run.albumId).map((r) => r.status) as RunState[];
    const allowed = canStartRun(existingStates);
    if (!allowed.ok) return allowed;
    if (this.db.activeRuns.has(run.albumId)) {
      return err(
        new PolicyViolationError('An active run already exists for this album (INV-6)', {
          context: { albumId: run.albumId },
        }),
      );
    }
    await uow.get(RUN_REPOSITORY).save(run);
    uow.reserveActiveRun(run.albumId, run.id);
    return ok(undefined);
  }

  /** Release the album's active-run slot (call when the run reaches a terminal state). */
  finish(uow: InMemoryUnitOfWork, run: Run): void {
    uow.releaseActiveRun(run.albumId, run.id);
  }
}
