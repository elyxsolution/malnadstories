import { describe, it, expect } from 'vitest';
import {
  CLEANUP,
  FakeBroker,
  FakeRenderer,
  IMAGE,
  LoadHarness,
  PDF,
  SyntheticProcessor,
  formatReport,
  generateWorkload,
  sampleMemory,
  sleep,
} from '../src/testing/index.js';
import { ConcurrencyController, DEFAULT_LANE } from '../src/concurrency.js';
import type { Pressure } from '../src/concurrency.js';

/**
 * RESILIENCE VALIDATION — backpressure, graceful shutdown under every kind of in-flight work, and
 * resource stability over a long run.
 *
 * These are the properties that decide whether a worker survives a bad afternoon in production:
 * does it slow down instead of dying when memory climbs, does it stop cleanly when the orchestrator
 * asks, and does it still look the same after an hour of work as it did at boot?
 */

const LANES = {
  maxInFlight: 4,
  defaultLane: DEFAULT_LANE,
  lanes: { [IMAGE]: { min: 1, max: 3 }, [PDF]: { min: 1, max: 1, heavy: true } },
  recoveryQuietFraction: 0.5,
};

describe('backpressure', () => {
  it('stops intake under critical pressure and resumes automatically', async () => {
    let pressure: Pressure = 'normal';
    const controller = new ConcurrencyController({
      config: LANES,
      pressure: () => pressure,
      pressureTtlMs: 0,
    });
    const processor = new SyntheticProcessor({ type: IMAGE, durationMs: 2 });
    const broker = new FakeBroker();
    // The worker runs with the pressure-aware controller, so the squeeze is driven through the same
    // path production uses — the sensor is what varies, not the mechanism.
    const harness = new LoadHarness({
      broker,
      processors: () => [processor],
      concurrency: () => controller,
    });

    generateWorkload(broker, { counts: { [IMAGE]: 200 } });
    await harness.start();
    await sleep(30);
    const beforeSqueeze = processor.started.length;
    expect(beforeSqueeze).toBeGreaterThan(0); // it was making progress

    pressure = 'critical'; // memory climbs
    await sleep(40);
    const duringSqueeze = processor.started.length;
    await sleep(40);
    // Intake stopped: no new jobs were taken while pressure was critical.
    expect(processor.started.length).toBe(duringSqueeze);
    expect(broker.depth).toBeGreaterThan(0); // work stayed durably QUEUED, not pulled in and dropped

    pressure = 'normal'; // memory recovers
    expect(await harness.waitForDrain(30_000)).toBe(true);
    await harness.stop();

    expect(processor.completed).toHaveLength(200); // everything eventually ran
    expect(broker.completedIds).toHaveLength(200); // nothing lost during the squeeze
  }, 45_000);

  it("a rapidly growing queue never grows the worker's in-flight set beyond its ceiling", async () => {
    const processor = new SyntheticProcessor({ type: IMAGE, durationMs: 3 });
    const broker = new FakeBroker();
    const harness = new LoadHarness({
      broker,
      processors: () => [processor],
      env: { WV2_IMAGE_CONCURRENCY: '3', WV2_MAX_IN_FLIGHT: '4' },
    });
    generateWorkload(broker, { counts: { [IMAGE]: 1_000 } });

    await harness.start();
    const observed: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      observed.push(harness.workers[0]?.app.inFlight ?? 0);
      await sleep(4);
    }
    await harness.waitForDrain(60_000);
    await harness.stop();

    // Uncontrolled resource growth is the failure mode; the ceiling holds regardless of queue depth.
    expect(Math.max(...observed)).toBeLessThanOrEqual(4);
    expect(processor.peakConcurrency).toBeLessThanOrEqual(3);
    expect(processor.completed).toHaveLength(1_000);
  }, 90_000);
});

