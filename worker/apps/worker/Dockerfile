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
COPY . .
RUN pnpm install --no-frozen-lockfile

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
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium fonts-liberation fonts-noto-color-emoji ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Durable storage defaults (override at deploy time as needed).
ENV WV2_STORAGE=filesystem
ENV WV2_STORAGE_ROOT=/data
VOLUME ["/data"]

# Production dependencies (sharp + heic-convert/libheif-js + puppeteer) + the bundled app.
COPY --from=build --chown=node:node /deploy/node_modules ./node_modules
COPY --from=build --chown=node:node /worker/apps/worker/dist ./dist
USER node

CMD ["node", "dist/main.js"]
