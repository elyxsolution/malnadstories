# ADR-0004 — Phase 3 delivers infrastructure contracts, not implementations

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** 3 (Storage & Immutable Artifact Platform → Infrastructure Contracts & Persistence Foundation)
- **Deciders:** Chief Software Architect, Worker V2

## Context

The frozen Phase Plan's Phase 3 (WBS 5) is the **Storage & Immutable Artifact Platform** — a
*concrete* content-addressed, write-once artifact store plus asset-lifecycle transitions. The
Phase 3 directive, however, scopes the step to the **abstraction layer** — repository/UoW/
transaction/storage/adapter **interfaces**, DTOs, mappers, infra technical events, and validation
contracts — and explicitly forbids any **storage implementation, database logic, queue,
coordinator, rendering, manifest, blueprint, or business logic**.

Separately, ADR-0002 deferred the Control Plane's persistence (State Store / Run Registry) "to the
phase where infrastructure/adapters are permitted." Those persistence contracts need a home.

## Decision

**Phase 3 delivers `@workerv2/infra-contracts` — contracts + DTOs + concrete OUTBOUND mappers +
infra technical events — and NO concrete infrastructure.** Specifically:

- **Contracts (interfaces):** `Repository<T,Id>` (+ typed aliases), `RunStateQuery`, `AuditSink`,
  `RepositoryToken`/`RepositoryFactory`, generic `UnitOfWork`/`Transaction`/`TransactionManager`,
  `PersistenceAdapter`, `ArtifactStore`/`ContentAddressing`/`StorageAdapter`, `Validator<T>`,
  `TechnicalEventSink`, and the `RecordMapper<D,R>` mapping contract. This is where ADR-0002's
  deferred State Store / Run Registry contracts now live.
- **Concrete, pure, deterministic pieces only:** the persistence **DTOs**, the **outbound**
  mappers (`albumToRecord` etc. — the anti-corruption serialization half), `INFRA_EVENTS` +
  `makeInfraEvent`, and the validation helpers. None of these touch a database, storage backend,
  queue, or the network.

**The concrete Storage & Immutable Artifact Platform (the write-once store + content-address
hashing + asset-lifecycle transition persistence) and the persistence adapters are deferred** to a
later phase where infrastructure implementations are permitted. The interfaces here (with their
INV-2/INV-10/INV-9 obligations documented) are the contracts those adapters will satisfy.

**Inbound mapping (`toDomain`) is contract-only.** Reconstituting a domain aggregate from a record
requires a domain **reconstitution path** that the Phase-1 aggregates do not yet expose (their only
constructors are `create`/`transition`, which emit events). Rather than re-open the frozen domain
package from Phase 3, `RecordMapper.toDomain` stays an interface; concrete inbound mappers — and
the domain reconstitution they need — are built with the adapters. **This is the top risk carried
into Phase 4** (see below).

**Recommendation adopted:** capability **version-negotiation hooks** were added to the runtime as
**interfaces only** (`CapabilityRequirement`/`Offer`/`NegotiationResult`/`CapabilityNegotiator`),
additive and non-breaking.

## Options Considered

1. **Contracts-only now; adapters + concrete store later (chosen).** Matches the directive, keeps
   the domain infrastructure-independent, and lets multiple persistence technologies implement the
   same generic contracts. Additive and low-risk.
2. **Build the concrete artifact store + a persistence adapter now (literal WBS 5).** Rejected:
   the directive forbids storage/database implementation in this step.
3. **Add a domain reconstitution path in Phase 3 to enable concrete inbound mappers.** Rejected:
   that re-opens the frozen Phase-1 domain package for what is really adapter-time work; deferring
   keeps the phase boundary clean. Recorded as a Phase-4 risk instead.

## Consequences

- **Positive:** a clean, generic, technology-agnostic seam; the domain never learns about
  persistence; concrete adapters (Postgres, object storage) slot in later without reshaping these
  contracts; UoW is generic enough for multiple backends.
- **Negative / trade-offs:** repositories cannot yet load domain objects (no inbound mapper /
  reconstitution). Accepted and explicit; it is the first thing Phase 4 (or the persistence phase)
  must address.
- **Follow-ups / Phase-4 risks:** (a) add a domain **reconstitution** path + concrete inbound
  mappers; (b) implement the write-once `ArtifactStore` + `ContentAddressing`; (c) implement a
  `PersistenceAdapter` (State Store / Run Registry from ADR-0002) enforcing INV-6/INV-9 durably.

## Compliance

Upholds INV-8 (domain remains the source of truth; infra depends inward on it, never the reverse),
INV-9 (append-only `AuditSink`), INV-2 & INV-10 (the `ArtifactStore` contract mandates write-once,
content-addressed storage), INV-12 (infra technical events reuse the single technical-event model).
No invariant is altered; no infrastructure leaks into the domain (verified).
