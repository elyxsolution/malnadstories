# @workerv2/infra-contracts

The **infrastructure contracts + persistence foundation** — the abstraction layer that connects
the pure Worker V2 domain to future infrastructure **without any concrete implementation**. It is
where the persistence contracts deferred by ADR-0002 now live (see ADR-0004).

> **Scope (Phase 3).** Contracts (interfaces), persistence **DTOs**, concrete **outbound**
> mappers (domain → record), and **infra technical events**. **Not here:** any storage/database
> implementation, queue, coordinator, rendering, manifest, blueprint, or business logic.

## Dependencies & boundaries

Depends inward on the foundation leaves (`contracts`, `utils`, `errors`) and on
`@workerv2/control-plane` for **domain types** (aggregates/ids/audit) and the technical-event
model. The **domain never depends on this package** — infrastructure does not leak into the
domain (enforced by the boundary checker + the acyclic package graph).

## What's inside

- **Repositories** — `Repository<TAggregate, TId>` and typed aliases (`AlbumRepository`, …). They
  return **domain objects** only; DTOs never escape. Plus `RunStateQuery` (read side of INV-6) and
  the append-only `AuditSink` (INV-9).
- **Unit of Work / Transactions** — generic `UnitOfWork` (a transactional `RepositoryFactory`),
  `Transaction`, and `TransactionManager.withUnitOfWork(...)`. Generic on purpose: any persistence
  technology can implement them.
- **Repository factory** — `RepositoryToken` + `repositoryToken()` for generic resolution;
  well-known tokens `ALBUM_REPOSITORY` / `ASSET_REPOSITORY` / `RUN_REPOSITORY`.
- **DTOs** — `AlbumRecord` / `AssetRecord` / `RunRecord` / `AuditRecordDto`: flat, JSON-safe
  persistence models, explicitly distinct from domain aggregates.
- **Mappers (anti-corruption layer)** — the `RecordMapper<D, R>` contract, plus concrete
  **outbound** mappers `albumToRecord` / `assetToRecord` / `runToRecord` / `auditToRecord`. The
  **inbound** half (`toDomain`) is contract-only here — it needs a domain reconstitution path and
  is realized with the concrete adapters (a later phase).
- **Storage contracts** — `ArtifactStore` (write-once, content-addressed → INV-2/INV-10),
  `StorageKey`, `ContentAddressing`, `StorageAdapter`.
- **Adapter seams** — `PersistenceAdapter`, `StorageAdapter`: the top-level interfaces a concrete
  backend implements.
- **Infra technical events** — `INFRA_EVENTS` + `makeInfraEvent` (reusing the domain
  `TechnicalEvent` model, INV-12) + `TechnicalEventSink`.
- **Validation contracts** — `Validator<T>` + `valid`/`invalid` helpers.

## Guarantees

Domain-independent · explicit domain↔persistence mapping · no framework leakage · no
database-specific logic · no storage/queue implementation. Concrete adapters implement these
contracts in a later phase.
