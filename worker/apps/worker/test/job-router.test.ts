import { describe, it, expect } from 'vitest';
import type { Job } from '../src/job.js';
import { ProcessorRegistry, DuplicateProcessorError } from '../src/processors/registry.js';
import type { Processor } from '../src/processors/registry.js';
import { JobRouter, UnroutableJobError } from '../src/router.js';

function job(type: string, payload: unknown = {}): Job {
  return {
    id: `job-${type}`,
    type,
    payload,
    metadata: { correlationId: 'corr-1', attempt: 1 },
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    receivedAt: '2026-01-01T00:00:01.000Z',
  };
}

function recordingProcessor(type: string, sink: Job[]): Processor {
  return {
    type,
    process: async (j): Promise<void> => {
      sink.push(j);
    },
  };
}

describe('ProcessorRegistry', () => {
  it('starts empty (Phase I-1 registers processors at composition, not here)', () => {
    const registry = new ProcessorRegistry();
    expect(registry.types).toEqual([]);
    expect(registry.has('image-hardening')).toBe(false);
    expect(registry.resolve('image-hardening')).toBeUndefined();
  });

  it('registers and resolves processors by type', () => {
    const p = recordingProcessor('image-hardening', []);
    const registry = new ProcessorRegistry().register(p);
    expect(registry.has('image-hardening')).toBe(true);
    expect(registry.resolve('image-hardening')).toBe(p);
    expect(registry.types).toEqual(['image-hardening']);
  });

  it('rejects a duplicate registration for the same type', () => {
    const registry = new ProcessorRegistry().register(recordingProcessor('image-hardening', []));
    expect(() => registry.register(recordingProcessor('image-hardening', []))).toThrow(
      DuplicateProcessorError,
    );
  });

  it('sorts types for stable diagnostics', () => {
    const registry = new ProcessorRegistry()
      .register(recordingProcessor('r2-cleanup', []))
      .register(recordingProcessor('album-pdf', []));
    expect(registry.types).toEqual(['album-pdf', 'r2-cleanup']);
  });
});

describe('JobRouter', () => {
  it('dispatches a job to the processor resolved from the registry', async () => {
    const seen: Job[] = [];
    const registry = new ProcessorRegistry().register(recordingProcessor('image-hardening', seen));
    const router = new JobRouter(registry);
    const j = job('image-hardening', { photoId: 'p1' });

    await router.route(j);

    expect(seen).toEqual([j]);
  });

  it('throws UnroutableJobError when no processor is registered (fails loud, never black-holes)', async () => {
    const router = new JobRouter(new ProcessorRegistry());
    await expect(router.route(job('album-pdf'))).rejects.toBeInstanceOf(UnroutableJobError);
  });

  it('propagates a processor rejection to the caller (so the consume loop can nack)', async () => {
    const boom: Processor = {
      type: 'image-hardening',
      process: async (): Promise<void> => {
        throw new Error('processing failed');
      },
    };
    const router = new JobRouter(new ProcessorRegistry().register(boom));
    await expect(router.route(job('image-hardening'))).rejects.toThrow('processing failed');
  });
});
