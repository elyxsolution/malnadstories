import { describe, it, expect } from 'vitest';
import { Pipeline } from '../src/processors/pipeline/pipeline.js';
import type { Stage } from '../src/processors/pipeline/pipeline.js';
import type { ProcessorEvent, ProcessorEventSink } from '../src/processors/pipeline/events.js';

class RecordingSink implements ProcessorEventSink {
  readonly events: ProcessorEvent[] = [];
  emit(event: ProcessorEvent): void {
    this.events.push(event);
  }
  get types(): string[] {
    return this.events.map((e) => e.type);
  }
}

interface Ctx {
  readonly trail: readonly string[];
}
type Deps = { readonly tag: string };

function stage(name: string): Stage<Ctx, Deps> {
  return {
    name,
    run: async (ctx, deps) => ({ trail: [...ctx.trail, `${name}:${deps.tag}`] }),
  };
}

const META = { processor: 'test-proc', correlationId: 'corr-1' };

describe('Pipeline', () => {
  it('runs stages in order, threading the context + injecting deps', async () => {
    const pipeline = new Pipeline([stage('a'), stage('b')], { tag: 'T' }, new RecordingSink());
    const out = await pipeline.run({ trail: [] }, META);
    expect(out.trail).toEqual(['a:T', 'b:T']);
  });

  it('emits the full lifecycle event sequence on success', async () => {
    const sink = new RecordingSink();
    await new Pipeline([stage('a'), stage('b')], { tag: 'T' }, sink).run({ trail: [] }, META);
    expect(sink.types).toEqual([
      'processor.started',
      'stage.started',
      'stage.completed',
      'stage.started',
      'stage.completed',
      'processor.completed',
    ]);
    expect(
      sink.events.every((e) => e.processor === 'test-proc' && e.correlationId === 'corr-1'),
    ).toBe(true);
  });

  it('emits stage.failed + processor.failed and rethrows on a stage error', async () => {
    const boom: Stage<Ctx, Deps> = {
      name: 'boom',
      run: async () => {
        throw new Error('kaboom');
      },
    };
    const sink = new RecordingSink();
    const pipeline = new Pipeline([stage('a'), boom, stage('c')], { tag: 'T' }, sink);

    await expect(pipeline.run({ trail: [] }, META)).rejects.toThrow('kaboom');
    expect(sink.types).toEqual([
      'processor.started',
      'stage.started', // a
      'stage.completed',
      'stage.started', // boom
      'stage.failed',
      'processor.failed',
    ]);
    const failed = sink.events.find((e) => e.type === 'stage.failed');
    expect(failed?.stage).toBe('boom');
    expect(failed?.error).toBe('kaboom');
  });
});
