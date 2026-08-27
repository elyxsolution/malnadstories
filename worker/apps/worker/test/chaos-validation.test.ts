import { describe, it, expect } from 'vitest';
import {
  ChaosDatabase,
  ChaosObjectStore,
  ChaosQueue,
  ChaosRenderer,
  FakeBroker,
  FakeDatabase,
  FakeObjectStore,
  FakeRenderer,
  FaultController,
  IMAGE,
  InjectedFault,
  LoadHarness,
  NO_FAULTS,
  SyntheticProcessor,
  generateWorkload,
  sleep,
} from '../src/testing/index.js';
import { RendererCrashedError } from '../src/processors/pdf/page-renderer.js';
import {
  WorkerHealthRegistry,
  databaseProbe,
  objectStoreProbe,
} from '../src/observability/index.js';

/**
 * CHAOS VALIDATION — the architecture's response to its dependencies failing.
 *
 * Every fault is injected at the INFRASTRUCTURE boundary, through decorators over the real ports, so
 * what is under test is the production reaction: does a dependency outage surface as an unhealthy
 * probe rather than a crash? does a Chromium crash stay classified as transient? does the worker
 * keep serving the job types that do not depend on the broken thing?
 */

describe('the framework is inert when disabled', () => {
  it('adds no behaviour with nothing armed', async () => {
    const store = new FakeObjectStore();
    store.put('k', new Uint8Array([1, 2, 3]));
    const chaotic = new ChaosObjectStore(store, NO_FAULTS);

    expect(await chaotic.read('k')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await chaotic.healthCheck()).toBe('healthy');
    expect(NO_FAULTS.armed).toBe(false);
  });

  it('is deterministic — the same schedule fires on exactly the same calls', async () => {
    const faults = new FaultController().arm('storage', { kind: 'outage', everyNthCall: 3 });
    const store = new ChaosObjectStore(new FakeObjectStore(), faults);

    const outcomes: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      outcomes.push(
        await store
          .read('k')
          .then(() => 'ok')
          .catch(() => 'fail'),
      );
    }
    expect(outcomes).toEqual(['ok', 'ok', 'fail', 'ok', 'ok', 'fail']);
    expect(faults.occurrences('storage')).toBe(2);
  });

  it('can be healed, restoring normal behaviour', async () => {
    const faults = new FaultController().arm('storage', { kind: 'outage' });
    const store = new ChaosObjectStore(new FakeObjectStore(), faults);
    await expect(store.read('k')).rejects.toBeInstanceOf(InjectedFault);

    faults.healAll();
    await expect(store.read('k')).resolves.toBeNull();
  });
});

describe('R2 outage', () => {
  it('surfaces as an UNHEALTHY probe rather than an exception out of health reporting', async () => {
    const faults = new FaultController().arm('storage', { kind: 'outage' });
    const store = new ChaosObjectStore(new FakeObjectStore(), faults);

    const registry = new WorkerHealthRegistry();
    registry.register(objectStoreProbe(store, 0));
    const report = await registry.report();

    expect(report.ready).toBe(false); // pulled from rotation
    expect(report.live).toBe(true); // but NOT restarted — the outage is external
  });

  it('restricted to writes leaves reads working (partial degradation stays partial)', async () => {
    const inner = new FakeObjectStore();
    inner.put('k', new Uint8Array([9]));
    const faults = new FaultController().arm('storage', { kind: 'outage', operations: ['write'] });
    const store = new ChaosObjectStore(inner, faults);

    await expect(store.read('k')).resolves.toEqual(new Uint8Array([9]));
    await expect(store.write('k2', new Uint8Array([1]))).rejects.toBeInstanceOf(InjectedFault);
  });
});

describe('database outage + slowness', () => {
  it('reports unhealthy while down and recovers when healed', async () => {
    const faults = new FaultController();
    const database = new ChaosDatabase(new FakeDatabase(), faults);
    const registry = new WorkerHealthRegistry();
    registry.register(databaseProbe(database, 0));

    expect((await registry.report()).ready).toBe(true);

    faults.arm('database', { kind: 'outage' });
    expect((await registry.report()).ready).toBe(false);

    faults.healAll();
    expect((await registry.report()).ready).toBe(true); // self-heals, no restart
  });

  it('a slow database delays but does not fail a query', async () => {
    const faults = new FaultController().arm('database', { kind: 'slow', delayMs: 40 });
    const database = new ChaosDatabase(new FakeDatabase().on('select', [{ ok: true }]), faults);

    const started = Date.now();
    const rows = await database.query('select 1');
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    expect(rows).toEqual([{ ok: true }]);
  });
});

