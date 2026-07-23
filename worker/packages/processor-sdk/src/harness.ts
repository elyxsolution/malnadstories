import type { JsonObject, JsonValue } from '@workerv2/contracts';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { RunId, Timestamp } from '@workerv2/control-plane';
import { makeRunId, makeTimestamp } from '@workerv2/control-plane';
import type { CancellationSignal, Processor, ProcessorOutcome } from '@workerv2/processing';
import { makePipelineId, makeProcessingContext, makeStepId } from '@workerv2/processing';
import type {
  ArtifactGateway,
  ArtifactWriteMeta,
  Clock,
  Diagnostic,
  DiagnosticsSink,
  ProgressReport,
  ProgressReporter,
} from './contracts.js';
import { createProcessor } from './base-processor.js';
import type { ProcessorDependencies, ProcessorSpec } from './base-processor.js';

/**
 * The PROCESSOR TEST HARNESS — a comprehensive, reusable rig for testing future processors
 * WITHOUT any real infrastructure. It provides an in-memory artifact gateway (seed inputs,
 * inspect produced outputs), recording progress + diagnostics sinks, an optional injected clock
 * and deadline, and one call that builds a `ProcessingContext`, runs the processor, and returns
 * everything worth asserting. Every future processor phase gets its test scaffolding for free.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A deterministic, dependency-free content address for the in-memory gateway (a TEST double —
 * `mem:<hex>`, not sha256; real gateways use the platform's content addressing). */
function memAddress(data: Uint8Array): StorageKey {
  let h1 = 0x811c9dc5;
  let h2 = (0x811c9dc5 ^ 0x9e3779b9) >>> 0;
  for (const byte of data) {
    h1 = Math.imul(h1 ^ byte, 0x01000193) >>> 0;
    h2 = Math.imul((h2 + byte) >>> 0, 0x85ebca77) >>> 0;
  }
  h1 = (h1 ^ data.length) >>> 0;
  const hex = h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  return `mem:${hex}` as StorageKey;
}

/** An in-memory, content-addressed `ArtifactGateway` — the reference storage double. */
export class InMemoryArtifactGateway implements ArtifactGateway {
  private readonly store = new Map<string, Uint8Array>();

  /** Seed an input artifact and return its content address. */
  seed(content: Uint8Array): StorageKey {
    return this.store_(content);
  }
  seedText(text: string): StorageKey {
    return this.store_(encoder.encode(text));
  }
  seedJson(value: JsonValue): StorageKey {
    return this.store_(encoder.encode(JSON.stringify(value)));
  }

  async read(key: StorageKey): Promise<Uint8Array> {
    const value = this.store.get(key);
    if (value === undefined) throw new Error(`No artifact for key "${key}"`);
    return new Uint8Array(value);
  }
  async exists(key: StorageKey): Promise<boolean> {
    return this.store.has(key);
  }
  async write(content: Uint8Array, _meta?: ArtifactWriteMeta): Promise<StorageKey> {
    return this.store_(content);
  }

  /** Synchronous read for assertions. */
  bytes(key: StorageKey): Uint8Array {
    const value = this.store.get(key);
    if (value === undefined) throw new Error(`No artifact for key "${key}"`);
    return new Uint8Array(value);
  }
  text(key: StorageKey): string {
    return decoder.decode(this.bytes(key));
  }
  json<T = JsonValue>(key: StorageKey): T {
    return JSON.parse(this.text(key)) as T;
  }
  get count(): number {
    return this.store.size;
  }

  private store_(content: Uint8Array): StorageKey {
    const key = memAddress(content);
    if (!this.store.has(key)) this.store.set(key, new Uint8Array(content));
    return key;
  }
}

/** A progress reporter that records every update. */
export class RecordingProgressReporter implements ProgressReporter {
  readonly reports: ProgressReport[] = [];
  report(report: ProgressReport): void {
    this.reports.push(report);
  }
}

/** A diagnostics sink that records every event. */
export class RecordingDiagnosticsSink implements DiagnosticsSink {
  readonly events: Diagnostic[] = [];
  emit(diagnostic: Diagnostic): void {
    this.events.push(diagnostic);
  }
}

/** Per-run inputs and identity for the harness. */
export interface HarnessRunOptions {
  /** Bound input slots (seed the artifacts first, e.g. via `harness.seedText`). */
  readonly inputs?: Readonly<Record<string, StorageKey>>;
  readonly config?: JsonObject;
  readonly expectedOutputs: readonly string[];
  readonly versions?: Readonly<Record<string, string>>;
  readonly attempt?: number;
  readonly startedAt?: Timestamp;
  readonly cancellation?: CancellationSignal;
  /** Optional injected clock + attempt deadline for guard tests. */
  readonly clock?: Clock;
  readonly deadline?: Timestamp;
  readonly runId?: string;
  readonly pipelineId?: string;
  readonly stepId?: string;
}

