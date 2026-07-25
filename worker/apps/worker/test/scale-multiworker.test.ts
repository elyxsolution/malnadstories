import { describe, it, expect } from 'vitest';
import {
  CLEANUP,
  IMAGE,
  LoadHarness,
  PDF,
  SyntheticProcessor,
  formatReport,
  generateWorkload,
  mixedWorkload,
  sampleMemory,
} from '../src/testing/index.js';

/**
 * SCALE + HORIZONTAL SCALING VALIDATION.
 *
 * These run REAL `WorkerApplication` instances over a faithful broker model, so the properties
 * asserted — no duplicate processing, no lost jobs, correct distribution — are properties of the
 * shipped dispatch loop, not of a simulation.
 *
 * The load is deliberately fast-executing (synthetic processors) and large in COUNT, because the
 * failure modes being hunted are combinatorial (interleaving, lane accounting, ack/nack races), not
 * computational. Ten thousand jobs at 0ms each exercise the scheduler far harder than ten jobs at
 * 1s each, and finish in a second.
 */

function processors(durationMs = 0): () => SyntheticProcessor[] {
  return () => [
    new SyntheticProcessor({ type: IMAGE, durationMs }),
    new SyntheticProcessor({ type: PDF, durationMs: durationMs * 4 }),
    new SyntheticProcessor({ type: CLEANUP, durationMs }),
  ];
}

/** Every job id started by any processor on any worker. */
function allStarted(harness: LoadHarness): string[] {
  return harness.workers.flatMap((w) =>
    w.processors.flatMap((p) => [...(p as SyntheticProcessor).started]),
  );
}

describe('scale — 10,000 queued jobs', () => {
  it('processes ten thousand jobs with no loss and no duplication', async () => {
    const harness = new LoadHarness({ workers: 1, processors: processors() });
    const ids = generateWorkload(harness.broker, { counts: { [IMAGE]: 10_000 } });
    expect(ids).toHaveLength(10_000);

    const before = sampleMemory();
    const started = Date.now();
    await harness.start();
    const drained = await harness.waitForDrain(60_000);
    const durationMs = Date.now() - started;
    await harness.stop();

    expect(drained).toBe(true);
    expect(harness.broker.depth).toBe(0);
    expect(harness.broker.completedIds).toHaveLength(10_000);

    // Every job ran exactly once.
    const processed = allStarted(harness);
    expect(processed).toHaveLength(10_000);
    expect(new Set(processed).size).toBe(10_000);
    expect(harness.broker.concurrentDoubleDelivery()).toEqual([]);

    const report = harness.report('10k image jobs · 1 worker', durationMs, before);
    expect(report.jobsCompleted).toBe(10_000);
    expect(report.jobsFailed).toBe(0);
    console.log(formatReport(report));
  }, 90_000);
});

describe('scale — 100 PDF jobs', () => {
  it('renders a hundred PDFs, honouring the heavy lane cap of 1', async () => {
    const harness = new LoadHarness({
      workers: 1,
      processors: () => [new SyntheticProcessor({ type: PDF, durationMs: 1 })],
      env: { WV2_PDF_CONCURRENCY: '1' },
    });
    generateWorkload(harness.broker, { counts: { [PDF]: 100 } });

    const started = Date.now();
    await harness.start();
    expect(await harness.waitForDrain(30_000)).toBe(true);
    const durationMs = Date.now() - started;
    await harness.stop();

    const pdf = harness.workers[0]?.processors[0] as SyntheticProcessor;
    expect(pdf.completed).toHaveLength(100);
    // The heavy lane never exceeded its cap — no two renders shared a Chromium at once.
    expect(pdf.peakConcurrency).toBe(1);
    console.log(formatReport(harness.report('100 PDF jobs · 1 worker', durationMs)));
  }, 45_000);
});

