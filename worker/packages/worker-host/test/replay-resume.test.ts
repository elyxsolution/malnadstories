import { describe, it, expect } from 'vitest';
import { WorkerHost } from '@workerv2/worker-host';
import { makeRunId, makeTimestamp } from '@workerv2/control-plane';
import type { RunId } from '@workerv2/control-plane';
import {
  ExecutionSession,
  InMemoryJournalStore,
  InMemoryEventSink,
  manualClock,
  immediateWaiter,
  defaultCapabilityNegotiator,
  runToCompletion,
} from '@workerv2/execution-adapter';
import { ASSEMBLE_NODE_ID, ALBUM_OUTPUT } from '@workerv2/manifest';
import { seedAlbumBlueprint } from './helpers.js';

function rid(raw: string): RunId {
  const r = makeRunId(raw);
  if (!r.ok) throw new Error('runId');
  return r.value;
}

describe('replay + resume', () => {
  it('replays (rebuild) to the same artifact identities', async () => {
    const host = new WorkerHost();
    const prepared = host.prepare(seedAlbumBlueprint(host, 2));

    const first = await host.executeManifest(prepared.coordinator, rid('run-a'));
    expect(first.state.status).toBe('succeeded');
    const firstAlbum = first.state.nodes[ASSEMBLE_NODE_ID]?.outputs?.[ALBUM_OUTPUT];

    const seeded = prepared.coordinator.seedReplay(first.state, rid('run-b'), 'rebuild');
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const second = await host.executeManifest(prepared.coordinator, rid('run-b'), {
      initial: seeded.value,
    });
    expect(second.state.status).toBe('succeeded');

    // Content-addressed → the rebuilt run produces the identical Document Artifact.
    expect(second.state.nodes[ASSEMBLE_NODE_ID]?.outputs?.[ALBUM_OUTPUT]).toBe(firstAlbum);
  });

  it('resumes from a persisted journal to the same completed state (driftless)', async () => {
    const host = new WorkerHost();
    const prepared = host.prepare(seedAlbumBlueprint(host, 1));

    const start = makeTimestamp('2026-01-01T00:00:00.000Z');
    if (!start.ok) throw new Error('ts');
    const journal = new InMemoryJournalStore();
    const runId = rid('run-c');
    const session = new ExecutionSession(
      prepared.coordinator,
      runId,
      journal,
      new InMemoryEventSink(),
    );
    await runToCompletion(session, {
      clock: manualClock(start.value),
      resolver: host.processors,
      negotiator: defaultCapabilityNegotiator,
      offers: host.offers,
      waiter: immediateWaiter,
    });
    expect(session.state.status).toBe('succeeded');

    // Re-fold the persisted journal → identical terminal state (INV-7).
    const entries = await journal.load(runId);
    const resumed = prepared.coordinator.resume(runId, entries);
    expect(resumed.ok).toBe(true);
    if (resumed.ok) {
      expect(resumed.value.status).toBe('succeeded');
      expect(resumed.value.nodes[ASSEMBLE_NODE_ID]?.outputs?.[ALBUM_OUTPUT]).toBe(
        session.state.nodes[ASSEMBLE_NODE_ID]?.outputs?.[ALBUM_OUTPUT],
      );
    }
  });
});
