# ADR-0002 — Control Plane: domain model first, persistence deferred

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** 1 (Control Plane & Domain Lifecycles)
- **Deciders:** Chief Software Architect, Worker V2

## Context

WBS 3 (Phase 1) groups the **Control Plane** work: the pure domain (Lifecycle Engine 3.1.2,
lifecycle definitions 3.1.3, event model 3.2.1, audit 3.2.2, version registry 3.2.3) **and** a
persistence-facing **State Store** (3.1.1) plus the persistence side of the **Run Registry**
(3.1.4).

The Phase 1 directive scopes this step to *"the complete framework-independent domain model"*
and explicitly forbids **Database, Repositories, Storage, Infrastructure, Adapters, APIs, and
File IO**. Persistence therefore cannot be built in this step. Splitting Phase 1's WBS into
"domain now / persistence later" is a scope refinement that, per the Engineering Playbook
(§12 SC-2, §18), is recorded here rather than absorbed silently.

## Decision

**Implement the Control Plane DOMAIN only** as the pure package `@workerv2/control-plane`:
value objects, state machines + the three lifecycles, aggregates (`Album`/`Asset`/`Run`),
domain events (technical vs domain), audit records, the `VersionSet` model, and the
one-active-run policy. Everything is framework-independent, immutable, deterministic, and
side-effect-free; it depends only on the foundation leaves (`contracts`, `utils`, `errors`).

**Defer the persistence adapters** — the **State Store** (durable storage of aggregate/audit
state, WBS 3.1.1) and the **Run Registry**'s persistent enforcement of one-active-run (WBS
3.1.4) — to the phase where infrastructure/adapters are permitted (Phase 2, Worker Runtime, and
beyond). The domain already defines the contracts those adapters will satisfy: the pure
`canStartRun` policy is the rule the persistent registry will enforce; the aggregates + audit
records are what the store will persist.

This split is the Playbook's own "Pure Domain Layer + isolated infrastructure" principle
(§4.1.3) applied to the phase boundary. It introduces no conflict with the ADS and changes no
invariant.

## Options Considered

1. **Domain-only now, persistence deferred (chosen).** Honors the Phase 1 directive and the
   pure-domain principle; the domain is fully testable in isolation; adapters slot in later
   against contracts that already exist.
2. **Build the State Store / Run Registry persistence now.** Rejected: directly violates the
   Phase 1 prohibition on DB/repositories/storage/adapters and would drag infrastructure into a
   step meant to be framework-independent.
3. **Skip the one-active-run rule until persistence exists.** Rejected: the *rule* (INV-6) is a
   domain policy and belongs in the domain now; only its *enforcement against durable state* is
   infrastructure. Modeling it now keeps the invariant first-class and testable.

## Consequences

- **Positive:** a clean, fully-tested source-of-truth domain; later persistence is additive
  (adapters over existing contracts), not a redesign; determinism/immutability are provable in
  isolation.
- **Negative / trade-offs:** the domain cannot yet be *persisted or queried* — no runtime uses
  it until Phase 2 wires adapters. Accepted: Phase 1 is explicitly the domain slice.
- **Follow-ups:** Phase 2+ introduces the State Store + persistent Run Registry as infrastructure
  adapters that satisfy the domain's contracts. No planning-suite architecture changes.

## Compliance

Upholds INV-6 (one-active-run policy, pure), INV-8 (this is the source-of-truth model), INV-9
(every transition emits an audit record), INV-11 (`Run` freezes its `VersionSet`), INV-12
(domain vs technical event families). No invariant is altered or weakened; persistence-time
invariants (durable audit, durable run-lock) are satisfied later by adapters over these
contracts.
