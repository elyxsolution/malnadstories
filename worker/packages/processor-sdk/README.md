# @workerv2/processor-sdk

The Worker V2 **Processor SDK** — the reusable framework future processors are built with to
execute Manifest work while staying **independent of rendering technologies**. A processor
written with this SDK reads and produces content-addressed **Artifacts**, reports progress, emits
diagnostics, and respects cancellation/deadlines — and nothing about it is coupled to a storage
backend, a transport, a renderer, or a file system.

> **Scope (task-phase 12).** Base processor abstraction + consistent lifecycle, a reusable
> processor context, artifact-access ports, progress reporting, diagnostics hooks, resource
> guards, validation helpers, and a comprehensive test harness. **Not here:** concrete
> processors, rendering, PDF generation, image processing, storage/R2 implementations, or file
> paths.

## What it is (and is not)

- **It is** the framework that turns a small author-supplied `execute` (transform input Artifacts
  → output Artifacts) into a fully-formed `@workerv2/processing` `Processor` — with a uniform
  lifecycle, progress/diagnostics, guards, and failure semantics wrapped around it.
- **It is not** any concrete processor. The image, render-PDF, and assemble processors are built
  in their own phases USING this SDK and injected into the engine's resolver. The SDK ships no
  rendering, PDF, or image code, and depends on no storage implementation.

## Design

- **Base Processor** (`createProcessor(spec, deps)`) — the single construction entry point. The
  author supplies a `descriptor`, optional `requiredInputs`/`validate`, and an `execute(ctx) →
Record<slot, StorageKey>`. The base runs the consistent **lifecycle** — report progress →
  validate inputs → guard → execute → validate produced outputs against the declared slots — and
  turns every failure (a guard trip, a validation abort, an unexpected throw) into a `StepFailure`
  OUTCOME, never an escaping exception. Output conformance reuses the engine's shared
  `validateProcessorOutputs`, so it can never drift.
- **Processor Context** (`ProcessorContext`) — the ergonomic execution surface `execute`
  receives, wrapping the pure `ProcessingContext`: `input(slot)` / `read` / `readText` /
  `readJson`, `produce` / `produceText` / `produceJson`, `reportProgress`, `debug`/`info`/
  `warning`/`error`, and a `guard`. Everything is byte- and content-address-oriented — no paths,
  no URLs.
- **Artifact access** (`ArtifactGateway`) — the read/produce port. Reading is by `StorageKey`;
  producing is content-addressed and write-once (identical bytes → identical key, idempotent).
  The implementation is the host's; the SDK ships an in-memory reference in the harness.
- **Progress + diagnostics** (`ProgressReporter` / `DiagnosticsSink`) — replaceable sinks; updates
  and events are stamped with the attempt's identity. No `console`.
- **Resource guards** (`ResourceGuard`) — cooperative `throwIfCancelled` / `throwIfExpired` /
  `check()`; cancellation is polled from the engine-owned signal, the deadline is compared against
  an **injected** clock (no ambient time, no timer). A trip becomes a `cancelled` / `timeout`
  failure.
- **Validation helpers** — `requireInputs`, `requireInput`, `requireConfig(parse)`, `ensure` — all
  failing via a `permanent` `ProcessorAbort`. Config schemas stay OUT of the SDK (no business
  logic); the processor supplies a pure parser.
- **Test harness** (`ProcessorHarness`) — a full rig for testing future processors with no real
  infrastructure: an in-memory content-addressed gateway (seed inputs, inspect produced outputs),
  recording progress + diagnostics sinks, an optional injected clock + deadline, and one
  `execute(spec, options)` that builds a `ProcessingContext`, runs the processor, and returns the
  outcome, produced artifacts, progress, and diagnostics.

## Boundaries

Depends on the foundation leaves + `@workerv2/control-plane` (`RunId`/`Timestamp`) +
`@workerv2/infra-contracts` (`StorageKey`/`ArtifactKind` **contracts only** — no storage impl) +
`@workerv2/processing` (the `Processor`/`ProcessingContext`/`StepFailure` contracts it implements
against). It depends on **no** coordinator, adapter, runtime, or storage implementation, and
nothing depends on it yet — concrete processor phases will.
