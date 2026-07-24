# ADR-0019 — Worker Host: the single composition root & end-to-end album pipeline

- **Status:** Accepted
- **Date:** 2026-07-24
- **Phase:** 14 (Integration & End-to-End Validation — the executable composition root; task-phase 18)
- **Deciders:** Chief Software Architect, Worker V2

## Context

Every platform Worker V2 needs to manufacture an album now exists as an independent, boundary-clean
package: the Control Plane, Coordinator, Execution Adapter, Processor SDK, Image Backend + Image
Foundation Processors, Composition Engine, Document Assembly Platform, PDF Export Processor, Artifact
Store, and Persistence. What has been **deliberately absent** is any dependency wiring — no package
composes the others, by design (dependency inversion). This task-phase builds that wiring: the
**Worker Host**, the single composition root that constructs and connects all platforms into a
complete executable album-generation pipeline and drives it end to end.

Constraints from the objective: introduce **no** new business logic, rendering algorithm, document
format, or orchestration semantics — purely the composition root. It must construct all
dependencies; register processors, image backends, repositories, and artifact stores; configure
capability negotiation; execute complete Runs (Blueprint → Manifest → Coordinator → processors →
composition → Document → PDF export → PDF Artifact); produce final Artifacts; and surface
observational diagnostics. It must NOT implement rendering/PDF/business logic, modify Coordinator or
Processor SDK behavior, or introduce orchestration semantics. All dependencies injected — no global
singletons, no ambient state. Same input → same artifact identities. Replacing storage, backend, or
a processor must require changes **only** in the host.

Decisions needed: (1) where wiring lives; (2) how the fixed Manifest node names (`surface.render`,
`album.assemble`) get concrete processors without new algorithms; (3) how one artifact store serves
every seam; (4) how the PDF export stage fits (the Manifest has no PDF node); (5) how determinism +
diagnostics are provided without influencing execution.

## Decision

**1. One composition root; no wiring anywhere else.** `@workerv2/worker-host` is the ONLY package
that depends "outward" and performs construction. `WorkerHost` constructs the store, backend
registry, processor registry, capability negotiator, and persistence repositories, and injects them
explicitly (a small `ServiceRegistry` + constructor injection) — **no global singletons, no ambient
services, no hidden state** (two hosts are provably isolated). This preserves strict dependency
inversion: every other package stays wiring-free and independently testable, and nothing depends on
the host, so the graph stays acyclic.

**2. Thin adapter processors bind the Manifest's names to existing engines (no new algorithms).**
The Manifest compiler emits `surface.render` + `album.assemble` nodes. The host registers two thin
SDK processors: `surface.render` reads the blueprint input and drives the existing `CompositionEngine`
(ADR-0016) to produce the `page`; `album.assemble` reads the rendered pages and drives the existing
Document Builder (ADR-0017) to produce the `album` (Document). They contain NO rendering algorithm
and NO document format — they are composition-root glue that lets the Coordinator execute the
manifest. Registering a NAME→engine binding is wiring, not new semantics.

