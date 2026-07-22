# @workerv2/artifact-store

The Worker V2 **Artifact Platform** — the concrete **content-addressed, write-once byte
`ArtifactStore`** implementing the Phase 3 storage contracts (`@workerv2/infra-contracts`),
plus the artifact **registry**, **integrity verification**, **streaming I/O**, **artifact
validation**, and **provenance** metadata. This is the reference **in-memory** engine; a
durable object-storage backend implements the same `BlobStore` seam later without touching
anything above it.

> **Scope (task-phase 5 / frozen Phase 3 byte store).** Content addressing + hashing,
> immutable write-once artifact bytes, registry, validation, streaming, integrity, provenance.
> **Not here:** rendering, manifest/blueprint generation, coordinator, queue, jobs,
> image/PDF processing, product platform, manufacturing — no business logic of any kind.

## Boundaries

Depends on the foundation leaves + `@workerv2/control-plane` (value objects referenced by
provenance) + `@workerv2/infra-contracts` (the contracts). **The domain never depends on this
package** (enforced by the boundary checker). Storage introduces **no business logic**: every
component is byte/metadata mechanics only.

## Design

- **Deterministic content addressing.** `Sha256ContentAddressing` derives `sha256:<hex>` keys
  from the bytes alone — identical content → identical identity, on any backend (INV-10).
- **Replaceable backend.** `BlobStore` (with `InMemoryBlobStore`) is the raw byte seam
  (WBS 5.1.1). A durable provider (e.g. private object storage) is a drop-in; identity,
  immutability, and integrity guarantees live ABOVE the seam and never change.
- **Write-once artifacts (INV-2).** `ContentAddressedArtifactStore.put` refuses overwrites
  (`StorageError`) and refuses content stored under a key it does not hash to
  (`IntegrityError`). `putContent`/`putStream` derive the key themselves and are **idempotent**
  for byte-identical content (INV-7) — same bytes ⇒ same identity ⇒ nothing is overwritten.
- **Streaming.** `putStream` hashes incrementally while consuming the stream; `getStream`
  yields bounded chunks. Chunking never changes identity.
- **Integrity.** `Sha256IntegrityVerifier` (and `getVerified`) recompute the address and
  detect corruption/mis-addressing (`IntegrityError`).
- **First-class immutable artifacts.** `describeArtifact(data, provenance, contentType?)`
  assembles the `ArtifactDescriptor` — identity (key/digest/size) can never disagree with the
  content; time is **injected** via `provenance.createdAt` (nothing reads the clock).
- **Provenance + registry.** `InMemoryArtifactRegistry` is the write-once index from content
  address → descriptor (Run, Processing Step, frozen version pins, source-asset lineage);
  conflicting re-registration is rejected, identical re-registration is a no-op, and stored
  descriptors are deep-frozen.
- **Validation.** `validateArtifactDescriptor` parses untrusted input (e.g. a raw registry row
  from a durable backend) into a typed, internally-consistent descriptor before it is trusted.
- **Facade.** `ArtifactPlatform` wires store + addressing + registry + verifier behind the
  Phase-3 `StorageAdapter` seam (backend injected via DI).

## Contract tests

`test/contract/artifact-store-contract.ts` exports `runArtifactStoreContract(name, factory)` —
the reusable suite ANY `StreamingArtifactStore` implementation must pass (write-once,
deterministic addressing, integrity-at-write, streaming equivalence, absent-key behavior).
A future durable backend imports it and passes its own factory.
