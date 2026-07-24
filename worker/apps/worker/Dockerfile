# syntax=docker/dockerfile:1
#
# Production image for the Worker V2 deployable app. Multi-stage:
#   1. build  — install the whole workspace + bundle the app into ONE self-contained ESM file
#   2. runtime — copy ONLY that bundle onto a tiny base (no node_modules; only Node built-ins used)
#
# Build context = the `worker/` directory (Render "Root Directory: worker").

# ---- Stage 1: build (glibc base = reliable esbuild native binary) ----
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /worker

# Copy the whole worker workspace (see .dockerignore for exclusions) and install.
COPY . .
RUN pnpm install --no-frozen-lockfile

# Bundle the app: apps/worker/dist/main.js becomes self-contained (all @workerv2/* libs inlined).
RUN pnpm --filter @workerv2/app run build

# ---- Stage 2: runtime (tiny; the bundle needs only Node built-ins) ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Durable storage defaults (override at deploy time as needed).
ENV WV2_STORAGE=filesystem
ENV WV2_STORAGE_ROOT=/data
VOLUME ["/data"]

# Run as the non-root `node` user shipped in the base image.
COPY --from=build --chown=node:node /worker/apps/worker/dist ./dist
USER node

CMD ["node", "dist/main.js"]
