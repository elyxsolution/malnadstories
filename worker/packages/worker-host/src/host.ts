import type { Result, JsonObject } from '@workerv2/contracts';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { RunId, Timestamp } from '@workerv2/control-plane';
import { VersionSet, makeRunId, makeTimestamp } from '@workerv2/control-plane';
import type { CapabilityOffer } from '@workerv2/runtime';
import { makeProcessingContext, makePipelineId, makeStepId } from '@workerv2/processing';
import type { CancellationSignal } from '@workerv2/processing';
import {
  InMemoryJournalStore,
  InMemoryEventSink,
  defaultCapabilityNegotiator,
  immediateWaiter,
  executeRun,
} from '@workerv2/execution-adapter';
import type { Clock, InMemoryProcessorRegistry } from '@workerv2/execution-adapter';
import type { Coordinator, ExecutionState } from '@workerv2/coordinator';
import { coordinatorFromManifest } from '@workerv2/coordinator';
import type { Blueprint } from '@workerv2/blueprint';
import { serializeBlueprint, BLUEPRINT_SCHEMA_VERSION } from '@workerv2/blueprint';
import type { CompiledManifest } from '@workerv2/manifest';
import {
  compileManifest,
  MANIFEST_SCHEMA_VERSION,
  ASSEMBLE_NODE_ID,
  ALBUM_OUTPUT,
} from '@workerv2/manifest';
import type { ImageBackend, RasterImage } from '@workerv2/image-backend';
import {
  createReferenceBackend,
  REFERENCE_BACKEND_VERSION,
  encodeRaster,
} from '@workerv2/image-backend';
import type { ProcessorDependencies } from '@workerv2/processor-sdk';
import { pdfExportSpec, SLOT as PDF_SLOT, PDF_EXPORTER_VERSION } from '@workerv2/pdf-export';
import { StateStore } from '@workerv2/persistence';
import { ContentAddressedStore } from './store.js';
import { ServiceRegistry, BackendRegistry } from './registry.js';
import { registerProcessors } from './registration.js';
import { hostCapabilityOffers } from './capabilities.js';
import { resolveHostConfig, REFERENCE_BACKEND_ID } from './config.js';
import type { HostConfig } from './config.js';
import { buildDiagnostics } from './diagnostics.js';
import type { ExecutionDiagnostics } from './diagnostics.js';

/**
 * THE WORKER HOST — the single COMPOSITION ROOT. It constructs every platform dependency, registers
 * processors + image backends + repositories + the artifact store, configures capability
 * negotiation, and executes complete Runs end to end (Blueprint → Manifest → Coordinator →
 * processors → composition → Document → PDF export → PDF Artifact). Everything is INJECTED: no
 * global singletons, no ambient services, no hidden state. It implements no rendering / PDF / image
 * processing / business logic and changes no other package — it only wires and drives. Swapping the
 * store, an image backend, or a processor requires changes ONLY here.
 */

const NEVER_CANCELLED: CancellationSignal = { isCancelled: () => false, reason: () => null };

/** Optional additional ImageBackends to register (id → backend) for selection/replacement. */
export interface WorkerHostOverrides {
  readonly backends?: ReadonlyArray<{ readonly id: string; readonly backend: ImageBackend }>;
}

/** The compiled, coordinator-ready form of an album run's work. */
export interface PreparedRun {
  readonly compiled: CompiledManifest;
  readonly coordinator: Coordinator;
  readonly versions: VersionSet;
  readonly blueprintKey: StorageKey;
}

/** The result of a complete album run. */
export interface RunResult {
  readonly succeeded: boolean;
  readonly runId: string;
  readonly manifestHash: string;
  readonly blueprintKey: StorageKey;
  readonly documentKey?: StorageKey;
  readonly pdfKey?: StorageKey;
  readonly descriptorKey?: StorageKey;
  readonly pdfBytes?: Uint8Array;
  readonly state: ExecutionState;
  readonly diagnostics: ExecutionDiagnostics;
}

