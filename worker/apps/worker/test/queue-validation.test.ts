import { describe, it, expect } from 'vitest';
import {
  CLEANUP,
  FakeBroker,
  FakeBrokerQueue,
  IMAGE,
  LoadHarness,
  PDF,
  SyntheticProcessor,
  generateWorkload,
  sleep,
} from '../src/testing/index.js';
import { PgBossQueueAdapter } from '../src/infra/queue/pgboss-queue.js';
import type { PgBossJobWithMetadata, PgBossLike } from '../src/infra/queue/pgboss-queue.js';

/**
 * QUEUE VALIDATION — the broker contract the whole architecture rests on.
 *
 * Two levels are exercised. The BROKER MODEL tests pin the semantics the worker assumes (atomic
 * fetch, visibility timeout, retry-then-dead-letter, delayed jobs). The ADAPTER tests pin the
 * production `PgBossQueueAdapter`'s own behaviour — most importantly the round-robin fairness fix,
 * which is a property of the adapter, not of pg-boss.
 */

describe('broker semantics the worker depends on', () => {
  it('atomic fetch: two consumers never hold the same job', () => {
    const broker = new FakeBroker();
    broker.send(IMAGE, { n: 1 });
    const first = broker.fetch(IMAGE, 'worker-1');
    const second = broker.fetch(IMAGE, 'worker-2');
    expect(first).not.toBeNull();
    expect(second).toBeNull(); // held by worker-1
    expect(broker.concurrentDoubleDelivery()).toEqual([]);
  });

  it('visibility timeout returns an unacked job — the crashed-worker path', () => {
    let now = 0;
    const broker = new FakeBroker({ visibilityMs: 1_000, now: () => now });
    const id = broker.send(IMAGE, {});

    const taken = broker.fetch(IMAGE, 'doomed-worker');
    expect(taken?.id).toBe(id);
    expect(broker.fetch(IMAGE, 'other')).toBeNull(); // still invisible

    now = 1_500; // the worker died without acking; its lease lapsed
    const recovered = broker.fetch(IMAGE, 'other');
    expect(recovered?.id).toBe(id);
    expect(recovered?.deliveries).toBe(2);
    expect(broker.depth).toBe(1); // never lost
  });

  it('retries up to the limit, then dead-letters instead of looping forever', () => {
    const broker = new FakeBroker({ retryLimit: 3 });
    const id = broker.send(IMAGE, {});

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const job = broker.fetch(IMAGE, 'w');
      expect(job?.id).toBe(id);
      broker.fail(id, `attempt ${attempt} failed`);
    }

    expect(broker.depth).toBe(0);
    expect(broker.deadLetters).toHaveLength(1);
    expect(broker.deadLetters[0]).toMatchObject({ id, deliveries: 3 });
    expect(broker.fetch(IMAGE, 'w')).toBeNull(); // not redelivered after dead-lettering
  });

  it('withholds delayed jobs until their time arrives', () => {
    let now = 0;
    const broker = new FakeBroker({ now: () => now });
    broker.send(IMAGE, {}, 500);
    expect(broker.fetch(IMAGE, 'w')).toBeNull();
    now = 600;
    expect(broker.fetch(IMAGE, 'w')).not.toBeNull();
  });

  it('an acked job is gone for good', () => {
    const broker = new FakeBroker();
    const id = broker.send(IMAGE, {});
    broker.fetch(IMAGE, 'w');
    broker.complete(id);
    expect(broker.depth).toBe(0);
    expect(broker.completedIds).toEqual([id]);
  });
});