describe('graceful shutdown under every kind of in-flight work', () => {
  for (const [label, type, durationMs] of [
    ['image processing', IMAGE, 40],
    ['PDF rendering', PDF, 40],
    ['cleanup', CLEANUP, 40],
  ] as const) {
    it(`stops cleanly during ${label}, cancelling and losing nothing`, async () => {
      const processor = new SyntheticProcessor({ type, durationMs });
      const broker = new FakeBroker();
      const harness = new LoadHarness({ broker, processors: () => [processor] });
      generateWorkload(broker, { counts: { [type]: 30 } });

      await harness.start();
      await sleep(25); // stop mid-job
      expect(processor.activeNow).toBeGreaterThan(0);

      await harness.stop('signal:SIGTERM');
      const worker = harness.workers[0];
      if (worker === undefined) throw new Error('no worker');

      expect(worker.app.appState).toBe('stopped');
      expect(worker.app.inFlight).toBe(0); // fully drained
      expect(processor.activeNow).toBe(0); // nothing left running

      // Cancelled work was never acked, so the broker still owns it — safe to restart.
      const accounted = broker.completedIds.length + broker.depth + broker.deadLetters.length;
      expect(accounted).toBe(30);
    }, 30_000);
  }

  it('a restarted worker completes exactly the work the stopped one did not', async () => {
    // The broker clock is controlled so leases lapse only when we say so — otherwise a short
    // visibility window would redeliver jobs while run one was still legitimately processing them.
    let brokerNow = 1_000;
    const broker = new FakeBroker({ visibilityMs: 500, now: () => brokerNow });
    const first = new SyntheticProcessor({ type: IMAGE, durationMs: 10 });
    const runOne = new LoadHarness({ broker, processors: () => [first] });
    generateWorkload(broker, { counts: { [IMAGE]: 40 } });

    await runOne.start();
    await sleep(80);
    await runOne.stop('restart');

    const completedFirst = broker.completedIds.length;
    expect(completedFirst).toBeGreaterThan(0); // it did real work
    expect(completedFirst).toBeLessThan(40); // but was stopped before finishing

    brokerNow += 1_000; // the stopped worker's leases lapse
    const second = new SyntheticProcessor({ type: IMAGE });
    const runTwo = new LoadHarness({ broker, processors: () => [second] });
    await runTwo.start();
    expect(await runTwo.waitForDrain(30_000)).toBe(true);
    await runTwo.stop();

    // No lost work and no double-completion across the restart.
    expect(broker.completedIds).toHaveLength(40);
    expect(new Set(broker.completedIds).size).toBe(40);
    expect(second.started.length).toBe(40 - completedFirst);
  }, 45_000);

  it('bounds the drain rather than hanging on a wedged job', async () => {
    // A job that ignores cancellation entirely — the wedged-Chromium case.
    const stubborn = {
      type: IMAGE,
      process: async (): Promise<void> => sleep(5_000),
    };
    const broker = new FakeBroker();
    const harness = new LoadHarness({
      broker,
      processors: () => [stubborn],
      env: { WV2_DRAIN_TIMEOUT_MS: '100' },
    });
    broker.send(IMAGE, { photoId: 'wedged' });

    await harness.start();
    await sleep(20);

    const started = Date.now();
    await harness.stop('signal:SIGTERM');
    const elapsed = Date.now() - started;

    // Without the bound this would take 5s and, in production, earn a SIGKILL.
    expect(elapsed).toBeLessThan(1_500);
    const worker = harness.workers[0];
    expect(worker?.app.abandonedJobs).toBe(1);
    expect(worker?.logs.withMessage('worker.drain.timeout')).toHaveLength(1);
    // The abandoned job was never acked, so the broker will redeliver it.
    expect(broker.completedIds).toHaveLength(0);
    expect(broker.depth).toBe(1);
  }, 30_000);

  it('shutdown while merely polling an empty queue is immediate', async () => {
    const harness = new LoadHarness({
      processors: () => [new SyntheticProcessor({ type: IMAGE })],
    });
    await harness.start();
    await sleep(10);

    const started = Date.now();
    await harness.stop();
    expect(Date.now() - started).toBeLessThan(500);
  }, 20_000);
});

