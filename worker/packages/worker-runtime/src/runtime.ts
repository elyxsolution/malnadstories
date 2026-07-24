import type { RunId } from '@workerv2/control-plane';
import { makeRunId } from '@workerv2/control-plane';
import type { ExecutionState } from '@workerv2/coordinator';
import type { Blueprint } from '@workerv2/blueprint';
import { parseBlueprint } from '@workerv2/blueprint';
import type { RasterImage } from '@workerv2/image-backend';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { RunResult, ExecutionDiagnostics } from '@workerv2/worker-host';
import type { RuntimeConfig } from './config.js';
import { resolveRuntimeConfig, retryPolicies } from './config.js';
import type { BootstrapDeps, RuntimeComponents } from './bootstrap.js';
import { bootstrapRuntime } from './bootstrap.js';
import { WorkerLifecycle } from './lifecycle.js';
import type { HealthReport } from './health.js';
import { reportHealth } from './health.js';

/**
 * THE PRODUCTION RUNTIME — the operational facade over the Worker Host. It boots durable
 * infrastructure, manages the worker lifecycle (startup → running → draining → stopped) with
 * graceful shutdown, executes runs while emitting OBSERVATIONAL structured logs + metrics, persists
 * a run record so an interrupted run can be RECOVERED after restart (re-fold the durable journal via
 * the Coordinator's own resume — no new semantics), and reports health. It changes no Coordinator /
 * Processor / Manifest / render / export behavior — it is purely operational composition.
 */

const decoder = new TextDecoder();

export interface RuntimeRunResult {
  readonly result: RunResult;
  readonly diagnostics: ExecutionDiagnostics;
}

export class WorkerRuntime {
  readonly config: RuntimeConfig;
  private readonly components: RuntimeComponents;
  private readonly lifecycle = new WorkerLifecycle();

  constructor(config: Partial<RuntimeConfig> = {}, deps: BootstrapDeps = {}) {
    this.config = resolveRuntimeConfig(config);
    this.components = bootstrapRuntime(this.config, deps);
  }

  // --- Lifecycle ---

  /** Start the runtime: initialize, register (already wired at bootstrap), become ready. */
  start(): void {
    this.lifecycle.starting();
    this.lifecycle.started();
    this.components.logger.log({ level: 'info', message: 'runtime.started' });
  }

  /** Graceful shutdown: stop accepting work, drain in-flight, then stop. */
  shutdown(): void {
    this.lifecycle.drain();
    this.lifecycle.stop();
    this.components.logger.log({ level: 'info', message: 'runtime.stopped' });
  }

  get phase(): string {
    return this.lifecycle.phase;
  }

  // --- Work ---

  /** Seed a page-source Artifact into the durable store (via the host, which encodes the raster). */
  seedRasterArtifact(raster: RasterImage): StorageKey {
    return this.components.host.seedRasterArtifact(raster);
  }

  /** Execute a complete album run through the durable-infrastructure host + emit diagnostics. */
  async run(blueprint: Blueprint): Promise<RuntimeRunResult> {
    this.lifecycle.beginRun();
    try {
      const result = await this.components.host.run(blueprint, retryPolicies(this.config));
      this.components.runRecords.save({
        runId: result.runId,
        blueprintKey: result.blueprintKey,
        manifestHash: result.manifestHash,
      });
      this.emitDiagnostics(result);
      return { result, diagnostics: result.diagnostics };
    } finally {
      this.lifecycle.endRun();
    }
  }

  // --- Recovery ---

  /** Every run recorded in durable storage (candidates for restart recovery). */
  recoverableRuns(): readonly string[] {
    return this.components.runRecords.runIds();
  }

  /**
   * Recover a run after restart: read its record, re-read the blueprint from the durable store,
   * re-prepare the (identical) coordinator, load the durable journal, and resume — driving to
   * completion if it was interrupted. Reuses the Coordinator's own resume semantics; content-
   * addressed artifacts are reused, not regenerated.
   */
  async recover(runId: string): Promise<ExecutionState | undefined> {
    const record = this.components.runRecords.load(runId);
    if (record === undefined) return undefined;

    const blueprintBytes = await this.components.store.read(record.blueprintKey as StorageKey);
    const parsed = parseBlueprint(decoder.decode(blueprintBytes));
    if (!parsed.ok) throw new Error(`recover: blueprint parse failed: ${parsed.error.message}`);

    const prepared = this.components.host.prepare(parsed.value, retryPolicies(this.config));
    const rid = this.toRunId(runId);
    const entries = await this.components.journalStore.load(rid);
    const resumed = prepared.coordinator.resume(rid, entries);
    if (!resumed.ok) throw new Error(`recover: resume failed: ${resumed.error.message}`);

    if (prepared.coordinator.progress(resumed.value).settled) return resumed.value;

    // Interrupted mid-run → continue from the resumed state (durable journal keeps appending).
    const { state } = await this.components.host.executeManifest(prepared.coordinator, rid, {
      initial: resumed.value,
    });
    return state;
  }

  // --- Health ---

  health(): HealthReport {
    return reportHealth({
      live: this.lifecycle.live,
      started: this.lifecycle.running,
      storage: this.components.backend,
      backend: this.components.imageBackend,
    });
  }

  // --- Exposed operational services (all injected; replaceable) ---

  get host(): RuntimeComponents['host'] {
    return this.components.host;
  }
  get store(): RuntimeComponents['store'] {
    return this.components.store;
  }
  get journalStore(): RuntimeComponents['journalStore'] {
    return this.components.journalStore;
  }
  get events(): RuntimeComponents['eventSink'] {
    return this.components.eventSink;
  }
  get logger(): RuntimeComponents['logger'] {
    return this.components.logger;
  }
  get metrics(): RuntimeComponents['metrics'] {
    return this.components.metrics;
  }

  // --- Internals ---

  private emitDiagnostics(result: RunResult): void {
    const d = result.diagnostics;
    for (const node of d.nodes) {
      this.components.logger.log({
        level: node.state === 'failed' ? 'error' : 'info',
        message: 'node.settled',
        runId: d.runId,
        nodeId: node.nodeId,
        processor: node.processor,
        outcome: node.state,
        artifacts: Object.values(node.outputs),
        ...(d.durationMs === undefined ? {} : { durationMs: d.durationMs }),
      });
      this.components.metrics.recordProcessorTiming(node.processor, d.durationMs ?? 0);
    }
    this.components.logger.log({
      level: result.succeeded ? 'info' : 'error',
      message: 'run.settled',
      runId: d.runId,
      outcome: d.status,
      ...(d.durationMs === undefined ? {} : { durationMs: d.durationMs }),
      ...(result.pdfKey === undefined ? {} : { artifacts: [result.pdfKey] }),
    });
    if (d.durationMs !== undefined)
      this.components.metrics.recordExecutionDuration(d.runId, d.durationMs);
    this.components.metrics.recordArtifactCount(d.runId, Object.keys(d.producedArtifacts).length);
    this.components.metrics.recordRetries(d.runId, d.totalRetries);
    this.components.metrics.recordFailures(d.runId, d.failures.length);
    this.components.metrics.recordBackendUsage(this.config.backendId);
  }

  private toRunId(raw: string): RunId {
    const r = makeRunId(raw);
    if (!r.ok) throw new Error(`invalid run id "${raw}"`);
    return r.value;
  }
}
