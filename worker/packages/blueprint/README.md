# @workerv2/blueprint

The Worker V2 **Blueprint Platform** — the immutable, deterministic, **content-addressable**
representation of everything that must be produced for an album. Pure data + pure functions:
the platform compiles, validates, serializes, hashes, and diffs blueprints; it never executes,
renders, or stores anything.

> **Scope (task-phase 7 / the frozen Blueprint phase's model + compiler).** Blueprint model +
> graph, declarative compiler, validation (invariants I1–I10), canonical serialization,
> hashing/identity, schema versioning, diff model, contracts. **Not here:** rendering, PDF,
> image processing, manifest generation, layout/template/theme resolvers (future additive
> producers of `BlueprintSource`), coordinator/queue/scheduling, vendor integrations.

## Boundaries

Depends on the foundation leaves + `@workerv2/control-plane` (AlbumId) + `@workerv2/infra-contracts`
(`StorageKey` — placements reference **artifact identities**, never files). **No storage
dependency**: hashing is local sha256, byte-compatible with the artifact platform's addressing
(asserted by tests) — a canonical blueprint stored as an artifact gets a key equal to its own hash.

## Design

- **Model = a typed containment tree** rooted at the `album` node: optional `cover` first, then
  `spread`s in sequence; surfaces hold `placement`s (artifact + normalized frame) and `text`s.
- **Stable, DERIVED ids** (`album`, `cover`, `spread:NNNN`, `<parent>:placement:<slot>`,
  `<parent>:text:NNNN`) — enforced by validation (I7), never random — which is what makes the
  per-node **diff model** meaningful across recompilations.
- **Semantic vs canonical order.** Spread/text order is semantic (changes identity); placement
  declaration order is not (canonicalized by slot, enforced sorted). The node list is id-sorted.
- **One validation gate.** `validateBlueprint` enforces every invariant (schema version, unique/
  sorted ids, single album root, no dangling refs, tree + reachability, stable ids, contiguous
  spreads, slot rules, normalized frames). The compiler routes its own output through it — an
  invariant-violating blueprint is unrepresentable.
- **Canonical serialization + identity.** `serializeBlueprint` (canonical JSON) →
  `hashBlueprint` (`sha256:<hex>`). Identity depends ONLY on canonical content: incoming key
  order/whitespace is irrelevant (recomputed on parse), every semantic change alters the hash.
- **Compiler.** `compileBlueprint(source)` — entirely declarative (frames arrive resolved; no
  layout/rendering decisions) → deep-frozen `CompiledBlueprint { blueprint, hash, canonical }`.
- **Graph helpers.** `walkBlueprint` (deterministic DFS), `referencedArtifacts` (deduped,
  sorted), `totalPages`.
