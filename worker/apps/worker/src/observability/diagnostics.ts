import { cpus, freemem, hostname, totalmem, type as osType, release } from 'node:os';
import type { BuildInfo } from '@workerv2/build-info';
import { readBuildInfoFromEnv } from '@workerv2/build-info';
import type { WorkerHealthReport } from './health.js';
import type { ResourceSnapshot } from './monitor.js';

/**
 * THE DIAGNOSTICS REPORT — one JSON document that answers "what exactly is this process, and what
 * is it wired to?" without an operator reading application code or shelling into the container.
 *
 * It is the union of three things a production incident always needs at once: IDENTITY (which build,
 * which commit, which node, on what hardware), COMPOSITION (which processors, resources, recovery
 * handlers and telemetry backends are actually registered — proving the deployment is what was
 * intended), and CURRENT STATE (health + the latest resource sample).
 *
 * BUILD IDENTITY IS REUSED, not re-derived: `@workerv2/build-info` already reads the conventional
 * `WORKER_V2_*` variables and defaults everything to `unknown` so missing build metadata can never
 * break a process. This module adds the deployment-specific fields (`GIT_COMMIT`/`RENDER_GIT_COMMIT`)
 * that the hosting platform injects.
 *
 * SECURITY: the configuration summary handed in is already redacted at the source (see
 * `summarizeConfig`), and this module adds no environment dump, no connection strings, and no
 * secrets. It reports SHAPE (`storage: 'filesystem'`, `infrastructure: 'enabled'`), never values.
 */

export interface PlatformInfo {
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly osType: string;
  readonly osRelease: string;
  readonly hostname: string;
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
  readonly freeMemoryBytes: number;
  readonly pid: number;
  readonly uptimeSeconds: number;
}

/** What the worker actually composed at startup — the anti-"is this the right deploy?" section. */
export interface CompositionInfo {
  readonly processors: readonly string[];
  readonly resources: readonly string[];
  readonly recoveryHandlers: readonly string[];
  readonly healthProbes: readonly string[];
  /** The concrete telemetry implementations in use (e.g. `InMemoryMetrics`, `LoggingSpanExporter`). */
  readonly metricsBackend: string;
  readonly tracingBackend: string;
  readonly logSinks: readonly string[];
}

export interface DiagnosticsReport {
  readonly generatedAt: string;
  /** The deployable worker application's version. */
  readonly workerVersion: string;
  /** The production-runtime library version this app hosts. */
  readonly runtimeVersion: string;
  readonly build: BuildInfo;
  readonly platform: PlatformInfo;
  readonly composition: CompositionInfo;
  readonly configuration: Record<string, unknown>;
  readonly health: WorkerHealthReport | null;
  readonly resources: ResourceSnapshot | null;
  /** Lifecycle state of the worker application (`idle`, `processing`, `draining`, …). */
  readonly state: string;
}

/** Read build provenance from the environment, including the platform's own commit variables. */
export function readBuildIdentity(
  env: Readonly<Record<string, string | undefined>>,
  workerVersion: string,
): BuildInfo {
  const base = readBuildInfoFromEnv(env);
  // Render/Vercel/GitHub Actions each inject the commit under their own name; prefer an explicit
  // WORKER_V2_GIT_SHA, then the platform's, and keep build-info's `unknown` fallback otherwise.
  const commit =
    env['WORKER_V2_GIT_SHA'] ??
    env['GIT_COMMIT'] ??
    env['RENDER_GIT_COMMIT'] ??
    env['GITHUB_SHA'] ??
    base.gitSha;
  return {
    version: env['WORKER_V2_VERSION'] ?? workerVersion,
    gitSha: commit,
    builtAt: base.builtAt,
    nodeVersion: base.nodeVersion,
    environment: env['WORKER_V2_ENV'] ?? env['NODE_ENV'] ?? 'unknown',
  };
}

/** Snapshot the host platform. Pure reads of `os`/`process` — no side effects. */
export function readPlatformInfo(): PlatformInfo {
  const cores = cpus();
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    osType: osType(),
    osRelease: release(),
    hostname: hostname(),
    cpuModel: cores[0]?.model ?? 'unknown',
    cpuCount: cores.length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

/** Everything the report needs that only the composition root knows. */
export interface DiagnosticsInputs {
  readonly workerVersion: string;
  readonly runtimeVersion: string;
  readonly build: BuildInfo;
  readonly composition: CompositionInfo;
  readonly configuration: Record<string, unknown>;
  readonly state: string;
  readonly health?: WorkerHealthReport | null;
  readonly resources?: ResourceSnapshot | null;
}

/** Assemble the report. Cheap enough to build per request — no caching needed. */
export function buildDiagnosticsReport(inputs: DiagnosticsInputs): DiagnosticsReport {
  return {
    generatedAt: new Date().toISOString(),
    workerVersion: inputs.workerVersion,
    runtimeVersion: inputs.runtimeVersion,
    build: inputs.build,
    platform: readPlatformInfo(),
    composition: inputs.composition,
    configuration: inputs.configuration,
    health: inputs.health ?? null,
    resources: inputs.resources ?? null,
    state: inputs.state,
  };
}