describe('Chromium crash', () => {
  it("is classified as the renderer's own transient crash, not an alien error", async () => {
    const faults = new FaultController().arm('renderer', {
      kind: 'crash',
      message: 'Target closed',
    });
    const renderer = new ChaosRenderer(new FakeRenderer(), faults);

    await expect(
      renderer.render({
        url: 'https://app.example.com/albums/a/print?t=x',
        origin: 'http://localhost:3000',
        readinessFlag: 'READY',
        timeouts: { newPageMs: 1, navigationMs: 1, readinessMs: 1, settleMs: 1, pdfMs: 1 },
      }),
    ).rejects.toBeInstanceOf(RendererCrashedError);
  });

  it('does not stop image processing — the lanes fail independently', async () => {
    const faults = new FaultController().arm('album-pdf', { kind: 'crash' });
    const image = new SyntheticProcessor({ type: IMAGE });
    const pdf = new SyntheticProcessor({ type: 'album-pdf', faults });

    const broker = new FakeBroker({ retryLimit: 2 });
    const harness = new LoadHarness({ broker, processors: () => [image, pdf] });
    generateWorkload(broker, { counts: { [IMAGE]: 30, 'album-pdf': 3 }, interleave: true });

    await harness.start();
    await harness.waitForDrain(20_000);
    await harness.stop();

    // Every image succeeded even though every PDF failed.
    expect(image.completed).toHaveLength(30);
    expect(pdf.completed).toHaveLength(0);
    expect(broker.deadLetters.every((d) => d.queue === 'album-pdf')).toBe(true);
  }, 30_000);
});

describe('out-of-memory + timeouts', () => {
  it('an OOM-shaped failure is retried, not silently dropped', async () => {
    const faults = new FaultController().arm(IMAGE, { kind: 'oom', maxOccurrences: 1 });
    const processor = new SyntheticProcessor({ type: IMAGE, faults });
    const broker = new FakeBroker({ retryLimit: 5 });
    const harness = new LoadHarness({ broker, processors: () => [processor] });
    broker.send(IMAGE, { photoId: 'p1' });

    await harness.start();
    expect(await harness.waitForDrain(20_000)).toBe(true);
    await harness.stop();

    expect(processor.started.length).toBeGreaterThan(1); // failed once, then retried
    expect(processor.completed).toHaveLength(1); // and eventually succeeded
    expect(broker.deadLetters).toHaveLength(0);
  }, 30_000);

  it('a queue-side fault does not take down the dispatch loop', async () => {
    const faults = new FaultController().arm('queue', {
      kind: 'outage',
      operations: ['poll'],
      everyNthCall: 2,
      message: 'broker connection reset',
    });
    const processor = new SyntheticProcessor({ type: IMAGE });
    const broker = new FakeBroker();
    const harness = new LoadHarness({
      broker,
      processors: () => [processor],
      wrapQueue: (inner) => new ChaosQueue(inner, faults),
    });
    generateWorkload(broker, { counts: { [IMAGE]: 20 } });

    await harness.start();
    await sleep(300);
    const worker = harness.workers[0];
    if (worker === undefined) throw new Error('no worker');

    // REGRESSION: a poll failure used to escape the dispatch loop as an unhandled rejection and kill
    // it permanently — the worker stayed "healthy" while consuming nothing. It must now survive,
    // record the failure, and keep making progress.
    expect(faults.occurrences('queue')).toBeGreaterThan(0);
    expect(worker.logs.withMessage('worker.dispatch.failed').length).toBeGreaterThan(0);
    expect(processor.started.length).toBeGreaterThan(0); // still consuming despite the faults

    faults.healAll();
    expect(await harness.waitForDrain(20_000)).toBe(true); // fully recovers once the broker returns
    await harness.stop();
    expect(broker.completedIds).toHaveLength(20); // and nothing was lost
  }, 30_000);
});

describe('observability stays correct while faults are active', () => {
  it('keeps logs structured and metrics accurate through a fault storm', async () => {
    const faults = new FaultController().arm(IMAGE, { kind: 'outage', everyNthCall: 3 });
    const processor = new SyntheticProcessor({ type: IMAGE, faults });
    const broker = new FakeBroker({ retryLimit: 10 });
    const harness = new LoadHarness({ broker, processors: () => [processor] });
    generateWorkload(broker, { counts: { [IMAGE]: 60 } });

    await harness.start();
    await harness.waitForDrain(30_000);
    await harness.stop();

    const worker = harness.workers[0];
    if (worker === undefined) throw new Error('no worker');

    // Every record is still fully structured — no fault path bypasses the layer.
    for (const record of worker.logs.records) {
      expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof record.level).toBe('string');
      expect(typeof record.message).toBe('string');
    }

    // Failures were counted, not swallowed.
    const failed = worker.metrics.counterTotal('worker.jobs.failed');
    const completed = worker.metrics.counterTotal('worker.jobs.completed');
    expect(failed).toBeGreaterThan(0);
    expect(completed).toBeGreaterThan(0);
    expect(completed + failed).toBe(worker.metrics.counterTotal('worker.jobs.received'));
  }, 40_000);
});
