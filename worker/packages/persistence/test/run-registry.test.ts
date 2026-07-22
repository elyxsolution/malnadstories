import { describe, expect, it } from 'vitest';
import { StateStore } from '@workerv2/persistence';
import { RUN_REPOSITORY } from '@workerv2/infra-contracts';
import { newRun, ctx, unwrap } from './helpers.js';

describe('RunRegistry — durable one-active-run (INV-6)', () => {
  it('enforces at most one active run per album and releases on completion', async () => {
    const store = new StateStore();
    const run1 = newRun('run-1', 'alb-1');
    const run2 = newRun('run-2', 'alb-1');

    // Start run1 for the album.
    const started = await store.transaction((uow) => store.runRegistry.start(uow, run1));
    expect(started.ok).toBe(true);
    expect(store.runRegistry.activeRunId(run1.albumId)).toBe('run-1');

    // A second run for the same album is refused while run1 is active.
    const blocked = await store.transaction((uow) => store.runRegistry.start(uow, run2));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('INVARIANT');

    // Complete run1 (pending → cancelled) and release the slot. Load-then-update so the
    // optimistic version is tracked (repositories require a prior load to update).
    await store.transaction(async (uow) => {
      const repo = uow.get(RUN_REPOSITORY);
      const loaded = await repo.findById(run1.id);
      if (loaded === null) throw new Error('run1 missing');
      const cancelled = unwrap(loaded.transition('cancel', ctx('2026-07-22T02:00:00Z'))).aggregate;
      await repo.save(cancelled);
      store.runRegistry.finish(uow, cancelled);
    });
    expect(store.runRegistry.activeRunId(run1.albumId)).toBeNull();

    // Now a new run can start for the album.
    const restarted = await store.transaction((uow) => store.runRegistry.start(uow, run2));
    expect(restarted.ok).toBe(true);
    expect(store.runRegistry.activeRunId(run2.albumId)).toBe('run-2');
  });

  it('allows concurrent runs for DIFFERENT albums', async () => {
    const store = new StateStore();
    const a = await store.transaction((uow) =>
      store.runRegistry.start(uow, newRun('r-a', 'album-a')),
    );
    const b = await store.transaction((uow) =>
      store.runRegistry.start(uow, newRun('r-b', 'album-b')),
    );
    expect(a.ok && b.ok).toBe(true);
  });
});
