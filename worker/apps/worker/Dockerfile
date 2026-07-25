# syntax=docker/dockerfile:1
#
# Production image for the Worker V2 deployable app. Multi-stage:
#   1. build   — install the workspace, bundle the app, and stage a production node_modules
#   2. runtime — the bundle + production node_modules on a glibc base
#
# The bundle inlines every @workerv2/* library and the pure-JS infra SDKs (pg-boss/postgres/aws-sdk).
# A few dependencies CANNOT be bundled and are shipped via node_modules instead: `sharp` (native binary),
# `heic-convert`/`libheif-js` (WASM), and `puppeteer` (drives a Chromium binary). They load ONLY when
# WV2_INFRA=on (the processor path), so the default worker still runs from the self-contained bundle
# alone. The base is glibc (node:20-slim, NOT alpine/musl) so sharp's prebuilt binary loads.
#
# Chromium: puppeteer's own download is disabled in this workspace (pnpm-workspace.yaml); the runtime
# image installs the DISTRO chromium + fonts and points puppeteer at it via PUPPETEER_EXECUTABLE_PATH.
#
# Build context = the `worker/` directory (Render "Root Directory: worker").

# ---- Stage 1: build ----
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /worker

# Copy the whole worker workspace (see .dockerignore for exclusions) and install.
#
# SUPPLY CHAIN: `--frozen-lockfile` (Phase I-6). This previously used `--no-frozen-lockfile`, which
# let a production build silently resolve different transitive versions than the ones that were
# tested and audited — the lockfile existed but was not binding. The build now FAILS if the lockfile
# and manifests disagree, which is the behaviour that makes `pnpm audit` results meaningful.
COPY . .
RUN pnpm install --frozen-lockfile

# Bundle the app: apps/worker/dist/main.js (self-contained except the native/WASM externals above).
RUN pnpm --filter @workerv2/app run build

# Stage a self-contained production node_modules (no workspace symlinks) for the runtime image. This
# includes sharp's platform binary + heic-convert/libheif-js — the externals the bundle requires at
# runtime when infrastructure is enabled.
RUN pnpm --filter @workerv2/app deploy --prod /deploy

# ---- Stage 2: runtime (glibc base for sharp's prebuilt binary + Chromium for puppeteer) ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# System Chromium + the fonts/libs a headless render needs. Puppeteer uses this binary (no download).
#
# `tini` (Phase I-6) is installed to serve as PID 1. Chromium forks a tree of child processes, and a
# crashed or force-closed browser can leave orphans behind. Node as PID 1 does not reap arbitrary
# orphaned children, so over a long uptime those accumulate as zombies until the process table is
# exhausted. `tini` reaps them and forwards SIGTERM unchanged, so graceful shutdown is unaffected.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium fonts-liberation fonts-noto-color-emoji ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Durable storage for the runtime's own journal/artifacts.
#
# NOTE for the processor deployment (WV2_INFRA=on): this path is effectively unused, because job
# durability lives in pg-boss/Postgres and R2, not here — the processor path never creates a runtime
# run. It still must be WRITABLE, because the `runtime-storage` health probe is liveness-critical and
# round-trips through it; a read-only /data would report the worker as not-live and earn a restart
# loop. If you run with a read-only root filesystem, keep /data and /tmp writable (Chromium also
# requires a writable /tmp).
ENV WV2_STORAGE=filesystem
ENV WV2_STORAGE_ROOT=/data
VOLUME ["/data"]

# Production dependencies (sharp + heic-convert/libheif-js + puppeteer) + the bundled app.
COPY --from=build --chown=node:node /deploy/node_modules ./node_modules
COPY --from=build --chown=node:node /worker/apps/worker/dist ./dist
USER node

# Container-level liveness for plain Docker/Compose. Render uses its own configured health path;
# this makes the two agree rather than leaving local runs unmonitored. It probes /health, which is
# the same endpoint (and same `{status:"ok"}` contract) the Next.js app gates worker work on.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini as PID 1: reaps Chromium orphans, forwards signals verbatim to the worker.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
