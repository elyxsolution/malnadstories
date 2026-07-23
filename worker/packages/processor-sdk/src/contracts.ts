import type { JsonObject } from '@workerv2/contracts';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { ArtifactKind } from '@workerv2/infra-contracts';
import type { RunId, Timestamp } from '@workerv2/control-plane';
import type { StepId } from '@workerv2/processing';

/**
 * SDK CONTRACTS — the replaceable ports a host wires so processors stay INFRASTRUCTURE-neutral.
 * A processor written with this SDK reads and produces content-addressed Artifacts, reports
 * progress, and emits diagnostics THROUGH these interfaces — never against a concrete storage
 * backend, transport, or logger. The SDK ships in-memory reference implementations (in the test
 * harness); a real host injects its own (e.g. an artifact store backed by object storage).
 *
 * Everything here is byte- and identity-oriented: `StorageKey` (content address) + `Uint8Array`.
 * There are NO file paths, NO URLs, and NO storage-backend assumptions anywhere in the surface.
 */

/** Optional metadata a processor may attach when producing an artifact (never required). */
export interface ArtifactWriteMeta {
  readonly contentType?: string;
  /** The storage-neutral role the produced artifact plays (mirrors the Asset Lifecycle). */
  readonly kind?: ArtifactKind;
}

/**
 * The ARTIFACT ACCESS port — read an input artifact by its content address, or produce a new one
 * (content-addressed and write-once, so producing byte-identical content is idempotent and
 * returns the same key). This is the ONLY way a processor touches storage; the implementation is
 * the host's (memory, object storage, …) and is never assumed here.
 */
export interface ArtifactGateway {
  /** Read the bytes at `key`. Rejects if the artifact is absent. */
  read(key: StorageKey): Promise<Uint8Array>;
  exists(key: StorageKey): Promise<boolean>;
  /** Content-address + store `content`, returning its key. Idempotent for identical bytes. */
  write(content: Uint8Array, meta?: ArtifactWriteMeta): Promise<StorageKey>;
}

/** A progress update a processor emits (all fields optional; report what is meaningful). */
export interface ProgressUpdate {
  /** Overall completion in [0, 1]. */
  readonly fraction?: number;
  /** A coarse phase label (lifecycle phase or a processor-defined stage). */
  readonly phase?: string;
  readonly message?: string;
  /** Discrete progress (e.g. pages rendered) — `completed` of `total`. */
  readonly completed?: number;
  readonly total?: number;
}

/** A progress update stamped with the emitting attempt's identity. */
export interface ProgressReport extends ProgressUpdate {
  readonly runId: RunId;
  readonly stepId: StepId;
  readonly attempt: number;
}

/** The PROGRESS REPORTING port — where progress updates go (a bus, a log, a test collector). */
export interface ProgressReporter {
  report(report: ProgressReport): void;
}

export type DiagnosticLevel = 'debug' | 'info' | 'warning' | 'error';

/** A structured diagnostic a processor emits (no `console`; JSON-safe `detail`). */
export interface DiagnosticEvent {
  readonly level: DiagnosticLevel;
  readonly message: string;
  readonly detail?: JsonObject;
  /** When it occurred (stamped from the injected clock, if one is available). */
  readonly at?: Timestamp;
}

/** A diagnostic stamped with the emitting attempt's identity. */
export interface Diagnostic extends DiagnosticEvent {
  readonly runId: RunId;
  readonly stepId: StepId;
  readonly attempt: number;
}

/** The DIAGNOSTICS HOOK port — where structured diagnostics go. */
export interface DiagnosticsSink {
  emit(diagnostic: Diagnostic): void;
}

/** An injected time source for deadline guards — pure; the SDK arms no timer. */
export type Clock = () => Timestamp;
