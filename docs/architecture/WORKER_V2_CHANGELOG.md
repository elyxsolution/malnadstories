# Worker V2 — Changelog

> **Living document.** Records all Worker V2 changes in a semantic changelog structure.
> Complements (does not duplicate) the frozen planning suite and `WORKER_V2_PROGRESS.md`
> (which tracks *status*; this records *changes*).
> **Updated after every completed implementation phase / release.**

Sections: **[Planning](#planning)** · **[Implementation](#implementation)** · **[Release History](#release-history)**

---

## Planning

Frozen planning foundation (no code).

| Date | Document | Note |
|---|---|---|
| 2026-07-22 | Architecture Design Specification (ADS) | Architectural source of truth (26 sections + ADRs). |
| 2026-07-22 | `WORKER_V2_IMPLEMENTATION_GUIDE.md` | Execution discipline — principles, gates, DoD, workflow. |
| 2026-07-22 | `WORKER_V2_PHASES.md` | Phase plan — 18 phases, invariants, version matrix, milestones M1–M18. |
| 2026-07-22 | `WORKER_V2_WBS.md` | Work Breakdown Structure — single-capability work packages. |
| 2026-07-22 | `WORKER_V2_ENGINEERING_PLAYBOOK.md` | Operational engineering standards. |
| 2026-07-22 | `WORKER_V2_PROGRESS.md` · `WORKER_V2_CHANGELOG.md` | Living operational documents created. |

---

## Implementation

<!-- Newest first. One entry per phase (and per notable change) using the Change Entry Template. -->

### v0.0.0 — 2026-07-22 — Phase −1 · Worker Reset

**Added:**
- `worker/README.md` — placeholder marking the emptied worker area, awaiting the Phase 0 foundation.
- `docs/architecture/execution/PHASE_-1_EXECUTION_PLAN.md` — Phase −1 execution plan.
- `docs/architecture/execution/PHASE_-1_DEPENDENCY_INVENTORY.md` — WBS 1.1.1 deliverable (V1 surface, coupling, behaviors to re-home).
- Git tag `worker-v1-final` — rollback anchor at `d325f28` (complete V1 tree).

**Changed:**
- Root `tsconfig.json` — removed the now-dead `"worker"` entry from `exclude`.

**Removed:**
- The entire legacy **Worker V1** `worker/` tree: boot (`index.ts`), queue wiring (`queue.ts`), 6 jobs (`image-hardening`, `album-pdf`, `cover-thumbnail`, `blueprint-thumbnail`, `pdf-recovery`, `r2-cleanup`), libs (`image.ts`, `observability.ts`), infra (`env.ts`, `r2.ts`, `supabase.ts`, `health-server.ts`), and V1-specific toolchain/config (`package.json`, lockfiles, `pnpm-workspace.yaml`, `tsconfig.json`, `.env.example`, `.puppeteerrc.cjs`).

**Performance:** N/A (removal only).

**Security:** No secret/PII exposure; no security surface added. App-side data plane and secrets untouched.

**Documentation:** `WORKER_V2_PROGRESS.md` updated (Phase −1 → Done, M1 complete, stats/activity). Execution plan + dependency inventory authored.

**Testing:** App typecheck `npx tsc --noEmit` → exit 0. Verified: no legacy V1 file remains; no `src/**` import of `worker/`; no `worker` reference left in root `tsconfig.json`; CI/lint/package config unchanged (valid by preservation).

**Breaking Changes:** Background processing is paused until Worker V2 is delivered (enqueued jobs have no consumer). Intended reset consequence; no data loss. Tracked as risk RSK-1 in `WORKER_V2_PROGRESS.md`.

**Migration Notes:** None. Database (`pgboss` schema, `photos`/`album_pdfs` columns) intentionally untouched — reconciled in a later phase (no ad-hoc migration; Playbook SC-7).

**ADR References:** None (no architecture change; the reset is prescribed by the frozen Phase Plan).

**Commit References:** _(recorded at commit — branch `worker-v2/phase--1-worker-reset`)._

---

## Release History

_No releases yet._

<!-- Tagged releases (semantic Platform Version) recorded here, newest first. -->

---

## Change Entry Template

```
### <Platform Version> — <YYYY-MM-DD> — Phase <N> <Name>

**Added:**        —
**Changed:**      —
**Removed:**      —
**Fixed:**        —
**Performance:**  —
**Security:**     —
**Documentation:**—
**Testing:**      —
**Breaking Changes:** None
**Migration Notes:**  None
**ADR References:**   —
**Commit References:**—
```

---

## Versioning Policy

Semantic versioning `MAJOR.MINOR.PATCH`:
- **MAJOR** — incompatible public-contract change (ADR-gated).
- **MINOR** — backward-compatible capability added.
- **PATCH** — backward-compatible fix.

Worker V2 tracks **independent version streams** (see `WORKER_V2_PHASES.md` §5 — the Version Matrix).
Each is versioned and frozen per run (INV-11); a behaviour change requires a version bump + a changelog entry.

| Version stream | Scope | Frozen by |
|---|---|---|
| **Platform Version** | The overall Worker V2 release (tags, this changelog). | Release |
| **Worker Runtime Version** | Runtime host, DI, capability/handler contract. | Phase 2 |
| **Manifest Version** | Manifest schema (the render contract). | Phase 7 |
| **Blueprint Version** | Blueprint + template + theme resolution. | Phase 6 |
| **Image Engine Version** | Image validation/canonicalization/derivatives. | Phase 5 |
| **PDF Engine Version** | Render/PDF engine. | Phase 8 |
| **Product Version** | Product catalog + materials + pricing. | Phase 4 |
| **Theme Version** | Theme catalog. | Phase 6 |
| **Processing Profile Version** | Classic/Premium/Luxury/Archive/Draft render params. | Phase 4 |

> Component version bumps are recorded in the relevant phase's Implementation entry and reflected in
> each run's Version Matrix. The Platform Version advances only at a tagged release.

---

_This document is updated after every completed implementation phase / release._
