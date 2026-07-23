import type { JsonObject, JsonValue } from '@workerv2/contracts';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { RunId, Timestamp } from '@workerv2/control-plane';
import type { PipelineId, ProcessingContext, StepId } from '@workerv2/processing';
import type {
  ArtifactGateway,
  ArtifactWriteMeta,
  Clock,
  DiagnosticLevel,
  DiagnosticsSink,
  ProgressReporter,
  ProgressUpdate,
} from './contracts.js';
import { ResourceGuard } from './guards.js';
import { ProcessorAbort } from './errors.js';

/** The wired dependencies a `ProcessorContext` operates through (all host-provided). */
export interface ProcessorContextDeps {
  readonly artifacts: ArtifactGateway;
  readonly progress: ProgressReporter;
  readonly diagnostics: DiagnosticsSink;
  readonly clock?: Clock;
  /** The attempt's deadline, if the host derived one from the step's timeout policy. */
  readonly deadline?: Timestamp;
}

/**
 * The reusable PROCESSOR CONTEXT — the ergonomic execution surface a processor's `execute`
 * receives. It wraps the pure `ProcessingContext` (resolved input artifact identities, expected
 * outputs, config, frozen version pins, injected start time, cancellation) and the host-wired
 * ports, exposing everything a processor needs to TRANSFORM ARTIFACTS: read inputs, produce
 * outputs, report progress, emit diagnostics, and respect cancellation/deadlines — and nothing
 * that would couple it to rendering, storage, or transport.
 */
export class ProcessorContext {
  readonly guard: ResourceGuard;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(
    private readonly processing: ProcessingContext,
    private readonly deps: ProcessorContextDeps,
  ) {
    this.guard = new ResourceGuard(processing.cancellation, deps.deadline, deps.clock);
  }

  get runId(): RunId {
    return this.processing.runId;
  }
  get pipelineId(): PipelineId {
    return this.processing.pipelineId;
  }
  get stepId(): StepId {
    return this.processing.stepId;
  }
  get attempt(): number {
    return this.processing.attempt;
  }
  get config(): JsonObject {
    return this.processing.config;
  }
  get versions(): Readonly<Record<string, string>> {
    return this.processing.versions;
  }
  get startedAt(): Timestamp {
    return this.processing.startedAt;
  }
  get expectedOutputs(): readonly string[] {
    return this.processing.expectedOutputs;
  }

  // --- Artifact access (exclusively content-addressed) ---

  /** The resolved artifact identity bound to an input slot. Aborts (`permanent`) if absent. */
  input(slot: string): StorageKey {
    const key = this.processing.inputs[slot];
    if (key === undefined) {
      throw new ProcessorAbort('permanent', `Missing input artifact for slot "${slot}"`, { slot });
    }
    return key;
  }

  hasInput(slot: string): boolean {
    return this.processing.inputs[slot] !== undefined;
  }

  /** All bound input slot names. */
  inputSlots(): readonly string[] {
    return Object.keys(this.processing.inputs);
  }

  /** Read an input slot's artifact bytes. */
  async read(slot: string): Promise<Uint8Array> {
    return this.readKey(this.input(slot));
  }

  /** Read an artifact by content address (e.g. a key carried in config). */
  async readKey(key: StorageKey): Promise<Uint8Array> {
    try {
      return await this.deps.artifacts.read(key);
    } catch (error) {
      throw new ProcessorAbort('transient', `Failed to read artifact "${key}"`, {
        key,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async readText(slot: string): Promise<string> {
    return this.decoder.decode(await this.read(slot));
  }

  async readJson<T = JsonValue>(slot: string): Promise<T> {
    const text = await this.readText(slot);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProcessorAbort('permanent', `Input "${slot}" is not valid JSON`, { slot });
    }
  }

  /** Produce an artifact from bytes; returns its content address. */
  async produce(content: Uint8Array, meta?: ArtifactWriteMeta): Promise<StorageKey> {
    return this.deps.artifacts.write(content, meta);
  }

  async produceText(text: string, meta?: ArtifactWriteMeta): Promise<StorageKey> {
    return this.produce(this.encoder.encode(text), meta);
  }

  async produceJson(value: JsonValue, meta?: ArtifactWriteMeta): Promise<StorageKey> {
    return this.produceText(JSON.stringify(value), meta);
  }

  // --- Progress + diagnostics ---

  reportProgress(update: ProgressUpdate): void {
    this.deps.progress.report({
      runId: this.runId,
      stepId: this.stepId,
      attempt: this.attempt,
      ...update,
    });
  }

  debug(message: string, detail?: JsonObject): void {
    this.diagnostic('debug', message, detail);
  }
  info(message: string, detail?: JsonObject): void {
    this.diagnostic('info', message, detail);
  }
  warning(message: string, detail?: JsonObject): void {
    this.diagnostic('warning', message, detail);
  }
  error(message: string, detail?: JsonObject): void {
    this.diagnostic('error', message, detail);
  }

  private diagnostic(level: DiagnosticLevel, message: string, detail?: JsonObject): void {
    const at = this.deps.clock?.();
    this.deps.diagnostics.emit({
      runId: this.runId,
      stepId: this.stepId,
      attempt: this.attempt,
      level,
      message,
      ...(detail === undefined ? {} : { detail }),
      ...(at === undefined ? {} : { at }),
    });
  }
}
