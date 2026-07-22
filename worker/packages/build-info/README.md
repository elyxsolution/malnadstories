# @workerv2/build-info

Generic **version + build metadata** accessor. Reads injected build/version values (or
conventional env vars) into an immutable `BuildInfo`. No product knowledge. Depends on
`@workerv2/contracts`.

## Exports

- `BuildInfo` — `{ version, gitSha, builtAt, nodeVersion, environment }` (all readonly).
- `createBuildInfo(partial?, nodeVersionOf?)` — defaults + freezes; never throws.
- `readBuildInfoFromEnv(env, nodeVersionOf?)` — from `WORKER_V2_VERSION` / `_GIT_SHA` /
  `_BUILT_AT` / `_ENV`, defaulting any unset value.
