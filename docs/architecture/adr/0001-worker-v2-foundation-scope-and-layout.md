# ADR-0001 — Worker V2 foundation scope & repository layout

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** 0 (Foundation & Contracts)
- **Deciders:** Chief Software Architect, Worker V2

## Context

Phase 0 establishes the engineering foundation. Two forces required a recorded decision:

1. **Scope reconciliation.** The Phase 0 directive instructs the foundation to include generic
   abstractions for **Dependency Injection, logging, metrics, configuration, health, and
   feature flags**. The frozen WBS (`WORKER_V2_WBS.md`) assigns the *product-wired platforms*
   for several of these to later phases — the DI **container** and **configuration** to Phase 2
   (Worker Runtime, WBS 4.1.2/4.1.3), and **logging/metrics** to Phase 10 (Observability, WBS
   12.1.1/12.1.2). Building their abstractions now is therefore a scope refinement of the WBS
   and, per the Engineering Playbook (§12 SC-1/SC-2, §18), must be recorded in an ADR rather
   than silently absorbed.

2. **Repository layout.** Phase 0 must fix where Worker V2 platform code lives and how package
   boundaries are enforced, without any product knowledge (albums, rendering, manifests,
   blueprints, queues, storage, DB).

## Decision

**A. Scope — build generic foundations now, keep product platforms in their phases.**
Phase 0 delivers **product-agnostic, reusable abstractions + reference implementations** for:
DI container, logger, metrics, config/env, health, feature flags, errors, utils, contracts,
and build/version metadata. These contain **no product knowledge** and wire nothing.

The later phases retain ownership of the **product-wired platforms** that consume/extend these
foundations:
- Phase 2 (Runtime) wires the DI container and configuration into the runtime host and defines
  handler/capability wiring.
- Phase 10 (Observability) builds the full logging/metrics/tracing platform (correlation,
  sinks, cost, version matrix, business metrics) **on top of** these abstractions.

This is additive and non-conflicting: Phase 0 provides the seams; later phases provide the
product behaviour. No invariant changes; no ADS section is contradicted.

**B. Layout — an isolated pnpm workspace under `worker/`.**
Worker V2 is its own pnpm root under `worker/` (isolated from the Next.js app at the repo
root, as the reset placeholder anticipated), with:
- `packages/*` — the foundation libraries (`@workerv2/<name>`), each owning one capability.
- `apps/*`, `ops/`, `scripts/` — reserved (empty/placeholder in Phase 0; `scripts/` holds the
  boundary checker).
- Shared strict TypeScript (`tsconfig.base.json`), ESLint (flat) + Prettier, Vitest, and an
  **authoritative boundary/cycle checker** (`scripts/check-boundaries.mjs`).

**Dependency direction (enforced by the boundary checker):**
`contracts` (leaf) ← `utils`, `errors` ← `config`, `logger`, `metrics`, `health`, `flags`,
`di`, `build-info`. The graph is acyclic; nothing depends on product code.

## Options Considered

1. **Generic foundations in Phase 0 + product platforms later, recorded via ADR (chosen).**
   Satisfies the directive, keeps the WBS's later-phase ownership intact, and honours the
   Playbook's "no silent drift" rule. Clean seams, additive.
2. **Refuse the abstractions in Phase 0, follow the WBS literally.** Rejected: contradicts the
   explicit Phase 0 directive and would leave later phases without the shared engineering
   primitives the directive intends to front-load.
3. **Build full platforms now (correlated logging, runtime-wired DI/config).** Rejected: that
   *is* later-phase work, would require product/runtime knowledge Phase 0 forbids, and would
   violate "no working ahead."
4. **Locate packages at the repo root (`/packages`).** Rejected: risks the Next.js app
   compiling platform code and blurs the app/platform boundary (WBS §5.2). `worker/` isolation
   is cleaner and matches the reset placeholder.

## Consequences

- **Positive:** every later subsystem starts on a tested, boundary-enforced foundation;
  product platforms remain owned by their phases; the app/platform split is physical.
- **Negative / trade-offs:** the foundation carries reference implementations (console logger,
  in-memory metrics) that later phases will supersede with production sinks — intended, and
  marked as such in each package README.
- **Follow-ups / affected documents:** none to the frozen suite's *architecture*; this ADR
  records the Phase 0 scope. Progress + Changelog updated for Phase 0.

## Compliance

No architectural invariant (INV-1…12) is altered. The foundation is product-agnostic, so it
neither implements nor can violate the render/manifest/pipeline invariants. `deepFreeze`
(utils) and the immutable `BuildInfo`/config surfaces reinforce the immutability posture
(INV-1/INV-2 in spirit). The boundary checker enforces the acyclic dependency direction the
Playbook requires (§4.1.5).
