import { describe, it, expect } from 'vitest';
import { RecordingLogger } from '@workerv2/worker-runtime';
import type { Job } from '../src/job.js';
import type { ObjectStore, ObjectMetadata } from '../src/infra/storage/object-store.js';
import { CleanupProcessor, R2_CLEANUP_TYPE } from '../src/processors/cleanup/cleanup-processor.js';
import { CancellationSource } from '../src/recovery/cancellation.js';
import type { ProcessorEvent, ProcessorEventSink } from '../src/processors/pipeline/events.js';

class FakeObjectStore implements ObjectStore {
  readonly deleted: string[] = [];
  failOn: string | null = null;
  async read(): Promise<Uint8Array | null> {
    return null;
  }
  async write(key: string, data: Uint8Array): Promise<ObjectMetadata> {
    return { key, sizeBytes: data.byteLength };
  }
  async delete(key: string): Promise<void> {
    if (key === this.failOn) throw new Error('r2 down');
    this.deleted.push(key); // idempotent: R2 DeleteObject never errors on a missing key
  }
  async exists(): Promise<boolean> {
    return false;
  }
  async head(): Promise<ObjectMetadata | null> {
    return null;
  }
  async healthCheck(): Promise<'healthy'> {
    return 'healthy';
  }
}

class RecordingSink implements ProcessorEventSink {
  readonly events: ProcessorEvent[] = [];
  emit(e: ProcessorEvent): void {
    this.events.push(e);
  }
  types(prefix: string): string[] {
    return this.events.filter((e) => e.type.startsWith(prefix)).map((e) => e.type);
  }
}

function job(keys: unknown): Job<{ keys: readonly string[] }> {
  return {
    id: 'job-1',
    type: R2_CLEANUP_TYPE,
    payload: { keys } as { keys: readonly string[] },
    metadata: { correlationId: 'req-1', attempt: 1 },
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    receivedAt: '2026-01-01T00:00:01.000Z',
  };
}

function build(): {
  processor: CleanupProcessor;
  store: FakeObjectStore;
  events: RecordingSink;
} {
  const store = new FakeObjectStore();
  const events = new RecordingSink();
  // Phase I-4: the processor takes NO metrics sink. It reports the delete count on the
  // `cleanup.completed` event and the observability layer derives the counter from it.
  const processor = new CleanupProcessor({
    objectStore: store,
    logger: new RecordingLogger(),
    events,
  });
  return { processor, store, events };
}

describe('cleanup pipeline', () => {
  it('deletes every key and reports the count', async () => {
    const ctx = build();
    await ctx.processor.process(job(['k1', 'k2', 'k3']));
    expect(ctx.store.deleted).toEqual(['k1', 'k2', 'k3']);
    const done = ctx.events.events.find((e) => e.type === 'cleanup.completed');
    expect(typeof done?.durationMs).toBe('number');
    expect(done?.detail).toMatchObject({ deleted: 3 });
  });

  it('is idempotent — re-running deletes the same keys again with no error (duplicate cleanup)', async () => {
    const ctx = build();
    await ctx.processor.process(job(['k1']));
    await ctx.processor.process(job(['k1']));
    expect(ctx.store.deleted).toEqual(['k1', 'k1']); // R2 delete is a no-op on the 2nd pass — safe
  });

  it('filters out invalid keys defensively', async () => {
    const ctx = build();
    await ctx.processor.process(job(['ok', '', 123, null]));
    expect(ctx.store.deleted).toEqual(['ok']);
  });

  it('drops a poison payload without deleting anything', async () => {
    const ctx = build();
    await ctx.processor.process(job('not-an-array'));
    expect(ctx.store.deleted).toEqual([]);
  });

  it('rethrows a transient delete failure so the broker retries (partial cleanup → retried)', async () => {
    const ctx = build();
    ctx.store.failOn = 'k2';
    await expect(ctx.processor.process(job(['k1', 'k2', 'k3']))).rejects.toThrow('r2 down');
    expect(ctx.store.deleted).toEqual(['k1']); // k1 done; retry re-runs the whole (idempotent) list
    expect(ctx.events.types('cleanup.failed')).toHaveLength(1);
  });

  it('supports graceful interruption via cancellation', async () => {
    const ctx = build();
    const source = new CancellationSource();
    source.cancel(); // cancelled before processing
    await expect(ctx.processor.process(job(['k1', 'k2']), source.token)).rejects.toBeTruthy();
    expect(ctx.store.deleted).toEqual([]); // aborted before deleting
    const failed = ctx.events.events.find((e) => e.type === 'cleanup.failed');
    expect(failed?.detail).toMatchObject({ reason: 'cancelled' });
  });
});
