// @workerv2/processor-sdk — the reusable framework for implementing processors that execute
// Manifest work while staying independent of rendering technologies. Base processor abstraction
// + consistent lifecycle, a reusable processor context, artifact-access ports, progress
// reporting, diagnostics hooks, resource guards (cancellation/deadline), validation helpers, and
// a comprehensive test harness. Operates EXCLUSIVELY on content-addressed Artifacts. Implements
// NO concrete processor, NO rendering, NO PDF, NO image processing; depends on NO storage
// implementation and NO file-path API.

// --- Errors / aborts (the declarative failure path) ---
export { ProcessorAbort, abortPermanent, abortTransient } from './errors.js';

// --- SDK contracts (replaceable ports) ---
export type {
  ArtifactGateway,
  ArtifactWriteMeta,
  ProgressUpdate,
  ProgressReport,
  ProgressReporter,
  DiagnosticLevel,
  DiagnosticEvent,
  Diagnostic,
  DiagnosticsSink,
  Clock,
} from './contracts.js';

// --- Processor lifecycle ---
export type { ProcessorPhase } from './lifecycle.js';
export { PROCESSOR_PHASES } from './lifecycle.js';

// --- Resource guards ---
export { ResourceGuard } from './guards.js';

// --- Processor context (the reusable execution surface) ---
export { ProcessorContext } from './context.js';
export type { ProcessorContextDeps } from './context.js';

// --- Validation helpers ---
export { requireInputs, requireInput, requireConfig, ensure } from './validation.js';
// Output-slot conformance is the engine's shared rule — re-exported for convenience.
export { validateProcessorOutputs } from '@workerv2/processing';

// --- Base processor abstraction ---
export { createProcessor } from './base-processor.js';
export type { ProcessorSpec, ProcessorDependencies } from './base-processor.js';

// --- Test harness ---
export {
  ProcessorHarness,
  InMemoryArtifactGateway,
  RecordingProgressReporter,
  RecordingDiagnosticsSink,
} from './harness.js';
export type { HarnessRunOptions, HarnessResult } from './harness.js';
