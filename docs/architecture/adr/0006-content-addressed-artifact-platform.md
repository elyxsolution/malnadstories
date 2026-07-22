# ADR-0006 — Content-addressed Artifact Platform (byte store, registry, provenance)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Phase:** 5 (Artifact Platform — completes the frozen Phase 3 / M5 byte store)
- **Deciders:** Chief Software Architect, Worker V2

## Context

ADR-0004/0005 delivered the storage **contracts** and the artifact **metadata** persistence but
deferred the concrete content-addressed **byte** `ArtifactStore` + `ContentAddressing` — the last
open piece of the frozen Storage & Immutable Artifact Platform (M5). This task-phase implements it:
addressing/hashing, write-once byte storage, streaming, integrity verification, an artifact
registry, artifact validation, and provenance metadata. Decisions needed: (1) the addressing
scheme, (2) where the replaceable-backend seam sits, (3) how write-once interacts with idempotent
re-writes of identical content, and (4) how artifacts become first-class immutable objects with
provenance rather than generic files.

## Decision

**1. Addressing is `sha256:<hex-digest>` of the bytes, and nothing else.** One algorithm, one
canonical key format (`Sha256ContentAddressing`, pinned by a published-constant test vector).
Identity derives from content alone, so it is deterministic and **independent of any storage
backend** (INV-10). The algorithm is namespaced into the key, so a future algorithm is additive,
never a mutation.

**2. The replaceable-backend seam is a raw `BlobStore` BELOW the guarantees.** `BlobStore`
(put/get/has/delete bytes by key; `InMemoryBlobStore` is the reference) is deliberately dumb — it
enforces nothing. Content addressing, write-once, integrity, and streaming all live in
`ContentAddressedArtifactStore` ABOVE the seam, so swapping in a durable object-storage backend
(e.g. R2) later changes no guarantee and no identity (WBS 5.1.1). A reusable contract suite
(`runArtifactStoreContract`) is provided for future backends to prove compliance.

**3. Write-once with idempotent content-derived writes.** `put(key, data)` enforces BOTH guards:
the key must hash-match its content (`IntegrityError` — a mis-addressed write can never enter the
store) and must not already exist (`StorageError`, INV-2). The content-derived entry points
(`putContent`, `putStream`) are **idempotent no-ops** for byte-identical content (INV-7): same
bytes ⇒ same identity ⇒ nothing is overwritten, so retries and duplicate deliveries are safe by
construction. Streaming hashes incrementally; chunking never changes identity.

**4. Artifacts are first-class immutable objects with recorded provenance.** `ArtifactDescriptor`
(key/algorithm/digest/size/content-type + `ArtifactProvenance`: **Run id, processing step, kind,
frozen version pins, source-asset lineage, injected `createdAt`**) is assembled in exactly one
place (`describeArtifact`) so identity fields can never disagree with the content. The
`ArtifactRegistry` is the write-once index (conflicting re-registration rejected; identical
re-registration a no-op; descriptors deep-frozen) with a `byRun` lineage query.
`validateArtifactDescriptor` is the untrusted-input boundary for rows read back from a durable
backend. Time is always injected via provenance — nothing in the platform reads the clock.

## Options Considered

1. **sha256 content addressing + dumb blob seam (chosen).** Deterministic, standard, backend-free
   identity; all guarantees testable above the seam.
2. **Identity/UUID-addressed keys with a separate hash column.** Rejected: keys would no longer be
   derivable from content, dedupe/idempotency would need extra state, and INV-10's "no mutable
   keys" would rest on discipline instead of construction.
3. **Strict-reject on ALL duplicate writes (including identical content).** Rejected: re-storing
   byte-identical content is not an overwrite (the stored bytes are unchanged by definition), and
   rejecting it would make every retry path (INV-7) carry its own existence-check ceremony.
4. **Provenance as free-form metadata on the stored blob.** Rejected: provenance is a typed,
   validated, first-class record (Run/VersionSet/Step) or it is unusable for lineage, rebuild, and
   the Version Matrix later.

## Consequences

- **Positive:** the frozen Phase 3 (M5) deliverable is complete — contracts, metadata persistence
  (ADR-0005), and now the byte platform; render/image phases get their artifact substrate; a
  durable backend is a one-seam swap proven by a reusable contract suite.
- **Negative / trade-offs:** the reference `BlobStore` is process-local (not durable) — accepted,
  same posture as ADR-0005; `putStream` buffers content in memory while hashing (fine for the
  reference engine; a durable backend can spool). Registry queries are linear scans — index later
  if needed.
- **Follow-ups / remaining risks:** a durable `BlobStore` (object storage) + a durable registry;
  wiring artifact writes to Asset Lifecycle transitions via the Control Plane (WBS 5.2.2 —
  storage-side transitions belong to the pipeline that produces artifacts); garbage/archival
  semantics for unreferenced artifacts (reserved).

## Compliance

Upholds INV-2 (write-once bytes + write-once registry), INV-10 (content-derived keys only, never
rewritten), INV-7 (idempotent content-derived writes/registrations), INV-11 (provenance records
the frozen version pins a run produced the artifact under), and the determinism discipline (time
injected; hashing pure). Storage introduces **no business logic** (verified: the package holds
only byte/hash/metadata mechanics; the domain never imports it — boundary-checked). Artifact
identity is storage-backend independent (tested across two backends).
