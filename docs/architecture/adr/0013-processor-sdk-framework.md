# ADR-0013 — Processor SDK: a rendering-independent framework for building Artifact processors

- **Status:** Accepted
- **Date:** 2026-07-23
- **Phase:** 5/8 (Processor framework — enables the Image and Render processor phases; task-phase 12)
- **Deciders:** Chief Software Architect, Worker V2

## Context

The execution adapter (ADR-0012) INVOKES processors it is given; the processors themselves are
built in their own phases (image canonicalization, render/PDF, album assemble). Before writing
any concrete processor we need a reusable framework so every processor is built the same way,
stays independent of rendering technology and infrastructure, and comes with its test
scaffolding. This task-phase builds that Processor SDK, with hard constraints: it must implement
no concrete processor, no rendering, no PDF, no image processing; operate exclusively on
content-addressed Artifacts; assume no Cloudflare R2, no file-path APIs, and no storage
implementation; and processors built with it must remain transport- and infrastructure-neutral.

Decisions needed: (1) how a processor is defined and what runs around it; (2) how a processor
touches storage without depending on any storage implementation; (3) where progress,
diagnostics, cancellation, and deadlines live; (4) how failures surface; (5) how future
processors are tested.

## Decision

**1. A base processor with a consistent lifecycle; the author supplies only `execute`.**
`createProcessor(spec, deps)` is the single construction entry point. The author gives a
descriptor, optional `requiredInputs`/`validate`, and an `execute(ctx) → Record<slot, StorageKey>`
that TRANSFORMS Artifacts. The base runs the uniform lifecycle — report progress → validate
inputs → guard → execute → validate produced outputs against the declared slots (reusing the
engine's shared `validateProcessorOutputs`) — so every processor has the same shape, telemetry,
and output discipline. The SDK ships no `execute` of its own.

**2. Artifact access is a narrow SDK-owned port; storage is never assumed.** Processors read and
produce Artifacts through `ArtifactGateway` (`read(key)`, `exists`, `write(content) → key`) — a
byte- and content-address-oriented interface with NO file paths, URLs, or backend assumptions.
The SDK owns this minimal port rather than importing a concrete store, so a processor depends on
NO storage implementation; a host wires a gateway backed by the real content-addressed store, and
the SDK ships an in-memory reference only inside the test harness. Producing is content-addressed
and write-once, so identical bytes yield an identical key (idempotent).

**3. Progress, diagnostics, and resource guards are injected ports / cooperative checks.**
Progress (`ProgressReporter`) and diagnostics (`DiagnosticsSink`) are replaceable sinks (no
`console`), stamped with the attempt's identity. Cancellation and deadlines are `ResourceGuard`
cooperative checks a processor calls at safe points: cancellation is polled from the engine-owned
signal; the deadline is compared against an INJECTED clock — the SDK reads no ambient time and
arms no timer.

**4. Every failure becomes an in-band `StepFailure` outcome.** A guard trip, a validation abort
(`ProcessorAbort`), a produced-output mismatch, or an unexpected throw are all caught by the base
and turned into a `StepFailure` OUTCOME (`cancelled`/`timeout`/`permanent`/`transient`) — a
processor never lets an exception escape. Validation and config gates fail `permanent`; an
unexpected throw is conservatively `transient`. This matches the processing model's declarative
failure vocabulary so retry semantics stay the engine's.

**5. A comprehensive test harness ships with the SDK.** `ProcessorHarness` gives every future
processor its scaffolding: an in-memory content-addressed gateway (seed inputs, inspect produced
outputs), recording progress + diagnostics sinks, an optional injected clock + deadline, and one
`execute(spec, options)` that builds a `ProcessingContext`, runs the processor, and returns the
outcome, produced artifacts, progress, and diagnostics.

## Options Considered

1. **Base processor + narrow artifact port + injected sinks + guards + harness (chosen).**
2. **No framework — each processor implements `Processor.process` directly.** Rejected: every
   processor would re-implement input validation, output conformance, progress/diagnostics,
   cancellation, and failure normalization, guaranteeing drift and boilerplate.
3. **Reuse infra-contracts' full `ArtifactStore`/`StreamingArtifactStore` as the processor's
   storage surface.** Rejected as the processor-facing type: it is broader than a processor needs
   and pulls registry/provenance concerns into author code. A narrow `ArtifactGateway` keeps the
   processor surface tiny and storage-agnostic; a host adapts its store to it. (The SDK still uses
   `StorageKey`/`ArtifactKind` as contract TYPES.)
4. **Let processors throw for failures.** Rejected: the engine expects an in-band
   `ProcessorOutcome`; the base normalizes throws so a processor author cannot accidentally crash
   the driver, and failure KIND stays meaningful.
5. **Bake deadlines/timeouts into the SDK with real timers.** Rejected: timers are ambient and
   non-deterministic. Deadlines are cooperative checks against an injected clock; enforcement of
   hard timeouts remains the coordinator's (via `tick`) and the adapter's cancellation.

## Consequences

- **Positive:** the Image and Render processor phases can now be written as a small `execute` plus
  a descriptor, inheriting validation, progress, diagnostics, guards, failure semantics, and a
  test harness; processors are provably infrastructure- and rendering-neutral (grep + boundary
  verified); the SDK sits upstream of the engine (produces `Processor`s; depends on no
  coordinator/adapter/runtime), so there is no cycle.
- **Negative / trade-offs:** the SDK is intentionally minimal — no streaming artifact I/O yet
  (whole-bytes `read`/`write`; a streaming gateway is additive for very large artifacts), config
  schemas live with each processor (the SDK provides only the `requireConfig` gate, no schema
  library), and the in-memory harness gateway uses a non-cryptographic `mem:` address (a test
  double; real gateways use the platform's sha256 addressing).
- **Follow-ups / remaining risks:** concrete processors (image canonicalize/derive, surface
  render, album assemble) are the next phases and must stay within the SDK (no rendering leaks
  into the SDK itself); a host must wire the gateway to the real artifact store and provide the
  deadline resolver from the step's timeout policy; a streaming artifact port can be added
  additively when a processor needs it.

## Compliance

Framework-independent; strict TypeScript; full unit tests; boundaries enforced (depends only on
foundation + control-plane + infra-contracts CONTRACTS + processing). Operates exclusively on
content-addressed Artifacts — no file paths, no URLs, no R2/storage implementation, no rendering,
no PDF, no image processing (grep + boundary verified; the only `new Date` is a fixed,
deterministic default in the test harness — no ambient clock, no timer). Implements no concrete
processor and introduces no business logic. Reuses the processing model's `validateProcessorOutputs`
and `FailureKind` vocabulary rather than duplicating them.
