# ADR-0007 — Declarative processing framework (the pipeline model without an engine)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Phase:** 6 (Processing Framework — the frozen Pipeline phase's declarative half, INV-5)
- **Deciders:** Chief Software Architect, Worker V2

## Context

The frozen plan keeps pipelines DECLARATIVE (INV-5): a pipeline is data describing steps +
dependencies, interpreted by orchestration. Later platforms (image, blueprint/manifest,
render/PDF, manufacturing) all execute through this model, and the coordinator (frozen Phase 9)
interprets it. This task-phase builds the model itself — steps, pipelines, execution plans,
context, DAG validation, retry/timeout/cancellation/failure policies, processor + capability
contracts — with **no execution engine**. Decisions needed: (1) how the model stays consumable
by any engine, (2) how artifact-centricity is expressed, (3) where validation lives, and
(4) how far "declarative" reaches into retry/failure semantics.

## Decision

**1. The processing model does NOT depend on the runtime.** `@workerv2/processing` depends only
on the foundation leaves + `control-plane` (RunId/Timestamp value objects) + `infra-contracts`
(`StorageKey`). Capability requirements (`StepCapabilityRequirement`) are **structurally
identical** to the runtime's reserved `CapabilityRequirement` negotiation contract — proven by a
compile-time assignability test — instead of imported. Any engine (local, distributed, replay)
consumes pipelines without the hosting framework; the model is pure data.

**2. Artifact-centric I/O via content addresses.** Steps consume and produce ARTIFACT IDENTITIES
(`StorageKey`), never files/paths. An input binds either to a pre-existing artifact
(`fromArtifact(key)`) or symbolically to a named output of an upstream step
(`fromStepOutput(stepId, output)`), resolved to a concrete identity by an engine at run time.
The `ProcessingContext` hands processors fully-RESOLVED addresses; processors return produced
identities per output slot. Combined with the write-once store (ADR-0006), re-execution is
naturally idempotent (INV-7).

**3. One constructor, all validation, then total compilation.** `definePipeline(spec)` is the
ONLY way a `ProcessingPipeline` exists: ids/version/slot/policy validity, unique step ids,
unknown/self/duplicate dependencies, step-output inputs must reference **declared** outputs of
steps the consumer **explicitly** depends on, and the graph must be a DAG (Kahn). Because a
pipeline can only exist validated, `compileExecutionPlan` is **total and deterministic**
(lexicographic tie-breaking; stage = longest dependency chain; canonical order = stages
flattened) — declaration order never changes the plan, and engines never re-derive validity.

**4. Failure/retry/timeout/cancellation are declarative data PLUS one shared pure decision
function.** Policies are validated data; `delayBeforeAttempt` is pure math; nothing waits or
retries. The single interpretation point, `planFailureAction(failure, attempt, retry, policy) →
retry/fail/cancelled`, is shipped here so every future engine plans reactions identically —
semantics cannot drift between engines. `onPermanent` is locked to `fail` by type AND runtime
guard; `cancelled` is never configurable.

## Options Considered

1. **Pure declarative model, engine-independent, shared decision function (chosen).**
2. **Depend on `@workerv2/runtime` for capability types.** Rejected: drags the hosting framework
   into every consumer of the model; structural typing gives identical interoperability free.
3. **Ship a minimal local executor now.** Rejected: the task forbids it, and the coordinator
   (frozen Phase 9) owns execution; an engine here would prejudge scheduling semantics.
4. **Validate at execution time instead of definition time.** Rejected: every engine would
   re-implement validation (drift risk); definition-time validation makes invalid pipelines
   unrepresentable and compilation total.
5. **File-path based step I/O.** Rejected: violates artifact-centricity and INV-10; content
   addresses give identity, dedupe, and idempotent re-runs by construction.

## Consequences

- **Positive:** later platforms declare pipelines against a frozen, engine-neutral model; the
  coordinator phase shrinks to interpretation (scheduling/recovery) with validation and retry
  semantics already fixed; replay/rebuild (Rec 18) can consume identical plans.
- **Negative / trade-offs:** version-range MATCHING (`processorVersionRange`,
  `versionRange`) stays opaque/unevaluated — negotiation is deliberately deferred to the engine
  (the runtime's reserved `CapabilityNegotiator`); the `CancellationSignal` contract is defined
  but nothing drives it yet.
- **Follow-ups / remaining risks:** the coordinator/engine (frozen Phase 9) — scheduling, crash
  recovery, replay dispatch; a concrete capability negotiator; run-graph emission for the Run
  Explorer data model (frozen Phase 10).

## Compliance

Upholds INV-5 (pipelines are data; zero execution behavior — verified: no timers/clock/
randomness/env/I-O in the package), INV-7 (idempotency-friendly contracts; explicit attempts),
INV-10 (artifact identities only), INV-11 (context carries frozen version pins; pipeline version
is semver, pinnable per run). Framework-independent, immutable (deep-frozen constructions),
deterministic (injected time; order-invariant plans — tested). No business logic anywhere in the
package.