export class WorkerHost {
  readonly config: HostConfig;
  readonly store: ContentAddressedStore;
  readonly backends: BackendRegistry;
  readonly processors: InMemoryProcessorRegistry;
  readonly services: ServiceRegistry;
  readonly offers: readonly CapabilityOffer[];
  private readonly backend: ImageBackend;
  private readonly processorDeps: ProcessorDependencies;

  constructor(config: Partial<HostConfig> = {}, overrides: WorkerHostOverrides = {}) {
    this.config = resolveHostConfig(config);
    this.store = new ContentAddressedStore();
    this.processorDeps = { artifacts: this.store };

    // --- Backend registration (the reference backend is canonical; more are pluggable) ---
    this.backends = new BackendRegistry();
    this.backends.register(REFERENCE_BACKEND_ID, createReferenceBackend());
    for (const extra of overrides.backends ?? []) this.backends.register(extra.id, extra.backend);
    this.backend = this.backends.get(this.config.backendId);

    // --- Processor registration (all completed processors share the one artifact gateway) ---
    this.processors = registerProcessors({
      processorDeps: this.processorDeps,
      backend: this.backend,
      store: this.store,
      renderTarget: this.config.renderTarget,
      printProfile: this.config.printProfile,
    });

    this.offers = hostCapabilityOffers();

    // --- Service registry (explicit DI; repositories + stores + negotiator registered) ---
    this.services = new ServiceRegistry()
      .register('artifactStore', this.store)
      .register('backends', this.backends)
      .register('processors', this.processors)
      .register('capabilityNegotiator', defaultCapabilityNegotiator)
      .register('capabilityOffers', this.offers)
      .register('repositories', new StateStore());
  }

  /** Seed a raster as a content-addressed page-source Artifact; returns its key. */
  seedRasterArtifact(raster: RasterImage): StorageKey {
    return this.store.put(encodeRaster(raster));
  }

  /** Store the blueprint + compile it into a coordinator-ready run (Blueprint → Manifest → Coordinator). */
  prepare(blueprint: Blueprint): PreparedRun {
    const blueprintKey = this.store.put(new TextEncoder().encode(serializeBlueprint(blueprint)));
    const compiled = unwrap(compileManifest(blueprint), 'compileManifest');
    const versions = unwrap(
      VersionSet.create({
        manifest: MANIFEST_SCHEMA_VERSION,
        imageEngine: REFERENCE_BACKEND_VERSION,
        pdfEngine: PDF_EXPORTER_VERSION,
        blueprint: BLUEPRINT_SCHEMA_VERSION,
      }),
      'VersionSet',
    );
    const coordinator = unwrap(
      coordinatorFromManifest(compiled, versions),
      'coordinatorFromManifest',
    );
    return { compiled, coordinator, versions, blueprintKey };
  }

  /** Drive a prepared coordinator run to completion (the reusable execution bootstrap). */
  async executeManifest(
    coordinator: Coordinator,
    runId: RunId,
    opts: { readonly initial?: ExecutionState } = {},
  ): Promise<{ state: ExecutionState; clock: Clock }> {
    // A deterministic, monotonically-advancing clock: distinct instants make the recorded dispatch
    // order (and duration) meaningful, while the sequence of reads stays fully deterministic.
    const clock = monotonicClock(this.startTimestamp());
    const { state } = await executeRun({
      coordinator,
      runId,
      journal: new InMemoryJournalStore(),
      events: new InMemoryEventSink(),
      options: {
        clock,
        resolver: this.processors,
        negotiator: defaultCapabilityNegotiator,
        offers: this.offers,
        waiter: immediateWaiter,
      },
      ...(opts.initial === undefined ? {} : { initial: opts.initial }),
    });
    return { state, clock };
  }