describe('scale — mixed workload', () => {
  it('runs images, PDFs and cleanup together without one type starving another', async () => {
    const harness = new LoadHarness({ workers: 2, processors: processors(1) });
    const spec = mixedWorkload(3); // 300 images, 15 PDFs, 60 cleanups, interleaved
    generateWorkload(harness.broker, spec);

    const started = Date.now();
    await harness.start();
    expect(await harness.waitForDrain(60_000)).toBe(true);
    const durationMs = Date.now() - started;
    await harness.stop();

    // Every type completed in full — the anti-starvation property the round-robin poll restored.
    const totals = new Map<string, number>();
    for (const worker of harness.workers) {
      for (const processor of worker.processors as SyntheticProcessor[]) {
        totals.set(processor.type, (totals.get(processor.type) ?? 0) + processor.started.length);
      }
    }
    expect(totals.get(IMAGE)).toBe(300);
    expect(totals.get(PDF)).toBe(15);
    expect(totals.get(CLEANUP)).toBe(60);
    expect(harness.broker.depth).toBe(0);

    console.log(formatReport(harness.report('mixed workload · 2 workers', durationMs)));
  }, 90_000);

  it('a PDF backlog does NOT block image jobs (head-of-line blocking is gone)', async () => {
    // One slow PDF plus many images. Under the old sequential loop the images would all wait for
    // the render; with lanes they proceed alongside it.
    const image = new SyntheticProcessor({ type: IMAGE, durationMs: 1 });
    const pdf = new SyntheticProcessor({ type: PDF, durationMs: 120 });
    const harness = new LoadHarness({
      workers: 1,
      processors: () => [image, pdf],
      env: { WV2_IMAGE_CONCURRENCY: '4', WV2_MAX_IN_FLIGHT: '5' },
    });

    harness.broker.send(PDF, { albumId: 'a', token: 't' });
    for (let i = 0; i < 40; i += 1) harness.broker.send(IMAGE, { photoId: `p${i}` });

    await harness.start();
    // Sample while the slow render is still running.
    await new Promise((r) => setTimeout(r, 60));
    const imagesDuringRender = image.started.length;
    expect(pdf.activeNow).toBe(1); // the render is genuinely still in flight

    expect(await harness.waitForDrain(30_000)).toBe(true);
    await harness.stop();

    expect(imagesDuringRender).toBeGreaterThan(0); // the whole point
    expect(image.completed).toHaveLength(40);
    expect(pdf.completed).toHaveLength(1);
  }, 45_000);
});

describe('multi-worker validation — 1, 2, 4 and 8 workers', () => {
  for (const workers of [1, 2, 4, 8]) {
    it(`${workers} worker(s): no duplicates, no losses, work distributed`, async () => {
      const harness = new LoadHarness({ workers, processors: processors() });
      const total = 600;
      generateWorkload(harness.broker, { counts: { [IMAGE]: total } });

      const started = Date.now();
      await harness.start();
      expect(await harness.waitForDrain(60_000)).toBe(true);
      const durationMs = Date.now() - started;
      await harness.stop();

      // NO LOST JOBS.
      expect(harness.broker.depth).toBe(0);
      expect(harness.broker.completedIds).toHaveLength(total);

      // NO DUPLICATE PROCESSING — the atomic-fetch guarantee, across every worker.
      const processed = allStarted(harness);
      expect(processed).toHaveLength(total);
      expect(new Set(processed).size).toBe(total);
      expect(harness.broker.concurrentDoubleDelivery()).toEqual([]);

      // CORRECT DISTRIBUTION — with more than one worker, the load is genuinely shared.
      const distribution = harness.broker.distribution();
      expect(Object.keys(distribution)).toHaveLength(workers);
      if (workers > 1) {
        for (const count of Object.values(distribution)) expect(count).toBeGreaterThan(0);
      }

      // RESOURCE ISOLATION — each worker has its own processors, metrics and lane accounting.
      for (const worker of harness.workers) {
        expect(worker.app.inFlight).toBe(0);
        expect(worker.concurrency.inFlight).toBe(0);
      }

      console.log(formatReport(harness.report(`${total} jobs · ${workers} worker(s)`, durationMs)));
    }, 90_000);
  }

  it('scales throughput as workers are added', async () => {
    // Enough per-job latency that scheduling, not overhead, dominates.
    const measure = async (workers: number): Promise<number> => {
      const harness = new LoadHarness({ workers, processors: processors(4) });
      generateWorkload(harness.broker, { counts: { [IMAGE]: 120 } });
      const started = Date.now();
      await harness.start();
      await harness.waitForDrain(60_000);
      const elapsed = Date.now() - started;
      await harness.stop();
      return elapsed;
    };

    const one = await measure(1);
    const four = await measure(4);
    // Four workers with four lanes each should be materially faster than one. The bound is loose on
    // purpose — this asserts that horizontal scaling WORKS, not a specific speedup on CI hardware.
    expect(four).toBeLessThan(one);
    console.log(`\n  horizontal scaling: 1 worker ${one}ms → 4 workers ${four}ms`);
  }, 120_000);
});
