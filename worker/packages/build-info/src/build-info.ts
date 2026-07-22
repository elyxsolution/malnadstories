import type { DeepReadonly } from '@workerv2/contracts';

/** Immutable version + build provenance for a running Worker V2 process. */
export interface BuildInfo {
  /** Semantic version of the platform build. */
  readonly version: string;
  /** Git commit SHA the build was produced from (`'unknown'` if unset). */
  readonly gitSha: string;
  /** ISO-8601 build timestamp (`'unknown'` if unset). */
  readonly builtAt: string;
  /** Node.js runtime version the process reports. */
  readonly nodeVersion: string;
  /** Deployment environment label (e.g. `development`, `production`). */
  readonly environment: string;
}

const UNKNOWN = 'unknown';

/**
 * Build immutable `BuildInfo` from partial, injected values. Everything is optional and
 * defaulted, so this never throws and never reads ambient globals except the Node version
 * (via an injectable getter for testability).
 */
export function createBuildInfo(
  partial: Partial<BuildInfo> = {},
  nodeVersionOf: () => string = () => process.version,
): DeepReadonly<BuildInfo> {
  const info: BuildInfo = {
    version: partial.version ?? '0.0.0',
    gitSha: partial.gitSha ?? UNKNOWN,
    builtAt: partial.builtAt ?? UNKNOWN,
    nodeVersion: partial.nodeVersion ?? nodeVersionOf(),
    environment: partial.environment ?? UNKNOWN,
  };
  return Object.freeze(info) as DeepReadonly<BuildInfo>;
}

/** A read-only env source (mirrors `@workerv2/config` without depending on it). */
export type BuildEnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Assemble `BuildInfo` from conventional environment variables. Unset variables fall back to
 * safe defaults — build metadata must never break process start.
 */
export function readBuildInfoFromEnv(
  env: BuildEnvSource,
  nodeVersionOf: () => string = () => process.version,
): DeepReadonly<BuildInfo> {
  return createBuildInfo(
    {
      version: env['WORKER_V2_VERSION'],
      gitSha: env['WORKER_V2_GIT_SHA'],
      builtAt: env['WORKER_V2_BUILT_AT'],
      environment: env['WORKER_V2_ENV'],
    },
    nodeVersionOf,
  );
}