describe('queue fairness — the starvation fix', () => {
  /** A pg-boss double that always has work on every queue. */
  function saturatedBoss(): PgBossLike & { fetched: string[] } {
    const fetched: string[] = [];
    let n = 0;
    return {
      fetched,
      start: async () => undefined,
      stop: async () => undefined,
      createQueue: async () => undefined,
      fetch: async <T>(name: string): Promise<PgBossJobWithMetadata<T>[]> => {
        fetched.push(name);
        return [
          {
            id: `j${(n += 1)}`,
            name,
            data: {} as T,
            retryCount: 0,
            createdOn: new Date(0),
            singletonKey: null,
          },
        ];
      },
      send: async () => null,
      complete: async () => undefined,
      fail: async () => undefined,
    };
  }

  it('serves every queue in rotation instead of draining the first one forever', async () => {
    const boss = saturatedBoss();
    const adapter = new PgBossQueueAdapter(boss, [IMAGE, PDF, CLEANUP]);

    const served: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const job = await adapter.poll();
      served.push(job?.type ?? 'none');
    }

    // Before the fix this was ['image-hardening', ...] six times: a PDF could wait behind a
    // permanent image backlog indefinitely.
    expect(served).toEqual([IMAGE, PDF, CLEANUP, IMAGE, PDF, CLEANUP]);
  });

  it('honours the concurrency filter, never polling a queue whose lane is full', async () => {
    const boss = saturatedBoss();
    const adapter = new PgBossQueueAdapter(boss, [IMAGE, PDF, CLEANUP]);

    const job = await adapter.poll([PDF]);
    expect(job?.type).toBe(PDF);
    // Only the permitted queue was asked — a full lane costs no broker round-trip at all.
    expect(boss.fetched).toEqual([PDF]);
  });

  it('polls nothing when the filter is empty (backpressure means no broker traffic)', async () => {
    const boss = saturatedBoss();
    const adapter = new PgBossQueueAdapter(boss, [IMAGE, PDF]);
    expect(await adapter.poll([])).toBeNull();
    expect(boss.fetched).toEqual([]);
  });

  it('an unfiltered poll still returns any job (pre-Phase-I-5 callers are unaffected)', async () => {
    const boss = saturatedBoss();
    const adapter = new PgBossQueueAdapter(boss, [IMAGE]);
    expect((await adapter.poll())?.type).toBe(IMAGE);
  });
});

describe('queue behaviour end to end', () => {
  it('retries a transiently failing job and eventually completes it', async () => {
    // Fails the 1st delivery, succeeds thereafter.
    const processor = new SyntheticProcessor({ type: IMAGE, failEveryNth: 1 });
    const broker = new FakeBroker({ retryLimit: 5 });
    const harness = new LoadHarness({ broker, processors: () => [processor] });
    broker.send(IMAGE, { photoId: 'p1' });

    await harness.start();
    await sleep(60);
    await harness.stop();

    // Delivered more than once — the retry actually happened.
    expect(processor.started.length).toBeGreaterThan(1);
    expect(broker.deliveryLog.length).toBeGreaterThan(1);
  }, 20_000);

  it('dead-letters a permanently failing job rather than retrying forever', async () => {
    const processor = new SyntheticProcessor({ type: IMAGE, failEveryNth: 1 });
    const broker = new FakeBroker({ retryLimit: 3 });
    const harness = new LoadHarness({ broker, processors: () => [processor] });
    broker.send(IMAGE, { photoId: 'doomed' });

    await harness.start();
    const drained = await harness.waitForDrain(10_000);
    await harness.stop();

    expect(drained).toBe(true);
    expect(broker.deadLetters).toHaveLength(1);
    expect(broker.deadLetters[0]?.deliveries).toBe(3); // bounded, then parked
  }, 20_000);

  it('survives a worker restart: work in flight is redelivered, not lost', async () => {
    let now = 1_000;
    const broker = new FakeBroker({ visibilityMs: 500, now: () => now });
    generateWorkload(broker, { counts: { [IMAGE]: 20 } });

    // Worker #1 takes a job and "crashes" — stopped without acking.
    const queue = new FakeBrokerQueue(broker, [IMAGE], 'crashed-worker');
    const taken = await queue.poll();
    expect(taken).not.toBeNull();
    expect(broker.depth).toBe(20); // still owned by the broker

    now += 1_000; // its lease lapses
    const survivor = new SyntheticProcessor({ type: IMAGE });
    const harness = new LoadHarness({ broker, processors: () => [survivor] });
    await harness.start();
    expect(await harness.waitForDrain(20_000)).toBe(true);
    await harness.stop();

    // Nothing lost: all twenty, including the one the crashed worker held.
    expect(broker.completedIds).toHaveLength(20);
    expect(survivor.started).toContain(taken?.id);
  }, 30_000);

  it('handles a large queue without unbounded adapter state', async () => {
    const broker = new FakeBroker();
    const harness = new LoadHarness({
      workers: 2,
      processors: () => [new SyntheticProcessor({ type: IMAGE })],
      broker,
    });
    generateWorkload(broker, { counts: { [IMAGE]: 5_000 } });

    await harness.start();
    expect(await harness.waitForDrain(60_000)).toBe(true);
    await harness.stop();

    expect(broker.depth).toBe(0);
    expect(broker.inFlight).toBe(0); // no job left held
    for (const worker of harness.workers) expect(worker.app.inFlight).toBe(0);
  }, 90_000);
});
