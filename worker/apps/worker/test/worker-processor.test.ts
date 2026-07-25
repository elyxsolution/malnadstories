import { describe, it, expect } from 'vitest';
import { InMemoryStorageBackend, RecordingLogger } from '@workerv2/worker-runtime';
import { loadAppConfig } from '../src/config.js';
import { buildRuntime } from '../src/bootstrap.js';
import type { AppComponents } from '../src/bootstrap.js';
import { WorkerApplication } from '../src/main.js';
import type { Job } from '../src/job.js';
import type { QueueAdapter } from '../src/queue.js';
import { ProcessorRegistry } from '../src/processors/registry.js';
import type { Processor } from '../src/processors/registry.js';
import { ProcessorJobRunner } from '../src/processors/runner.js';
import { JobRouter } from '../src/router.js';
import { MemoryLogSink } from '../src/observability/index.js';

/** An in-memory QueueAdapter<Job> for the generic consume loop. */
class InMemoryJobQueue implements QueueAdapter<Job> {
  private readonly pending: Job[] = [];
  readonly acked: string[] = [];
  readonly nacked: string[] = [];
  enqueue(job: Job): void {
    this.pending.push(job);
  }
  async poll(): Promise<Job | null> {
    return this.pending.shift() ?? null;
  }
  async ack(id: string): Promise<void> {
    this.acked.push(id);
  }
  async nack(id: string): Promise<void> {
    this.nacked.push(id);
  }
}

function jobOf(type: string): Job {
  return {
    id: `job-${type}`,
    type,
    payload: {},
    metadata: { correlationId: 'c', attempt: 1 },
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    receivedAt: '2026-01-01T00:00:01.000Z',
  };
}

function buildWorker(processor: Processor): {
  app: WorkerApplication<Job>;
  queue: InMemoryJobQueue;
} {
  const config = loadAppConfig({ WV2_POLL_INTERVAL_MS: '5' });
  const { runtime, logger, observability } = buildRuntime(config, {
    logger: new RecordingLogger(),
    backend: new InMemoryStorageBackend(),
    sink: new MemoryLogSink(), // keep the app's own structured output out of the test console
  });
  const registry = new ProcessorRegistry().register(processor);
  const runner = new ProcessorJobRunner(new JobRouter(registry));
  const queue = new InMemoryJobQueue();
  const components: AppComponents<Job> = { runtime, queue, logger, runner, observability };
  return { app: new WorkerApplication<Job>(config, components), queue };
}

describe('generic worker consume loop (processor path)', () => {
  it('consumes a job, runs its processor, and ACKs', async () => {
    const seen: Job[] = [];
    const processor: Processor = {
      type: 'image-hardening',
      process: async (j): Promise<void> => {
        seen.push(j);
      },
    };
    const { app, queue } = buildWorker(processor);
    await app.start();
    queue.enqueue(jobOf('image-hardening'));

    expect(await app.processOnce()).toBe(true);
    expect(seen).toHaveLength(1);
    expect(queue.acked).toEqual(['job-image-hardening']);
    await app.stop('test');
  });

  it('NACKs when the processor throws a (transient) failure', async () => {
    const processor: Processor = {
      type: 'image-hardening',
      process: async (): Promise<void> => {
        throw new Error('transient');
      },
    };
    const { app, queue } = buildWorker(processor);
    await app.start();
    queue.enqueue(jobOf('image-hardening'));

    expect(await app.processOnce()).toBe(true);
    expect(queue.nacked).toEqual(['job-image-hardening']);
    expect(queue.acked).toEqual([]);
    await app.stop('test');
  });

  it('NACKs an unroutable job type (no processor registered)', async () => {
    const { app, queue } = buildWorker({ type: 'image-hardening', process: async () => {} });
    await app.start();
    queue.enqueue(jobOf('album-pdf')); // no processor for this type
    expect(await app.processOnce()).toBe(true);
    expect(queue.nacked).toEqual(['job-album-pdf']);
    await app.stop('test');
  });

  it('graceful shutdown DRAINS an in-flight job before stopping', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let finished = false;
    const processor: Processor = {
      type: 'image-hardening',
      process: async (): Promise<void> => {
        await gate;
        finished = true;
      },
    };
    const { app, queue } = buildWorker(processor);
    await app.start();
    queue.enqueue(jobOf('image-hardening'));
    app.begin();

    // let the loop pick up the job, then request shutdown while it is mid-flight
    await new Promise((r) => setTimeout(r, 20));
    expect(app.appState).toBe('processing');
    const stopping = app.stop('signal:SIGTERM');
    release();
    await stopping;

    expect(finished).toBe(true); // the in-flight job completed before stop resolved
    expect(queue.acked).toEqual(['job-image-hardening']);
    expect(app.appState).toBe('stopped');
  });
});
