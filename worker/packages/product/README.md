# @workerv2/product

The Worker V2 **Product Platform** — the immutable, versioned, **content-addressable** product
definition system. Pure data + pure functions: the platform defines, validates, serializes,
hashes, catalogs, and RESOLVES products; it never renders, computes layout, executes, or
stores anything.

> **Scope (task-phase 8 / the frozen Product phase's definition + resolution core).** Product
> model, versioned catalog, validation gates (P1–P10, C1–C5), canonical serialization,
> hashing/identity, constraints, capabilities, versioning (+ INV-11 pins), resolver contracts
>
> - the resolver chain (product + content → `BlueprintSource`), compatibility model.
>   **Not here:** processing-profile REGISTRY, pricing versions, vendor profiles (frozen Product
>   phase remainder — the compatibility matrix already names profiles as opaque tokens),
>   rendering, layout/template/theme engines, manifest generation, coordinator/queue/execution,
>   vendor integrations.

## Boundaries

Depends on the foundation leaves + `@workerv2/control-plane` (`VersionComponent` — INV-11
pins) + `@workerv2/blueprint` (the `BlueprintSource` source vocabulary ONLY). The dependency
direction is `product → blueprint`: **resolution produces the blueprint compiler's INPUT
(`BlueprintSource`), never a `Blueprint`**, and the Blueprint Platform stays fully independent
of catalog internals (no reverse import — boundary-enforced). No storage dependency: hashing
is local sha256, byte-compatible with artifact addressing (asserted by tests).

## Design

- **Model = immutable versioned definitions.** A `ProductDefinition` is one version of one
  product: stable lowercase-token id + semver + dimensions + page-count offering + material
  option axes + declarative constraints + capability requirements. Any change is a NEW
  version; the (id, version) pair names it, `hashProduct` (`sha256:<hex>` of canonical JSON)
  addresses its exact content.
- **One validation gate per shape.** `validateProduct` (P1–P10) / `validateCatalog` (C1–C5) /
  `validateCompatibilityMatrix` are the only ways the values exist; the validating
  constructors (`defineProduct` / `defineCatalog` / `defineCompatibilityMatrix`) canonicalize
  NON-semantic orderings (options by axis, values sorted, constraints by canonical form,
  capabilities by name, products by (id, version)), route through the gate, and deep-freeze.
- **Versioned catalogs.** A `ProductCatalog` is a value with its own semver; multiple versions
  of a product coexist; `getProduct` resolves exact-or-latest via deterministic `compareSemver`.
  `productVersionPins` bridges to the control plane's `VersionSet` (INV-11).
- **Resolution → `BlueprintSource`.** `resolveProduct(catalog, request, chain)`: catalog
  lookup → selection resolution (defaults + option-coupling constraints) → the RESOLVER CHAIN
  (the seam future layout/template/theme resolvers plug into; order semantic; resolvers must
  be pure) → the final source is structurally re-copied and RE-VERIFIED against the product
  (cover presence, page-count sum, per-spread limits) — the chain cannot escape the product's
  rules. Frames pass through untouched; no layout decision is ever made here.
- **Compatibility model.** A versioned, first-match rule matrix binding product (id/version or
  `*`) → compatible processing profiles (opaque tokens), required runtime capabilities
  (structurally = the runtime's negotiation shape), and blueprint schema versions.
  `checkCompatibility` returns a deterministic verdict with exact reasons.
