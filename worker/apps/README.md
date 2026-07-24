# apps/ — deployable applications

Deployable Worker V2 applications live here (libraries live in `packages/*`; only apps emit build
artifacts).

- **`worker/`** — the deployable Worker process (Phase 19.5). The minimal composition/bootstrap layer
  that hosts the production runtime (`@workerv2/worker-runtime`) as a runnable service for local,
  Docker, and Render execution. See `apps/worker/README.md`.
