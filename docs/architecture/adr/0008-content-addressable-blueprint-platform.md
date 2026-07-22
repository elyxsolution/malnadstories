# ADR-0008 — Content-addressable Blueprint Platform (model, compiler, identity)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Phase:** 7 (Blueprint Platform — the frozen Blueprint phase's model + compiler)
- **Deciders:** Chief Software Architect, Worker V2

## Context

The frozen Blueprint phase separates blueprint compilation from manifest generation (Rec 3).
This task-phase builds the blueprint MODEL: the immutable, deterministic representation of
everything that must be produced for an album — model + graph, declarative compiler,
validation, canonical serialization, hashing, versioning, and diff — with no rendering, no
execution, no storage. Decisions needed: (1) identity scheme, (2) how "stable identifiers" are
guaranteed, (3) what ordering is semantic vs canonical, and (4) the compiler's input boundary.

## Decision

**1. Blueprint identity = sha256 of the canonical serialization.** Canonical JSON (sorted keys,
semantic array order, no whitespace — `canonicalJson`, promoted to `@workerv2/utils`) is the
byte form; the hash is `sha256:<hex>`, BYTE-COMPATIBLE with the artifact platform's addressing
(ADR-0006) — proven by a test-only cross-check, not by import (`@workerv2/blueprint` has NO
storage dependency). A canonical blueprint stored as an artifact gets a storage key equal to
its own hash, so "blueprint as artifact" is free later.

**2. Stable ids are DERIVED, and validation enforces the derivation.** Every node id is exactly
its structural id (`album`, `cover`, `spread:NNNN`, `<parent>:placement:<slot>`,
`<parent>:text:NNNN`) — never random, never author-chosen. The validator rejects any id that
deviates (invariant I7), so ids are stable by construction even for blueprints arriving through
serialization — which is what makes the DIFF model (per-node comparison by id) meaningful
across recompilations.

**3. Ordering is explicitly split into semantic vs canonical.** Spread sequence and text order
are SEMANTIC (children array order; reordering changes identity). Placement declaration order
is NON-semantic: the compiler canonicalizes placements by slot, and validation enforces
sorted-slots + placements-before-texts, so equivalent sources always produce identical
identities. The node LIST is id-sorted (canonical); sequence lives only in `children`.

**4. One validation gate; the compiler routes its own output through it.** `validateBlueprint`
(invariants I1–I10: schema version, album id, unique/sorted ids, single album root, no dangling
references, tree containment + reachability, stable ids, contiguous spreads, slot rules,
normalized frames) is the only gate; `compileBlueprint` assembles the graph and then validates
it like any untrusted input — the compiler cannot emit an invariant-violating blueprint. The
compiler is entirely declarative: frames arrive resolved; it computes no layout, makes no
rendering decisions, executes nothing.

## Options Considered

1. **Content-addressed identity over canonical JSON; derived ids; single gate (chosen).**
2. **UUID blueprint ids + stored version counters.** Rejected: identity would depend on
   generation context, breaking determinism/reproducibility (INV-11 spirit) and dedupe.
3. **Author-chosen node ids.** Rejected: unstable across recompilations → diff becomes
   guesswork; derived ids make stability a theorem, not a convention.
4. **Depending on `@workerv2/artifact-store` for hashing.** Rejected: "no storage" is a phase
   requirement; local sha256 with a test-asserted format equality keeps the boundary clean and
   the compatibility guaranteed.
5. **Free-order children with order-insensitive hashing.** Rejected: spread/text order IS
   meaning in a photo album; hashing must respect it — so ordering semantics were made explicit
   instead.

## Consequences

- **Positive:** blueprints are reproducible, dedupable, diffable, and storable-as-artifacts by
  construction; the manifest phase (frozen Phase 7) gets a validated, immutable, versioned
  input; layout/template/theme resolvers (frozen Blueprint phase remainder) can later COMPILE
  INTO this model additively (resolvers produce `BlueprintSource`-shaped output).
- **Negative / trade-offs:** the node vocabulary (album/cover/spread/placement/text) is
  intentionally minimal — stickers, QR codes, and styling metadata are future ADDITIVE node
  kinds/fields behind a schema-version bump (which changes identities, by design); frame
  bounds forbid bleed overflow for now (pre-press bleed is a later, versioned change).
- **Follow-ups / remaining risks:** layout/template/theme RESOLVERS + catalogs (the frozen
  Blueprint phase's remaining half) and Blueprint/Template/Theme VERSION freezing into the
  version registry; the manifest builder consuming blueprints; schema-evolution policy
  (supporting parse of N-1 schema versions) when 2.0.0 arrives.

## Compliance

Framework-independent, immutable (deep-frozen), deterministic (no clock/randomness/env/IO —
verified), content-addressable (identity = canonical content only — tested: key order and
whitespace are irrelevant, every semantic change alters the hash), artifact-centric (placements
reference `StorageKey` identities only; file paths are structurally rejected). No execution, no
rendering, no storage. Upholds INV-1/INV-2 in spirit for blueprints (a blueprint is never
mutated — a change is a new identity) and INV-10 (content-derived, never-rewritten identity).
