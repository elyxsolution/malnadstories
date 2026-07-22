# Phase −1 — Worker V1 Dependency Inventory

> **WBS 1.1.1 deliverable.** Snapshot of the legacy Worker V1 surface and every live dependency on
> it, taken **before** removal. Its purpose is twofold: (1) authorize a safe deletion, and (2) record
> the behaviors Worker V2 must intentionally **re-home** later. Captured against `HEAD = d325f28`
> (rollback anchor `worker-v1-final`). **Date:** 2026-07-22

---

## 1. Worker V1 surface (the `worker/` tree — all to be removed)

| File | Role (V1) |
|---|---|
| `worker/src/index.ts` | Boot: pg-boss start, registers 5 queues + workers, sweeps. |
| `worker/src/queue.ts` | Worker-side queue names + job types + `createBoss`. |
| `worker/src/jobs/image-hardening.ts` | Validate → EXIF → re-encode (sharp) → thumbnail → upload → delete raw. |
| `worker/src/jobs/album-pdf.ts` | Puppeteer → app print route → `page.pdf` → upload PDF. |
| `worker/src/jobs/cover-thumbnail.ts` | Cover thumbnail render. |
| `worker/src/jobs/blueprint-thumbnail.ts` | Blueprint thumbnail render (Chromium). |
| `worker/src/jobs/pdf-recovery.ts` | Stuck/paid-heal PDF recovery sweep. |
| `worker/src/jobs/r2-cleanup.ts` | Batch R2 key deletion (album deletion). |
| `worker/src/lib/image.ts` | sharp + file-type + exifr + heic-convert helpers. |
| `worker/src/lib/observability.ts` | Worker-side capture/timing mirror (`record_error_event`). |
| `worker/src/health-server.ts` | Availability/health port for wake-up probes. |
| `worker/src/env.ts` · `r2.ts` · `supabase.ts` | Env, R2 client, service-role Supabase client. |
| `worker/tsconfig.json` | TS config incl. `@builder/*` → `../src/lib/builder/*` alias. |
| `worker/package.json` · `package-lock.json` · `pnpm-lock.yaml` · `pnpm-workspace.yaml` | V1-specific standalone package + toolchain (puppeteer/sharp/heic/pg-boss). |
| `worker/.env.example` · `.puppeteerrc.cjs` | V1 env template + Puppeteer config. |

**Queues owned by V1:** `image-hardening`, `album-pdf`, `r2-cleanup`, `cover-thumbnail`,
`blueprint-thumbnail` (pg-boss on the same Supabase Postgres, `pgboss` schema).

## 2. Coupling direction (critical safety finding)

- **One-directional.** The worker imports the app's pure renderer via `@builder/*` →
  `../src/lib/builder/*`. **No file under `src/**` imports from `worker/`.**
  → Removing `worker/` **cannot break the app build**.
- The worker is its **own pnpm root** (`worker/pnpm-workspace.yaml`); the root
  `pnpm-workspace.yaml` does **not** list it. CI (`secret-scan.yml`) and root `package.json`
  have **no** worker references.
  → Removal touches **no** root tooling, workspace, CI, or lint.
- Root `tsconfig.json` `exclude` lists `"worker"` — becomes a **dead reference** after removal
  (cleaned in Phase −1).

## 3. App-side dependencies on V1 — behaviors to RE-HOME in Worker V2

These live in **app** code (`src/**`) and are **preserved** in Phase −1 (deleting them would
cascade-break the live app build). They are the contract points Worker V2 will re-home.

| App surface | Depends on V1 for | V2 re-home target (future) |
|---|---|---|
| `src/lib/queue.ts` (**app-side enqueue**, send-only) | Enqueues all 5 job types to pg-boss. | Coordinator / Runtime enqueue seam (Phases 2, 9). |
| `src/app/api/photos/confirm/route.ts`, `.../presign/route.ts` | Enqueue image-hardening after upload confirm. | Image Processing pipeline (Phase 5) via Coordinator. |
| `src/lib/pdf/generate.ts`, `src/lib/actions/admin/pdf.ts`, `api/albums/[id]/pdf`, `api/admin/albums/[id]/pdf` | Enqueue + poll album-pdf generation. | Render/PDF platform (Phase 8) via Coordinator (Phase 9). |
| `src/lib/actions/albums.ts` (`deleteAlbum`) | Enqueue r2-cleanup. | Artifact/asset lifecycle cleanup (Phase 3) via Coordinator. |
| `src/lib/covers.ts`, `src/lib/blueprints/thumbnail.ts`, `admin/covers`, `blueprints/[id]/preview` | Enqueue cover/blueprint thumbnails. | Render platform (Phase 8) / thumbnails as derivatives (Phase 5/8). |
| `src/lib/worker/health.ts`, `src/app/api/worker/health/route.ts`, `src/components/worker/*` (`use-worker-gate`, `worker-prewarm`) | Probe/wake the V1 worker; gate worker-dependent UI. | Runtime health/availability seam (Phase 2) + operability (Phase 10). |
| `src/app/albums/[id]/print/**` (token-gated print route) | Consumed by V1 album-pdf (Puppeteer drives it). | Manifest-first Render engine (Phase 8) — **replaces** the "render by re-driving the app UI" model (INV-3). |
| `src/lib/builder/model.ts` (pure renderer) | Imported by V1 PDF job via `@builder/*`. | Superseded by the deterministic Render engine consuming a Manifest (Phases 7–8). |

**Data-plane dependencies (NOT touched in Phase −1 — Playbook SC-7):**
- `photos.status` / `sanitized_key` / `thumb_key` (image-hardening outputs).
- `album_pdfs` (PDF state + print token) and the `pgboss` schema (queue state).
- These remain in the database; Worker V2 will reconcile/re-home them in later phases (migration is a designed, reviewed step — never ad hoc here).

## 4. Consequence of removal (known & intended)

With V1 removed and V2 not yet built, enqueued jobs have **no consumer**: uploads remain
`pending` (not sanitized to `ready`), and PDFs/thumbnails are not generated. This is the
**intended** interim state of a from-scratch rebuild (Implementation Guide §4.2). App enqueues
still succeed (rows are written / jobs queued); **no data is lost**; processing resumes when
Worker V2 is delivered. `CLAUDE.md` still documents V1 and will be reconciled in a later phase
(ADR-gated) — it is not edited in Phase −1.

## 5. Removal authorization

Given §2 (one-directional coupling, standalone pnpm root, no root/CI refs) and §3–§4 (app-side
behaviors preserved + inventoried, data plane untouched, full rollback via `worker-v1-final`),
deleting the `worker/` tree is **safe for the repository build and reversible**. Authorized to
proceed to WBS 1.1.2.