/** Everything worth asserting after a harness run. */
export interface HarnessResult {
  readonly outcome: ProcessorOutcome;
  readonly progress: readonly ProgressReport[];
  readonly diagnostics: readonly Diagnostic[];
  /** The produced slot→artifact map, when the outcome succeeded. */
  readonly outputs?: Readonly<Record<string, StorageKey>>;
  /** Read a produced output's bytes/text (throws unless the outcome succeeded with that slot). */
  outputBytes(slot: string): Uint8Array;
  outputText(slot: string): string;
}

function unwrapId<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(`harness id/context error: ${String(r.error)}`);
  return r.value;
}

/**
 * The harness: owns the in-memory ports, builds processors wired to them, and runs them.
 * `execute(spec, options)` is the full path (build + run + collect); `runProcessor` runs a
 * pre-built `Processor` (which must already be wired to these ports).
 */
export class ProcessorHarness {
  readonly artifacts = new InMemoryArtifactGateway();
  readonly progress = new RecordingProgressReporter();
  readonly diagnostics = new RecordingDiagnosticsSink();

  private deadline: Timestamp | undefined;
  private clock: Clock | undefined;

  seed(content: Uint8Array): StorageKey {
    return this.artifacts.seed(content);
  }
  seedText(text: string): StorageKey {
    return this.artifacts.seedText(text);
  }
  seedJson(value: JsonValue): StorageKey {
    return this.artifacts.seedJson(value);
  }

  /** Build a `Processor` from a spec wired to this harness's ports (+ its injected clock/deadline). */
  build(spec: ProcessorSpec, extra?: Partial<ProcessorDependencies>): Processor {
    const deps: ProcessorDependencies = {
      artifacts: this.artifacts,
      progress: this.progress,
      diagnostics: this.diagnostics,
      clock: (): Timestamp => this.clock?.() ?? (this.startedAtFallback as Timestamp),
      resolveDeadline: (): Timestamp | undefined => this.deadline,
      ...extra,
    };
    return createProcessor(spec, deps);
  }

  /** Build the spec and run it. */
  async execute(spec: ProcessorSpec, options: HarnessRunOptions): Promise<HarnessResult> {
    return this.runProcessor(this.build(spec), options);
  }

  /** Run a pre-built processor against a fresh `ProcessingContext`. */
  async runProcessor(processor: Processor, options: HarnessRunOptions): Promise<HarnessResult> {
    this.deadline = options.deadline;
    this.clock = options.clock;

    const context = unwrapId(
      makeProcessingContext({
        runId: this.id(makeRunId, options.runId ?? 'run-1') as RunId,
        pipelineId: unwrapId(makePipelineId(options.pipelineId ?? 'pipeline-1')),
        stepId: unwrapId(makeStepId(options.stepId ?? 'step-1')),
        attempt: options.attempt ?? 1,
        inputs: options.inputs ?? {},
        expectedOutputs: options.expectedOutputs,
        ...(options.config === undefined ? {} : { config: options.config }),
        ...(options.versions === undefined ? {} : { versions: options.versions }),
        startedAt: options.startedAt ?? this.defaultStartedAt(),
        ...(options.cancellation === undefined ? {} : { cancellation: options.cancellation }),
      }),
    );

    const outcome = await processor.process(context);
    const artifacts = this.artifacts;
    const outputBytes = (slot: string): Uint8Array => {
      if (!outcome.ok) throw new Error('run did not succeed');
      const key = outcome.value.outputs[slot];
      if (key === undefined) throw new Error(`no produced output for slot "${slot}"`);
      return artifacts.bytes(key);
    };
    return {
      outcome,
      progress: this.progress.reports,
      diagnostics: this.diagnostics.events,
      ...(outcome.ok ? { outputs: outcome.value.outputs } : {}),
      outputBytes,
      outputText: (slot: string): string => decoder.decode(outputBytes(slot)),
    };
  }

  private get startedAtFallback(): string {
    return this.defaultStartedAt();
  }

  private defaultStartedAt(): Timestamp {
    return unwrapId(makeTimestamp(new Date(Date.UTC(2026, 0, 1))));
  }

  private id<T>(
    make: (raw: string) => { ok: true; value: T } | { ok: false; error: unknown },
    raw: string,
  ): T {
    return unwrapId(make(raw));
  }
}
