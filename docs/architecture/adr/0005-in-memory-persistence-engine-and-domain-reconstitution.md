# ADR-0005 — In-memory persistence engine + domain reconstitution API

- **Status:** Accepted
- **Date:** 2026-07-23
- **Phase:** 4 (Concrete State Store & Persistence Engine)
- **Deciders:** Chief Software Architect, Worker V2

## Context

Phase 4 implements the concrete **State Store / persistence engine** on the Phase 3 contracts,
resolving the deferrals of ADR-0002 (State Store / Run Registry) and ADR-0004 (concrete adapters +
the domain **reconstitution** path, flagged there as the top Phase-4 risk). Two questions needed
decisions: (1) which backend, and (2) how aggregates are reconstituted without letting repositories
bypass domain invariants.

## Decision

**1. The concrete engine is an in-memory REFERENCE engine.** No external database is provisioned,
and the earlier phases deliberately kept concrete infrastructure out. `@workerv2/persistence`
implements the Phase 3 contracts (repositories, `UnitOfWork`/`Transaction`/`TransactionManager`,
`PersistenceAdapter`, run-state query, audit + artifact-metadata persistence) fully in memory, with
**real** optimistic locking, atomic commit/rollback, and a durable one-active-run guard. A durable
backend (SQL/KV) later implements the **same contracts** with no change above it.

**2. Storage is isolated from persistence models.** The storage primitive is a generic,
domain-ignorant `RecordTable<T>` (`InMemoryRecordTable`). Repositories, mappers, the Unit of Work,
and the run registry sit above it and never assume in-memory storage — so the storage engine is
interchangeable (Phase-3 recommendation honored).

**3. Aggregate reconstruction is OWNED BY THE DOMAIN.** A `reconstitute(snapshot)` static was added
(additively) to `Album`/`Asset`/`Run` in `@workerv2/control-plane`. It rebuilds an aggregate from
persisted state **without emitting events** and **validates invariants** (title bounds, a legal
persisted status via the state machine). The aggregate constructor stays private; the inbound
mappers (`recordToAlbum` etc., in `infra-contracts`) parse value objects then delegate to
`reconstitute`. Therefore repositories **cannot** construct aggregates directly or bypass
invariants — a corrupt record surfaces as a `PersistenceError`, never a malformed aggregate.

**4. Optimistic concurrency + atomic Unit of Work.** `TableTransaction` records the version each
row was read at (identity map) and stages writes; `InMemoryUnitOfWork.commit` validates every
table's optimistic locks **plus** the INV-6 active-run guard and the write-once artifact guard, then
applies **all** changes atomically (or throws `ConcurrencyError`/`PolicyViolationError`/`StorageError`
and applies none). `rollback` discards.

## Options Considered

1. **In-memory reference engine now; durable backend later (chosen).** Testable, dependency-free,
   contract-faithful; a durable engine is a drop-in against the same contracts.
2. **Wire a real database (Postgres/Drizzle) now.** Rejected: no DB is provisioned, it would drag
   connection/config concerns into this step, and it is not needed to prove the engine's semantics
   (optimistic locking, UoW atomicity, INV-6) — which the in-memory engine demonstrates fully.
3. **Let repositories `new` aggregates or expose a public constructor for loading.** Rejected:
   that lets persistence bypass invariants. The domain-owned `reconstitute` keeps invariants in the
   domain (the task's explicit requirement).

## Consequences

- **Positive:** the top Phase-3 risk (reconstitution) is retired; persistence is real, atomic, and
  concurrency-safe; the domain stays persistence-independent; a durable engine is additive.
- **Negative / trade-offs:** the reference engine is not durable (state is process-local). Accepted
  — durability is a later backend swap; nothing above the `RecordTable` seam changes.
- **Follow-ups / remaining risks:** a durable backend implementation; cross-aggregate query
  patterns and pagination at scale; a real content-addressed byte store (`ArtifactStore`) to sit
  beside the artifact-metadata persistence built here.

## Compliance

Upholds INV-6 (durable one-active-run guard), INV-9 (append-only audit), INV-2/INV-10 (write-once
artifact metadata), and INV-8/INV-11 (aggregates — incl. the frozen `VersionSet` — round-trip
through persistence unchanged; reconstitution validates state, emits no events). The domain remains
the source of truth and never depends on persistence (verified). No invariant is altered.