  /**
   * Execute a COMPLETE album run: compose every surface + assemble the Document via the Coordinator,
   * then export the Document to a PDF Artifact. Deterministic: identical Blueprint + seeded
   * Artifacts + config always yield identical Artifact identities.
   */
  async run(blueprint: Blueprint): Promise<RunResult> {
    const prepared = this.prepare(blueprint);
    const runId = unwrap(makeRunId('run-1'), 'makeRunId');
    const startedAt = this.config.clockStart;

    const { state, clock } = await this.executeManifest(prepared.coordinator, runId);
    const finishedAt = clock.now();
    const diagnosticsFor = (): ExecutionDiagnostics =>
      buildDiagnostics(prepared.coordinator, state, { startedAt, finishedAt });

    const base = {
      runId,
      manifestHash: prepared.compiled.hash,
      blueprintKey: prepared.blueprintKey,
      state,
    };

    if (state.status !== 'succeeded') {
      return { succeeded: false, ...base, diagnostics: diagnosticsFor() };
    }

    // --- Export stage: apply the PDF exporter to the assembled Document (host-orchestrated) ---
    const documentKey = state.nodes[ASSEMBLE_NODE_ID]?.outputs?.[ALBUM_OUTPUT];
    if (documentKey === undefined) {
      return { succeeded: false, ...base, diagnostics: diagnosticsFor() };
    }

    const exported = await this.exportPdf(documentKey);
    if (!exported.ok) {
      return { succeeded: false, ...base, documentKey, diagnostics: diagnosticsFor() };
    }

    return {
      succeeded: true,
      ...base,
      documentKey,
      pdfKey: exported.pdf,
      descriptorKey: exported.descriptor,
      pdfBytes: await this.store.read(exported.pdf),
      diagnostics: diagnosticsFor(),
    };
  }

  /** Run the registered PDF exporter on a Document Artifact (the export stage). */
  private async exportPdf(
    documentKey: StorageKey,
  ): Promise<{ ok: true; pdf: StorageKey; descriptor: StorageKey } | { ok: false }> {
    const processor = this.processors.resolve(pdfExportSpec.descriptor.name);
    if (processor === null) return { ok: false };
    const context = unwrap(
      makeProcessingContext({
        runId: unwrap(makeRunId('export-1'), 'makeRunId'),
        pipelineId: unwrap(makePipelineId('pdf-export'), 'makePipelineId'),
        stepId: unwrap(makeStepId('export'), 'makeStepId'),
        attempt: 1,
        inputs: { [PDF_SLOT.document]: documentKey },
        expectedOutputs: [PDF_SLOT.pdf, PDF_SLOT.descriptor],
        config: this.config.exportConfig as unknown as JsonObject,
        startedAt: this.startTimestamp(),
        cancellation: NEVER_CANCELLED,
      }),
      'makeProcessingContext',
    );
    const outcome = await processor.process(context);
    if (!outcome.ok) return { ok: false };
    const pdf = outcome.value.outputs[PDF_SLOT.pdf];
    const descriptor = outcome.value.outputs[PDF_SLOT.descriptor];
    if (pdf === undefined || descriptor === undefined) return { ok: false };
    return { ok: true, pdf, descriptor };
  }

  private startTimestamp(): Timestamp {
    return unwrap(makeTimestamp(this.config.clockStart), 'makeTimestamp');
  }
}

/** Unwrap a `Result`, throwing a descriptive error on failure (composition-root construction). */
function unwrap<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) throw new Error(`WorkerHost: ${what} failed: ${result.error.message}`);
  return result.value;
}

/**
 * A deterministic, monotonically-advancing clock. Each `now()` returns the current instant then
 * steps forward 1ms — so a run's recorded dispatch order and duration are meaningful, while the
 * (single-threaded, deterministic) sequence of reads keeps the whole run reproducible. It never
 * reads wall-clock time.
 */
function monotonicClock(start: Timestamp): Clock {
  let ms = Date.parse(start);
  return {
    now: (): Timestamp => {
      const at = new Date(ms).toISOString() as Timestamp;
      ms += 1;
      return at;
    },
  };
}
