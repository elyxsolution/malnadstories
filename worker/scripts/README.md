# scripts/ — repository automation

Repeatable engineering operations for the Worker V2 workspace.

- **`check-boundaries.mjs`** — authoritative architectural boundary + cycle enforcement
  (dependency direction, declared-deps, acyclic package graph). Run via `pnpm run boundaries`.

**Reserved DX seam (WBS 2.3.2 — Future / Phase 16):** developer-experience generators
(pipeline generator, plugin generator, package scaffolding) are reserved for a later phase and
will live here. None are implemented in Phase 0 — the seam is documented, not built.
