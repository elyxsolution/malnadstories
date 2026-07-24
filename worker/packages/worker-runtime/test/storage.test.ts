import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunId } from '@workerv2/control-plane';
import {
  InMemoryStorageBackend,
  FileSystemStorageBackend,
  PersistentArtifactStore,
  DurableJournalStore,
  PersistentEventSink,
  RunRecordStore,
} from '@workerv2/worker-runtime';
import type { StorageBackend } from '@workerv2/worker-runtime';

const tmpRoots: string[] = [];
function fsBackend(): FileSystemStorageBackend {
  const root = mkdtempSync(join(tmpdir(), 'wv2-runtime-'));
  tmpRoots.push(root);
  return new FileSystemStorageBackend(root);
}
afterAll(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});

describe('StorageBackend', () => {
  function roundTrip(backend: StorageBackend): void {
    expect(backend.has('k')).toBe(false);
    backend.put('k', new Uint8Array([1, 2, 3]));
    expect(backend.has('k')).toBe(true);
    expect(Array.from(backend.get('k') ?? [])).toEqual([1, 2, 3]);
    backend.put('sha256:ab', new Uint8Array([9]));
    expect([...backend.keys()].sort()).toEqual(['k', 'sha256:ab']);
    backend.delete('k');
    expect(backend.has('k')).toBe(false);
  }

  it('in-memory backend round-trips', () => roundTrip(new InMemoryStorageBackend()));
  it('filesystem backend round-trips (durable, reversible keys)', () => roundTrip(fsBackend()));

  it('a filesystem backend re-reads state through a fresh instance (durability)', () => {
    const root = mkdtempSync(join(tmpdir(), 'wv2-runtime-'));
    tmpRoots.push(root);
    new FileSystemStorageBackend(root).put('run:1', new Uint8Array([7]));
    const reopened = new FileSystemStorageBackend(root);
    expect(Array.from(reopened.get('run:1') ?? [])).toEqual([7]);
    expect(reopened.keys()).toContain('run:1');
  });
});

describe('PersistentArtifactStore', () => {
  it('is content-addressed, idempotent, and readable', async () => {
    const store = new PersistentArtifactStore(new InMemoryStorageBackend());
    const bytes = new Uint8Array([10, 20, 30]);
    const key = store.put(bytes);
    expect(key).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(store.put(bytes)).toBe(key); // idempotent
    expect(store.size).toBe(1);
    expect(Array.from(await store.read(key))).toEqual([10, 20, 30]);
    expect(await store.exists(key)).toBe(true);
    expect(await store.write(new Uint8Array([10, 20, 30]))).toBe(key);
  });

  it('two stores over the same backend see the same artifacts (durable identity)', async () => {
    const backend = new InMemoryStorageBackend();
    const key = new PersistentArtifactStore(backend).put(new Uint8Array([1]));
    expect(await new PersistentArtifactStore(backend).exists(key)).toBe(true);
  });
});

describe('DurableJournalStore + PersistentEventSink + RunRecordStore', () => {
  const runId = 'run-1' as RunId;

  it('appends + loads journal entries durably', async () => {
    const backend = new InMemoryStorageBackend();
    const journal = new DurableJournalStore(backend);
    await journal.append(runId, [{ seq: 0 } as never, { seq: 1 } as never]);
    await journal.append(runId, [{ seq: 2 } as never]);
    const reloaded = await new DurableJournalStore(backend).load(runId);
    expect(reloaded.map((e) => (e as { seq: number }).seq)).toEqual([0, 1, 2]);
  });

  it('persists events per run (observational log)', () => {
    const backend = new InMemoryStorageBackend();
    const sink = new PersistentEventSink(backend);
    sink.publish({ runId, type: 'run.started' } as never);
    sink.publish({ runId, type: 'run.succeeded' } as never);
    expect(new PersistentEventSink(backend).loadEvents('run-1')).toHaveLength(2);
  });

  it('saves + lists run records', () => {
    const backend = new InMemoryStorageBackend();
    const records = new RunRecordStore(backend);
    records.save({ runId: 'run-1', blueprintKey: 'sha256:aa', manifestHash: 'sha256:bb' });
    expect(new RunRecordStore(backend).load('run-1')).toMatchObject({ blueprintKey: 'sha256:aa' });
    expect(records.runIds()).toEqual(['run-1']);
    expect(records.load('missing')).toBeUndefined();
  });
});