**3. One content-addressed store behind every seam.** A single `ContentAddressedStore` implements
BOTH the SDK `ArtifactGateway` and the image-backend `ArtifactBytesPort` (sha256 via the artifact
platform's `hashBytes`), so every processor, the composition engine, and the exporter share it and
all Artifact identities stay consistent. Writes are idempotent (content-addressed re-production is a
no-op). A canonical Blueprint/Manifest/Document stored here gets a key equal to its own content hash,
so the Manifest's `blueprint` binding resolves to the stored blueprint by construction. A durable
object-storage-backed store is a drop-in swap **here** — the whole point of the root.

**4. The PDF export is a host-orchestrated stage after the Manifest run.** The Manifest models
compose+assemble (→ Document); it has no PDF node (extending it would be new orchestration
semantics). So the run executor drives the Coordinator to the assembled Document, then applies the
registered `document.export.pdf` processor to that Document — a normal composition-root operation,
not new pipeline semantics. This mirrors the intended flow (Document → PDF Export → PDF Artifact)
without touching any prior phase.

**5. Deterministic execution + observational diagnostics.** The run is driven by a deterministic,
monotonically-advancing injected clock (no wall-clock reads), so dispatch order + duration are
meaningful and the run is reproducible; artifact identities are content-addressed and never depend on
the clock — the SAME input always yields the SAME PDF/Document identities. Diagnostics (summary,
execution order, produced artifacts, duration, retries, failures) are derived purely from the
Coordinator's post-run `ExecutionState`; they are **observational only** and never feed back into
execution.

**6. Backend selection lives in the host, by configuration.** A `BackendRegistry` holds multiple
`ImageBackend`s; the host selects one by `config.backendId` (the reference backend is canonical).
Processors never choose a backend — the composition adapter is handed whichever the host selected —
so a native/GPU backend is a drop-in that changes only host wiring, proven by a backend-replacement
integration test.

## Options Considered

1. **A dedicated composition-root package with thin adapter processors + one shared store (chosen).**
2. **Wire dependencies inside each platform (e.g. composition depends on image-backend concretely).**
   Rejected: destroys dependency inversion, couples platforms, and makes them un-swappable; the whole
   architecture is built so wiring lives in exactly one place.
3. **Add a PDF node to the Manifest so one Coordinator run produces the PDF.** Rejected: that changes
   the Manifest's orchestration semantics (out of scope) and couples the format-independent Document
   platform to PDF. The export is a separate registered processor the host applies.
4. **Put the surface.render/album.assemble processors in the composition/document packages.** Rejected:
   it would change those previous phases (composition deliberately has no processor-sdk dependency;
   the Document platform is export-unaware) — the adapters are host glue.
5. **Use the real write-once artifact-store as the shared store.** Rejected as the default: its
   write-once semantics reject idempotent content-addressed re-writes (identical bytes twice), which
   the gateways rely on; the host uses the artifact platform's ADDRESSING with an idempotent
   in-memory backing, and a durable store is a documented drop-in.

## Consequences

- **Positive:** a real album run executes end to end (Blueprint → PDF Artifact) with no change to any
  prior phase; the composition root is the single place to swap storage / backend / processors;
  determinism + artifact-identity stability hold across runs and hosts (test-proven); replay
  (rebuild) and resume (journal re-fold) reproduce identical artifacts; DI is explicit and hosts are
  isolated; diagnostics are rich yet observational; the host is provably wiring-only (grep + boundary
  verified) and nothing depends on it.
- **Negative / trade-offs:** the album Manifest exercises `surface.render` + `album.assemble` + the
  PDF export stage — the six image foundation processors are registered + negotiable but not part of
  this particular manifest's node set (an image-normalization sub-pipeline is additive future work);
  the shared store is in-memory (a durable backend is the documented drop-in); one-active-run (INV-6)
  enforcement via the Control Plane Run Registry is wired-but-not-gated (the repositories are
  registered; gating a session on the Run Registry is reserved); the deterministic clock advances
  synthetically (duration is relative, not wall-clock).
- **Follow-ups / remaining risks:** gate run creation on the Run Registry (INV-6); wire a durable
  store + distributed driving adapter (both drop-ins behind the existing seams); add an
  image-normalization pre-stage and richer manifests as the product grows; surface diagnostics
  through the observability platform when it lands.

## Compliance

Strict TypeScript; full integration tests (17 new; `pnpm verify` green — 679 total, 28 packages).
The single composition root: constructs + registers processors / image backends / repositories / the
artifact store, configures capability negotiation, executes complete Runs (Blueprint → Manifest →
Coordinator → composition → Document → PDF export → PDF Artifact), produces final Artifacts, and
surfaces observational diagnostics. Full DI — no globals, no ambient state (host isolation
test-proven). Deterministic: identical input → identical artifact identities; replay + resume
reproduce them. No rendering / PDF / image-processing / business logic; no Coordinator / Processor
SDK / orchestration change (grep + boundary verified). Backend selection lives in the host, not
processors. Boundaries: the host depends outward on every wired platform; nothing depends on it.
