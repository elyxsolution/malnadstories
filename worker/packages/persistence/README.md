# @workerv2/persistence

The Worker V2 **persistence engine** — a concrete **State Store** implementing the Phase 3
infrastructure contracts (`@workerv2/infra-contracts`). This is the reference **in-memory**
engine; a durable backend (SQL, KV) implements the same contracts later without touching
anything above it.

> **Scope (Phase 4).** Repository implementations, Unit of Work + transactions, optimistic
> locking, the Run Registry (durable INV-6), audit + artifact-metadata persistence, and infra
> validation. **Not here:** queue, coordinator, runtime processing, rendering, manifest,
> blueprint, image/PDF engine, business orchestration, or worker execution.

## Boundaries

Depends on the foundation leaves + `@workerv2/control-plane` (domain, incl. the new
reconstitution API) + `@workerv2/infra-contracts` (contracts + mappers). **The domain never
depends on this package** — persistence stays domain-independent (enforced by the boundary
checker). Repositories return **domain aggregates** via the explicit mappers; **DTOs never
escape**, and reconstitution goes through the domain's `reconstitute` so **aggregate invariants
cannot be bypassed**.

## Design

- **Storage isolated from models.** `RecordTable<T>` (with `InMemoryRecordTable`) is the generic,
  domain-ignorant storage primitive — swap it for a durable one and the rest is unchanged.
- **Optimistic locking.** `TableTransaction` records the version each row was read at; `commit`
  validates every touched row is unchanged (else `ConcurrencyError`) then applies with the version
  incremented.
- **Unit of Work (atomic).** `InMemoryUnitOfWork` stages repository writes, audit appends, run
  reservations, and artifact-metadata writes; `commit` validates **all** guards (optimistic locks,
  INV-6, write-once) then applies **everything** atomically. `rollback` discards.
- **Run Registry (INV-6).** `RunRegistry.start(uow, run)` pre-checks the domain rule `canStartRun`
  and reserves the album's single active-run slot; the commit-time guard makes it durable.
- **Serialization symmetry.** Round-trip tests assert `save → load → save` is stable and
  aggregates survive the DTO boundary unchanged.
- **State Store facade.** `StateStore.transaction(work)` (full engine UoW) + `asPersistenceAdapter()`
  (the generic contract) + read-side queries (`runStatesForAlbum`, `auditLog`, `artifactMetadata`).

## Aggregate reconstitution

Reconstruction is **owned by the domain**: `Album/Asset/Run.reconstitute(snapshot)` rebuild an
aggregate from persisted state without emitting events and validate invariants. The inbound
mappers (`recordToAlbum` etc., in `infra-contracts`) parse value objects then delegate to these.
