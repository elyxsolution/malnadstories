# ADR-0003 — Runtime dependency boundary & plugin framework scope

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** 2 (Worker Runtime Platform)
- **Deciders:** Chief Software Architect, Worker V2

## Context

Two points in the Phase 2 build merit a recorded decision:

1. **The runtime depends on `@workerv2/control-plane`.** The runtime needs a lifecycle state
   machine and needs to emit **technical events** (INV-12). Both mechanisms already exist in the
   domain package (the generic `defineStateMachine` engine and the `TechnicalEvent` model).
   A reviewer could reasonably ask why infrastructure depends on the domain package.

2. **"Plugin framework" scope.** The Phase 2 directive lists a *plugin framework*. The frozen WBS
   places a bare **plugin seam** in Phase 2 (4.3.1) and the **full plugin architecture** —
   concrete plugins (AI enhancement, OCR, video, vendor dispatch, …) — in Phase 16 (18.1.1).

## Decision

**1. Bounded inward dependency.** The runtime may depend on `@workerv2/control-plane`, but **only
for generic, product-agnostic contracts**: `defineStateMachine` (the runtime's own lifecycle) and
the technical-event contract (`TechnicalEvent`, `technicalEvent`, `makeEventId`, `makeTimestamp`).
It imports **no** domain aggregate, lifecycle, policy, or version-set. Direction is correct —
infrastructure depends inward on shared/domain contracts, never the reverse — and the runtime
introduces **no domain behavior**. (A grep guard + the package boundary checker back this up; the
technical-event model living in control-plane is a Phase-1 fact, not re-litigated here.)

**2. Framework now, plugins later.** Phase 2 builds the plugin **framework** — the registration
mechanism (`Plugin` / `PluginContext` / `applyPlugins`) by which a plugin additively contributes
services, capabilities, and DI bindings at build time. It builds **no concrete plugins** and no
plugin work-execution/sandboxing; those remain Phase 16 (18.1.1). This realizes the Phase 2
directive while leaving Phase 16 intact, and keeps plugins strictly additive.

## Options Considered

1. **Depend on control-plane for generic contracts; build the framework only (chosen).** Avoids
   duplicating the INV-12 technical-event contract, reuses the Phase-1 engine (validating its
   generality), and honors the directive without pre-empting Phase 16.
2. **Duplicate a technical-event type + a state-machine engine inside the runtime.** Rejected:
   duplicates a frozen contract, risks INV-12 divergence, and violates DRY.
3. **Ship only a bare plugin seam (literal WBS 4.3.1).** Rejected: the Phase 2 directive
   explicitly asks for a plugin *framework*; a bare seam would under-deliver.
4. **Build concrete plugins now.** Rejected: that is Phase 16 work and forbidden domain/product
   behavior in Phase 2.

## Consequences

- **Positive:** single source for the technical-event contract; the runtime is a clean host with
  a real (but plugin-free) extension mechanism; Phase 16 slots concrete plugins onto it additively.
- **Negative / trade-offs:** the runtime package now depends on the domain package. Accepted and
  bounded — usage is restricted to generic contracts and enforced by review + boundary checks.
- **Follow-ups:** Phase 16 implements concrete plugins on this framework. No planning-suite
  architecture change.

## Compliance

Upholds INV-4 (no worker-to-worker comms — the runtime hosts services; it adds no cross-worker
channel), INV-12 (reuses the technical-event stream contract; domain vs technical stay separate).
Introduces no domain behavior and alters no invariant. Deterministic startup (validated graph +
name-sorted ordering + injected time/ids) and immutable runtime metadata are honored.
