import type { ProcessorEvent, ProcessorEventSink } from './events.js';
import { NONE } from '../../recovery/cancellation.js';
import type { CancellationToken } from '../../recovery/cancellation.js';

/**
 * THE PIPELINE — the single, reusable execution model for every processor. A pipeline is an ordered
 * list of `Stage`s run over an immutable-by-replacement context, with typed dependencies injected once
 * and structured `ProcessorEvent`s emitted around the run and each stage. The image and PDF processors
 * both use it, so "how a multi-stage processor executes + reports progress" is defined in exactly one
 * place. The pipeline is domain-agnostic: it knows nothing about photos, albums, or failure taxonomies —
 * it runs stages, emits events, and rethrows the first stage error for the PROCESSOR to classify.
 *
 * CANCELLATION: the pipeline checks the token BEFORE each stage (a cancellation point every processor
 * gets for free) and passes it into `run` so a long stage (e.g. deleting many objects) can observe it
 * mid-flight. A cancelled run throws `CancellationError`, which the processor treats as retryable.
 */

/** One independently-testable stage: input context + injected deps → output context. */
export interface Stage<TCtx, TDeps> {
  /** Stage name (used for `stage.*` events + progress). */
  readonly name: string;
  run(ctx: TCtx, deps: TDeps, cancellation: CancellationToken): Promise<TCtx>;
}

/** Identity for one pipeline run (for event correlation). */
export interface PipelineRun {
  readonly processor: string;
  readonly correlationId: string;
  /**
   * The SUBJECT of this run (`{ photoId }`, `{ albumId }`) — small, stable identifiers merged into
   * every event the run emits. Added in Phase I-4 so the lifecycle events say WHAT they are about,
   * which is what let the processors stop hand-logging "image.ready photoId=…" alongside the
   * pipeline's own events. Purely additive: the pipeline still knows nothing about the domain, it
   * just carries an opaque bag it was handed.
   */
  readonly detail?: Readonly<Record<string, unknown>>;
}

export class Pipeline<TCtx, TDeps> {
  constructor(
    private readonly stages: readonly Stage<TCtx, TDeps>[],
    private readonly deps: TDeps,
    private readonly events: ProcessorEventSink,
  ) {}

  /**
   * Run the stages in order, threading the context through each and emitting lifecycle events. Rethrows
   * the first stage error (after emitting `stage.failed` + `processor.failed`) so the processor can map
   * it to a terminal/retryable outcome.
   */
  async run(
    initial: TCtx,
    meta: PipelineRun,
    cancellation: CancellationToken = NONE,
  ): Promise<TCtx> {
    const startedAt = Date.now();
    this.emit('processor.started', meta, {});
    let ctx = initial;
    for (const stage of this.stages) {
      cancellation.throwIfCancelled(); // cancellation point before every stage
      const stageStart = Date.now();
      this.emit('stage.started', meta, { stage: stage.name });
      try {
        ctx = await stage.run(ctx, this.deps, cancellation);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.emit('stage.failed', meta, {
          stage: stage.name,
          durationMs: Date.now() - stageStart,
          error: message,
        });
        this.emit('processor.failed', meta, { durationMs: Date.now() - startedAt, error: message });
        throw error;
      }
      this.emit('stage.completed', meta, {
        stage: stage.name,
        durationMs: Date.now() - stageStart,
      });
    }
    this.emit('processor.completed', meta, { durationMs: Date.now() - startedAt });
    return ctx;
  }

  private emit(
    type: ProcessorEvent['type'],
    meta: PipelineRun,
    extra: Partial<Pick<ProcessorEvent, 'stage' | 'durationMs' | 'error'>> & {
      detail?: Record<string, unknown>;
    },
  ): void {
    const detail =
      meta.detail === undefined && extra.detail === undefined
        ? undefined
        : { ...meta.detail, ...extra.detail };
    this.events.emit({
      type,
      processor: meta.processor,
      correlationId: meta.correlationId,
      at: new Date().toISOString(),
      ...extra,
      ...(detail === undefined ? {} : { detail }),
    });
  }
}
