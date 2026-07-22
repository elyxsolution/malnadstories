# worker/ — Worker V2 platform

Isolated **pnpm workspace** (its own root, separate from the Next.js app at the repo root) that
hosts the Worker V2 platform. Established in **Phase 0 (Foundation)**; the legacy Worker V1 was
removed in Phase −1 (rollback anchor: git tag `worker-v1-final`).

> **Phase 0 scope:** product-agnostic engineering foundation only. Nothing here knows about
> albums, rendering, manifests, blueprints, queues, databases, storage, or business logic. See
> `docs/architecture/adr/0001-worker-v2-foundation-scope-and-layout.md`.

## Layout

```
worker/
  packages/            Foundation libraries (@workerv2/*), one capability each
    contracts/         Shared types (neutral home)                 [no deps]
    utils/             Pure helpers (Result, invariants, objects)  [contracts]
    errors/            Typed error taxonomy                        [contracts]
    config/            Config framework + env validation           [contracts, errors, utils]
    logger/            Logging abstraction + impls                 [contracts]
    metrics/           Metrics abstraction + impls                 [contracts]
    health/            Health-check registry                       [contracts]
    flags/             Feature-flag framework                      [contracts]
    di/                DI container foundation                     [contracts, errors]
    build-info/        Version + build metadata                    [contracts]
  apps/                Reserved (no deployable app in Phase 0)
  ops/                 Reserved (runbooks/alerting later)
  scripts/             Repo automation (boundary checker; DX seam reserved)
```

## Commands

```bash
cd worker && pnpm install
pnpm run typecheck    # strict TS, whole workspace
pnpm run boundaries   # authoritative dependency-direction + cycle check
pnpm run lint         # ESLint (flat)
pnpm run format       # Prettier check
pnpm run test         # Vitest
pnpm run verify       # all of the above
```

**Dependency direction** (enforced by `scripts/check-boundaries.mjs`): `contracts` is a leaf;
`utils`/`errors` depend only on `contracts`; all other packages depend only on those. The graph
is acyclic and contains no product code.

**Planning source of truth:** `docs/architecture/` — ADS, Implementation Guide, Phase Plan, WBS,
Engineering Playbook, ADRs.
