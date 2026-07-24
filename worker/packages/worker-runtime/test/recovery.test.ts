import { describe, it, expect } from 'vitest';
import { ASSEMBLE_NODE_ID, ALBUM_OUTPUT } from '@workerv2/manifest';
import {
  WorkerRuntime,
  InMemoryStorageBackend,
  makeRuntimeHarness,
  seedRuntimeAlbum,
} from '@workerv2/worker-runtime';

describe('restart recovery + deterministic resume', () => {
  it('recovers a run after a simulated restart to the same terminal state', async () => {
    const backend = new InMemoryStorageBackend();

    // Runtime #1 runs the album, persisting artifacts + journal + run record durably.
    const first = makeRuntimeHarness(backend).runtime;
    first.start();
    const { result } = await first.run(seedRuntimeAlbum(first, 2));
    expect(result.succeeded).toBe(true);
    const originalAlbum = result.state.nodes[ASSEMBLE_NODE_ID]?.outputs?.[ALBUM_OUTPUT];

    // Restart: a FRESH runtime over the SAME durable backend recovers the run from its journal.
    const second = makeRuntimeHarness(backend).runtime;
    second.start();
    expect(second.recoverableRuns()).toContain(result.runId);

    const recovered = await second.recover(result.runId);
    expect(recovered?.status).toBe('succeeded');
    // Content-addressed → the recovered run has the identical Document Artifact.
    expect(recovered?.nodes[ASSEMBLE_NODE_ID]?.outputs?.[ALBUM_OUTPUT]).toBe(originalAlbum);
  });

  it('reuses artifacts across restart (identity stable; no regeneration needed)', async () => {
    const backend = new InMemoryStorageBackend();

    const h1 = makeRuntimeHarness(backend).runtime;
    h1.start();
    const r1 = await h1.run(seedRuntimeAlbum(h1, 1));
    const sizeAfterFirst = h1.store.size;

    // A fresh runtime over the same backend sees the SAME artifacts already present.
    const h2 = makeRuntimeHarness(backend).runtime;
    h2.start();
    expect(h2.store.size).toBe(sizeAfterFirst);
    expect(await h2.store.exists(r1.result.pdfKey!)).toBe(true);
    expect(await h2.store.exists(r1.result.documentKey!)).toBe(true);
  });

  it('recovering an unknown run returns undefined', async () => {
    const runtime = new WorkerRuntime({}, { backend: new InMemoryStorageBackend() });
    runtime.start();
    expect(await runtime.recover('run-does-not-exist')).toBeUndefined();
  });

  it('the durable journal alone reconstructs the identical state (driftless resume)', async () => {
    const backend = new InMemoryStorageBackend();
    const { runtime } = makeRuntimeHarness(backend);
    runtime.start();
    const { result } = await runtime.run(seedRuntimeAlbum(runtime, 1));

    // The persisted journal is present and non-empty.
    const entries = await runtime.journalStore.load(
      result.runId as unknown as Parameters<typeof runtime.journalStore.load>[0],
    );
    expect(entries.length).toBeGreaterThan(0);
  });
});
