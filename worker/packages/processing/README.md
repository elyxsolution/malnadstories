# @workerv2/processing

The Worker V2 **processing framework** — the generic, framework-independent **DECLARATIVE
processing model** (INV-5) that later rendering, PDF, image-processing, and manufacturing
pipelines execute. Pure data + pure functions: the framework **validates and compiles**
declarations; it never executes, schedules, waits, or retries anything.

> **Scope (task-phase 6 / the frozen Pipeline phase's declarative half).** Step model,
> pipeline model, execution-plan model, processing context, pipeline + DAG validation,
> declarative retry/timeout/cancellation/failure models, processor + pipeline contracts,
> capability requirements. **Not here:** coordinator, queue, worker execution, scheduling,
> rendering, image/PDF processing, manifest/blueprint generation, vendor integrations.

## Boundaries

Depends on the foundation leaves + `@workerv2/control-plane` (RunId/Timestamp value objects) +
`@workerv2/infra-contracts` (`StorageKey` — artifact-centric I/O). **Deliberately independent of
`@workerv2/runtime`**: `StepCapabilityRequirement` is structurally identical to the runtime's
`CapabilityRequirement` negotiation contract (compile-time-proven in tests), so any engine —
local, distributed, replay — consumes pipelines unchanged without importing the hosting
framework.

## Design

- **Artifact-centric.** Steps consume/produce **artifact identities** (content-addressed
  `StorageKey`s), never files. An input binds to a pre-existing artifact (`fromArtifact`) or to
  a named output of an upstream step (`fromStepOutput`) — resolved to a concrete identity by an
  engine at run time.
- **One constructor, all validation.** `definePipeline(spec)` is the only way a
  `ProcessingPipeline` exists: ids/version/slot shapes, policy validity, unique ids,
  unknown/self/duplicate dependencies, input bindings must reference **declared** outputs of
  steps the consumer **explicitly depends on**, and the graph must be a DAG. Deep-frozen.
- **Deterministic plans.** `compileExecutionPlan(pipeline)` is **total** (a pipeline can only
  exist validated) and deterministic: Kahn + lexicographic tie-breaking, stage-monotonic
  canonical order, stages = longest-dependency-chain levels (mutually independent within a
  stage). Declaration order never changes the plan.
- **Declarative policies.** `RetryPolicy` (+ pure `delayBeforeAttempt` math), `TimeoutPolicy`,
  `CancellationPolicy` (+ the `CancellationSignal` read-only contract), and the failure model
  (`FailureKind`/`StepFailure`/`FailurePolicy`). `planFailureAction` is the **shared pure
  decision function** — (failure, attempt, policies) → retry/fail/cancelled — so semantics can
  never drift between engines. Nothing is executed.
- **Processor contracts.** `Processor` (context → explicit `ProcessorOutcome`),
  `ProcessorDescriptor`, `ProcessorResolver`, and the shared `validateProcessorOutputs`
  conformance check (exact slot match). No processor ships here.
- **Context.** `makeProcessingContext` builds the immutable, fully-resolved per-attempt input:
  resolved artifact identities, expected outputs, config, frozen version pins (INV-11), and an
  **injected** `startedAt` — a processor reading only its context observes no ambient state.