describe('long-running stability', () => {
  it('shows no unbounded growth across a sustained mixed workload', async () => {
    const image = new SyntheticProcessor({ type: IMAGE, durationMs: 0 });
    const pdf = new SyntheticProcessor({ type: PDF, durationMs: 1 });
    const cleanup = new SyntheticProcessor({ type: CLEANUP, durationMs: 0 });
    const broker = new FakeBroker();
    const harness = new LoadHarness({ broker, processors: () => [image, pdf, cleanup] });

    await harness.start();
    if (global.gc !== undefined) global.gc();
    const before = sampleMemory();

    // Ten waves, so steady-state behaviour is measured rather than a single burst.
    const started = Date.now();
    for (let wave = 0; wave < 10; wave += 1) {
      generateWorkload(broker, {
        counts: { [IMAGE]: 200, [PDF]: 5, [CLEANUP]: 40 },
        interleave: true,
      });
      expect(await harness.waitForDrain(30_000)).toBe(true);
    }
    const durationMs = Date.now() - started;
    if (global.gc !== undefined) global.gc();
    const after = sampleMemory();
    await harness.stop();

    const worker = harness.workers[0];
    if (worker === undefined) throw new Error('no worker');

    // CORRECTNESS held for the whole run.
    expect(image.completed).toHaveLength(2_000);
    expect(pdf.completed).toHaveLength(50);
    expect(cleanup.completed).toHaveLength(400);
    expect(broker.depth).toBe(0);

    // NO LEAKS in the structures that accumulate per job.
    expect(worker.app.inFlight).toBe(0);
    expect(worker.concurrency.inFlight).toBe(0);
    expect(worker.observability.events.openTraces).toBe(0); // no dangling span state
    expect(worker.logs.records.length).toBeLessThanOrEqual(500); // the ring stayed bounded

    const report = {
      ...harness.report('long run · 2,450 jobs · 10 waves', durationMs, before),
      memoryAfter: after,
      heapGrowthBytes: after.heapUsedBytes - before.heapUsedBytes,
    };
    console.log(formatReport(report));

    // Heap growth is bounded well below what a per-job leak would produce over 2,450 jobs.
    expect(report.heapGrowthBytes).toBeLessThan(64 * 1024 * 1024);
  }, 120_000);

  it('releases every renderer page — no browser or page leaks', async () => {
    const renderer = new FakeRenderer();
    for (let i = 0; i < 200; i += 1) {
      await renderer.render({
        url: `https://app.example.com/albums/a${i}/print?t=x`,
        origin: 'http://localhost:3000',
        readinessFlag: 'READY',
        timeouts: { newPageMs: 10, navigationMs: 10, readinessMs: 10, settleMs: 1, pdfMs: 10 },
      });
    }
    expect(renderer.calls).toHaveLength(200);
    expect(renderer.openPages).toBe(0); // every page closed
    expect(renderer.peakOpenPages).toBe(1); // and never more than one at a time
  }, 30_000);

  it('keeps observability accurate and bounded under sustained load', async () => {
    const processor = new SyntheticProcessor({ type: IMAGE });
    const broker = new FakeBroker();
    const harness = new LoadHarness({ broker, processors: () => [processor] });
    generateWorkload(broker, { counts: { [IMAGE]: 2_000 } });

    await harness.start();
    expect(await harness.waitForDrain(60_000)).toBe(true);
    await harness.stop();

    const worker = harness.workers[0];
    if (worker === undefined) throw new Error('no worker');

    // Metrics are EXACT, not approximate, after 2,000 jobs.
    expect(worker.metrics.counterTotal('worker.jobs.received')).toBe(2_000);
    expect(worker.metrics.counterTotal('worker.jobs.completed')).toBe(2_000);
    expect(worker.metrics.counterTotal('worker.jobs.failed')).toBe(0);

    // Traces all closed; the log ring never grew past its capacity.
    expect(worker.observability.events.openTraces).toBe(0);
    expect(worker.logs.records.length).toBeLessThanOrEqual(500);

    // Health still answers correctly at the end of a heavy run.
    const health = await worker.app.healthReport();
    expect(health.live).toBe(true);
  }, 90_000);
});

describe('resource stress', () => {
  it('runs cleanup, rendering and image work concurrently without deadlock or starvation', async () => {
    const image = new SyntheticProcessor({ type: IMAGE, durationMs: 2 });
    const pdf = new SyntheticProcessor({ type: PDF, durationMs: 8 });
    const cleanup = new SyntheticProcessor({ type: CLEANUP, durationMs: 2 });
    const broker = new FakeBroker();
    const harness = new LoadHarness({
      workers: 4,
      broker,
      processors: () => [image, pdf, cleanup],
      env: { WV2_MAX_IN_FLIGHT: '4', WV2_IMAGE_CONCURRENCY: '3' },
    });
    generateWorkload(broker, {
      counts: { [IMAGE]: 400, [PDF]: 20, [CLEANUP]: 100 },
      interleave: true,
    });

    const started = Date.now();
    await harness.start();
    expect(await harness.waitForDrain(60_000)).toBe(true);
    const durationMs = Date.now() - started;
    await harness.stop();

    // NO STARVATION: every type finished, including the ones declared last.
    expect(broker.depthOf(IMAGE)).toBe(0);
    expect(broker.depthOf(PDF)).toBe(0);
    expect(broker.depthOf(CLEANUP)).toBe(0);
    expect(broker.completedIds).toHaveLength(520);

    // NO DEADLOCK: the run completed, and no worker is left holding a slot.
    for (const worker of harness.workers) expect(worker.app.inFlight).toBe(0);

    console.log(formatReport(harness.report('resource stress · 4 workers', durationMs)));
  }, 90_000);
});
