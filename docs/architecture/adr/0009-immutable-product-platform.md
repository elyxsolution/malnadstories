# ADR-0009 — Immutable Product Platform (definitions, catalogs, resolution to BlueprintSource)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Phase:** 8 (Product Platform — the frozen Product phase's definition + resolution core)
- **Deciders:** Chief Software Architect, Worker V2

## Context

The frozen Product phase (WBS 6) demands a versioned domain catalog of what is manufactured,
with product/profile versions frozen per run (INV-11, Rec 2/4/15). The task-phase scope adds a
critical seam decision: product RESOLUTION must feed the Blueprint Platform **without coupling
the two** — blueprint identity must stay independent of catalog internals (Rec 3's separation).
Decisions needed: (1) the identity/versioning scheme for definitions and catalogs, (2) the
resolution boundary (what resolution produces and what it may never do), (3) how constraints
and capabilities are expressed, and (4) how cross-cutting compatibility is captured.

## Decision

**1. Product definitions are immutable values; identity is dual: (id, version) + content
hash.** A `ProductDefinition` carries a stable lowercase-token id and a semver; ANY change is a
new version. Content addressing (`hashProduct` = `sha256:<hex>` of canonical JSON, the same
byte format as artifact/blueprint identity — ADR-0006/0008) makes a definition's exact content
verifiable and dedupable; `productVersionRef` binds all three. `productVersionPins` bridges to
the control plane's `VersionSet` (INV-11) — a run pins the product version it resolved.

**2. One validation gate per shape; validating constructors canonicalize.** `validateProduct`
(invariants P1–P10), `validateCatalog` (C1–C5), and `validateCompatibilityMatrix` are the ONLY
ways the values exist. NON-semantic orderings (option axes, axis values, constraints,
capabilities, catalog product order) are canonicalized by `defineProduct` / `defineCatalog` and
ENFORCED sorted at the untrusted boundary — structurally-equal definitions always serialize
byte-identically, so identity is content-only. Everything is deep-frozen on construction.

**3. Resolution produces `BlueprintSource`, never a `Blueprint` — and the dependency points
product → blueprint only.** `resolveProduct(catalog, request, chain)` is a pure data
transformation: catalog lookup (exact or deterministic latest) → selection resolution (defaults
+ option-coupling constraints) → the RESOLVER CHAIN → a structural re-copy and a product-gate
RE-VERIFICATION (cover presence, page-count sum, per-spread limits) the chain cannot escape.
Frames pass through untouched: NO layout computation, NO rendering decision exists in the
package. The `SourceResolver` contract (pure, named + versioned, order-semantic) is the seam
the frozen Blueprint phase's future layout/template/theme resolvers plug into. The Blueprint
Platform is untouched and never imports product (boundary-enforced).

**4. Compatibility is a declarative, versioned first-match rule matrix.** Rules bind a product
(id/version or `*` wildcard) to compatible processing-profile ids (OPAQUE tokens — the profile
registry is a later deliverable), required runtime capabilities (structurally identical to the
runtime's negotiation shape, no import), and blueprint schema versions. `checkCompatibility`
returns a deterministic verdict with exact per-facet reasons; the matrix itself is canonical,
serializable, and content-hashable like every other Product Platform value.

## Options Considered

1. **Immutable versioned definitions + content addressing + resolution-to-source (chosen).**
2. **Mutable catalog records with update-in-place.** Rejected: breaks INV-11 reproducibility —
   a pinned "product v1.0.0" could silently change meaning; immutability makes the pin honest.
3. **Resolution produces compiled `Blueprint`s directly.** Rejected: would fuse the Product and
   Blueprint platforms, duplicate the blueprint validation gate, and couple blueprint identity
   to catalog internals; producing `BlueprintSource` keeps the compiler the single authority.
4. **Blueprint imports product contracts (blueprint → product).** Rejected: inverts the
   dependency and makes the blueprint model hostage to catalog evolution; the source vocabulary
   is the stable seam.
5. **Constraints as code (predicate functions on the definition).** Rejected: functions don't
   serialize, hash, or diff — constraints must be DATA to keep definitions content-addressable;
   evaluation is a pure interpreter over the constraint vocabulary.
6. **Semver-range matching in the compatibility matrix.** Rejected for now: range semantics
   introduce interpretation ambiguity into a canonical value; exact-or-wildcard is total,
   deterministic, and extensible to ranges later behind a schema-version bump.

## Consequences

- **Positive:** products are reproducible, dedupable, and pinnable by construction; the
  resolution seam gives the future layout/template/theme resolvers a typed, order-semantic
  chain contract; the compatibility matrix gives runs a deterministic pre-flight check across
  product × profile × runtime × blueprint-schema; a canonical definition/catalog/matrix can be
  stored as an artifact with key = its own hash.
- **Negative / trade-offs:** the constraint vocabulary is intentionally minimal (option
  coupling + per-spread content limits) — richer rules are ADDITIVE constraint kinds behind a
  product schema-version bump; the material taxonomy lives inside each definition (no global
  material registry yet); `compareSemver` is a deterministic total order, not full SemVer
  precedence (documented).
- **Follow-ups / remaining risks:** the frozen Product phase's remainder — processing-profile
  REGISTRY (profiles own render params, Rec 7), pricing versions, vendor-profile data — all
  slot in as further catalog-like immutable values; the compatibility matrix already names
  profiles so wiring the registry is additive. Version-registry freezing of product versions
  happens when runs start pinning (`VersionSet` bridge is ready).

## Compliance

Framework-independent, immutable (deep-frozen), deterministic (no clock/randomness/env/IO),
canonically serialized, content-addressable (`sha256:<hex>`, byte-compatible with ADR-0006/
0008), versioned (product semver + catalog semver + matrix semver + schema versions), stable
identifiers (token ids + content hashes). Resolution produces `BlueprintSource` only —
verified by tests that compile resolver output through the UNCHANGED blueprint compiler; no
rendering/layout behavior exists (frames pass through byte-identically, test-proven). Upholds
INV-11 (version pins) and INV-10 in spirit (content-derived identity, never rewritten).
