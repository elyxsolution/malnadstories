# @workerv2/control-plane

The Worker V2 **Control Plane domain** — the framework-independent, immutable, deterministic
model that is the platform's source of truth (INV-8). Depends only on the foundation leaves
(`@workerv2/contracts`, `@workerv2/utils`, `@workerv2/errors`); **no infrastructure, no I/O, no
persistence, no side effects, no ambient clock**. Time and identifiers are always injected.

> **Scope (Phase 1, ADR-0002):** this package is the _domain model only_. The persistence-facing
> **State Store** and **Run Registry** (WBS 3.1.1 / persistence side of 3.1.4) are deferred to a
> phase where infrastructure/adapters are permitted. The **one-active-run policy** here is the
> pure rule (INV-6); the runtime enforces it against real state later.

## What's inside

- **Value objects** — branded ids (`AlbumId`/`AssetId`/`RunId`/`ActorId`/`EventId`/`AuditId`,
  validated), `Timestamp` (injected, no `Date.now`), `Actor`, `DomainContext`.
- **State machines** — a generic `defineStateMachine` engine + the album / asset / run
  lifecycles (`ALBUM_MACHINE`, `ASSET_MACHINE`, `RUN_MACHINE`). Illegal edges return
  `TransitionError` via `Result`.
- **Aggregates** — `Album`, `Asset`, `Run`. Immutable; every operation returns a **new**
  aggregate plus the emitted `DomainEvent` and `AuditRecord` (never mutating in place). `Run`
  pins a `VersionSet` frozen for its whole life (INV-11).
- **Events** — `DomainEvent` (business) and `TechnicalEvent` (operational) as **separate**
  families with a `kind` discriminator (INV-12), plus guards.
- **Audit** — `AuditRecord` + `recordTransition` (every transition is audited — INV-9).
- **Version registry model** — `VersionSet` (validated, immutable, `require()` gate) and
  `VersionComponent` (the Version Matrix components).
- **Policies** — `canStartRun` (INV-6, pure).

## Invariants upheld

INV-6 (one active run — `canStartRun`), INV-8 (source-of-truth model), INV-9 (all transitions
audited), INV-11 (`Run` freezes its `VersionSet`), INV-12 (domain vs technical events separated).

## Purity contract

Every export is pure and deterministic: same inputs ⇒ same outputs, no globals, no clock, no
randomness, no I/O. This is what makes the domain testable in isolation and safe to build on.
