# Phase −1 — Worker Reset · Execution Plan

> **Scope:** Phase −1 ONLY (Worker Reset). Do not begin Phase 0.
> **Governing documents (frozen):** ADS · `WORKER_V2_IMPLEMENTATION_GUIDE.md` ·
> `WORKER_V2_PHASES.md` (Phase −1) · `WORKER_V2_WBS.md` (WBS 1) · `WORKER_V2_ENGINEERING_PLAYBOOK.md`.
> **Milestone produced:** M1 — Clean Slate.
> **Date:** 2026-07-22

---

## 1. Objective

Establish a clean slate by fully retiring the legacy **Worker V1** implementation so that exactly
one processing platform exists going forward, and prepare the repository for the Worker V2 build.
Phase −1 is **repository preparation only** — no Worker V2 functionality is implemented.

## 2. Scope

**In scope**
- Inventory every live dependency on Worker V1 (WBS 1.1.1).
- Remove the entire legacy `worker/` V1 tree (WBS 1.1.2).
- Clean the one dangling repository reference to the removed tree.
- Leave the worker area emptied but present, awaiting the Phase 0 foundation.
- Create the rollback anchor tag (WBS 1.1.3).

**Explicitly out of scope** (deferred to later phases; see Stop Conditions §11)
- Any Worker V2 code: Runtime, Control Plane, Infrastructure, Manifest, Blueprint, Rendering, Image Processing, PDF — none of it.
- Deleting the **app-side** enqueue module or its call sites (`src/lib/queue.ts` and consumers) — these are **app** code, inventoried for intentional **re-homing** in Worker V2 (WBS 1.1.1), not removed here (removal would cascade-break the live app build).
- Any database / migration change (the `pgboss` schema and V1-related columns remain; touching them is a Stop-and-Design event — Playbook SC-7).
- Editing `CLAUDE.md` or the planning suite (frozen; changes are ADR-gated).

## 3. Referenced ADS Sections

- ADS — Migration / Cutover context (retirement of the legacy worker).
- ADS — Worker platform overview (the "one authoritative platform" principle that motivates deletion).

## 4. Referenced WBS Work Packages

- **WBS 1.1.1 — V1 Dependency Inventory** (deliverable: `PHASE_-1_DEPENDENCY_INVENTORY.md`).
- **WBS 1.1.2 — V1 Removal** (delete the V1 tree; clean dead paths).
- **WBS 1.1.3 — Rollback Anchor** (annotated tag capturing the last V1 state).

## 5. Referenced Phase Plan Sections

- `WORKER_V2_PHASES.md` → **Phase −1 (Worker Reset)** — Purpose, Objectives, Deliverables, Acceptance Criteria, DoD, Review Checklist, Milestone M1.
- `WORKER_V2_PHASES.md` §3 — Architectural Invariants (none are *implemented* here; none may be *violated*).
- `WORKER_V2_IMPLEMENTATION_GUIDE.md` §4.2 — Why Worker V1 will be deleted.

## 6. Repository Areas Affected

| Area | Effect |
|---|---|
| `worker/` (entire tree) | **Removed** (V1 implementation + V1-specific toolchain/config). |
| `worker/README.md` | **Created** — placeholder marking the emptied, reset worker area. |
| `tsconfig.json` (root) | **Changed** — remove the now-dangling `"worker"` entry from `exclude`. |
| `docs/architecture/execution/` | **Created** — this plan + the dependency inventory. |
| `git` refs | **Tag added** — `worker-v1-final` rollback anchor. |
| App (`src/`), root tooling, CI, lint, drizzle | **Untouched** (preserved). |

## 7. Files to Remove

The complete `worker/` V1 tree:

```
worker/.env.example
worker/.puppeteerrc.cjs
worker/package.json
worker/package-lock.json
worker/pnpm-lock.yaml
worker/pnpm-workspace.yaml
worker/tsconfig.json
worker/src/env.ts
worker/src/health-server.ts
worker/src/index.ts
worker/src/queue.ts
worker/src/r2.ts
worker/src/supabase.ts
worker/src/jobs/album-pdf.ts
worker/src/jobs/blueprint-thumbnail.ts
worker/src/jobs/cover-thumbnail.ts
worker/src/jobs/image-hardening.ts
worker/src/jobs/pdf-recovery.ts
worker/src/jobs/r2-cleanup.ts
worker/src/lib/image.ts
worker/src/lib/observability.ts
worker/node_modules/**   (installed deps — removed with the tree)
```

Plus the dead reference: the `"worker"` entry in root `tsconfig.json` `exclude`.

## 8. Files to Preserve

Everything outside `worker/`. Explicitly:
- **Repository scaffolding & package management** — root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`.
- **Build tooling** — `next.config.mjs`, root `tsconfig.json` (edited only to drop the dead `worker` exclude), `postcss.config.mjs`, `tailwind.config.ts`, `drizzle.config.ts`.
- **CI/CD** — `.github/workflows/secret-scan.yml` (no worker references; untouched).
- **Lint/format** — `.eslintrc.json`, `.gitleaks.toml`.
- **Environment examples** — root `.env.example`.
- **Documentation** — `CLAUDE.md`, `docs/**` (the planning suite + this execution folder), `README.md`.
- **The entire application** — all of `src/**`, including the **app-side enqueue module** `src/lib/queue.ts` and its consumers (inventoried, re-homed in V2 — not removed here).
- **Database assets** — `drizzle/**` (no migration change in Phase −1).

## 9. Files to Create

1. `docs/architecture/execution/PHASE_-1_EXECUTION_PLAN.md` — this document.
2. `docs/architecture/execution/PHASE_-1_DEPENDENCY_INVENTORY.md` — the WBS 1.1.1 deliverable.
3. `worker/README.md` — placeholder marking the worker area as reset and awaiting the Phase 0 foundation.

> **No Worker V2 implementation folders are created** — WBS 1.1 Expected Folder Structure and
> `WORKER_V2_PHASES.md` Phase −1 both state explicitly: *"no V2 folders yet."* The Foundation
> (Phase 0) establishes V2 repo structure.

## 10. Implementation Strategy

Sequenced, low-risk, reversible-by-tag:

1. **Anchor first.** Create the annotated rollback tag `worker-v1-final` at the pre-deletion `HEAD` (WBS 1.1.3) — done before any change.
2. **Inventory.** Produce the dependency inventory documenting V1 files, the one-directional coupling, and every app-side behavior to re-home (WBS 1.1.1).
3. **Remove.** Delete the entire `worker/` tree (WBS 1.1.2).
4. **Clean the dead path.** Remove `"worker"` from root `tsconfig.json` `exclude`.
5. **Re-mark the area.** Add `worker/README.md` so the emptied worker area remains present and git-tracked.
6. **Verify** (§13) and **commit** using the Playbook convention (§5.2).

**Key facts that make this safe (from the inventory):**
- Coupling is **one-directional** — the worker imports the app's builder (`@builder/*` → `../src/lib/builder/*`); **no app file imports from `worker/`**. Removing `worker/` cannot break the app build.
- The worker is its **own pnpm root** (not in the root workspace); CI and root `package.json` have **no** worker references — so removal touches no root tooling.

## 11. Risk Analysis

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Removing V1 breaks the app build via a hidden import. | Very Low | High | Verified **no** `src/**` file imports from `worker/` (one-directional coupling). |
| R2 | Removal breaks root tooling / workspace / CI. | Very Low | High | Verified worker is a standalone pnpm root; no root/CI worker references. |
| R3 | **Runtime processing stops** (uploads stay "pending", PDFs/thumbnails not generated) because enqueued jobs have no consumer. | Certain | Medium | **Intended, known consequence** of the reset (Guide §4.2). App enqueues still succeed; no data loss. Restored when Worker V2 is delivered. Documented in the inventory. |
| R4 | Over-deletion of app-side enqueue cascades into live-app breakage. | Low | High | **Avoided by scope**: app-side `src/lib/queue.ts` + consumers are **preserved** and inventoried for re-homing, not deleted. |
| R5 | Accidental removal of shared/preserved assets. | Low | Medium | Removal is bounded to `worker/`; §8 enumerates preserved assets; tag `worker-v1-final` enables full restore. |
| R6 | Loss of V1 code needed as a reference during V2. | Low | Low | Nothing is lost — `worker-v1-final` (and git history) preserve the complete V1 tree. |

## 12. Rollback Strategy

- **Primary:** the annotated tag **`worker-v1-final`** (at `d325f28`) captures the complete V1 tree. Restore V1 with `git checkout worker-v1-final -- worker/` (and revert the `tsconfig.json` exclude), or reset to the tag.
- **Secondary:** standard git revert of the Phase −1 commit (history preserved; no force operations).
- Rollback is **retrieval, not reconstruction** (Playbook §10.5) — V1 is fully recoverable at any time.

## 13. Testing Strategy

Phase −1 is removal + preparation; verification proves the repository remains intact (Playbook §6 minimum for this WP is Minimal, focused on integrity):

1. **No legacy remains** — `worker/` contains only the new `README.md`; no V1 source/config files remain.
2. **No dangling references** — no `src/**` import of `worker/`; root `tsconfig.json` no longer references `worker`; CI/root config unchanged.
3. **Repository builds / typechecks** — run the app typecheck (`npx tsc --noEmit`) and `next lint`; confirm no **new** failures attributable to the reset (pre-existing, unrelated issues, if any, are reported honestly, not "fixed" in this phase).
4. **Tooling works** — package management, lint config, and CI config are unchanged and valid by preservation.
5. **Documentation links valid** — no doc hyperlink points at a removed `worker/src` file (verified: none).

## 14. Acceptance Criteria

(From `WORKER_V2_PHASES.md` Phase −1 + WBS 1.1.)

- [ ] The complete Worker V1 `worker/` tree is removed; **no V1 handler/queue/config file remains**.
- [ ] No references to V1 handlers remain anywhere in the repository (dead path in `tsconfig.json` cleaned).
- [ ] The app build/typecheck is unaffected by the reset (no new failures attributable to it).
- [ ] The rollback anchor tag `worker-v1-final` exists and restores a buildable V1 state.
- [ ] A dependency inventory documents V1 dependencies and the behaviors Worker V2 must re-home.
- [ ] No Worker V2 code or V2 folders were created.

## 15. Definition of Done

(Playbook §14.4 phase-completion + Guide DoD, scoped to a removal phase.)

- [ ] All Acceptance Criteria (§14) met.
- [ ] Repository integrity verified (§13); no dual paths, no dead V1 code.
- [ ] Rollback anchor verified.
- [ ] `WORKER_V2_PROGRESS.md` updated — Phase −1 marked complete, % + milestone updated, recent activity recorded.
- [ ] `WORKER_V2_CHANGELOG.md` updated — Added / Changed / Removed / Documentation / Testing recorded.
- [ ] No architectural invariant violated; no ADR required (none created).
- [ ] Work committed using the Playbook commit convention; then **stop** (do not begin Phase 0).

## 16. Phase Checklist

- [ ] Rollback tag `worker-v1-final` created (WBS 1.1.3).
- [ ] Dependency inventory authored (WBS 1.1.1).
- [ ] `worker/` V1 tree removed (WBS 1.1.2).
- [ ] Dead `worker` reference removed from root `tsconfig.json`.
- [ ] `worker/README.md` placeholder created (emptied area, no V2 folders).
- [ ] Verification run (integrity, typecheck/lint, no legacy remains).
- [ ] `WORKER_V2_PROGRESS.md` updated.
- [ ] `WORKER_V2_CHANGELOG.md` updated.
- [ ] Self-review vs Acceptance Criteria + DoD + Invariants passed.
- [ ] Committed with convention; stopped.
