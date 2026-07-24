// @workerv2/worker-host — the single COMPOSITION ROOT. It wires every previously-built platform
// (control plane, coordinator, execution adapter, processor SDK, image backend + processors,
// composition, document, PDF export, artifact store, persistence) into a complete executable
// album-generation pipeline, with full dependency injection — no globals, no ambient state. It
// registers processors + image backends + repositories + the artifact store, configures capability
// negotiation, executes complete Runs (Blueprint → Manifest → Coordinator → processors →
// composition → Document → PDF export → PDF Artifact), and surfaces observational diagnostics.
//
// It implements NO rendering, NO PDF generation, NO business logic, and changes NO Coordinator /
// Processor SDK / orchestration semantics — it is purely wiring. Nothing depends on this package.

// --- The host (composition root + run executor) ---
export { WorkerHost } from './host.js';
export type { WorkerHostOverrides, PreparedRun, RunResult } from './host.js';

// --- Configuration ---
export {
  resolveHostConfig,
  REFERENCE_BACKEND_ID,
  DEFAULT_RENDER_TARGET,
  DEFAULT_HOST_PRINT_PROFILE,
  DEFAULT_CLOCK_START,
} from './config.js';
export type { HostConfig, RenderTarget } from './config.js';

// --- Content-addressed store (ArtifactGateway + ArtifactBytesPort) ---
export { ContentAddressedStore } from './store.js';

// --- Registries (dependency injection; no globals) ---
export { ServiceRegistry, BackendRegistry } from './registry.js';

// --- Processor registration ---
export { registerProcessors } from './registration.js';
export type { RegistrationDeps } from './registration.js';

// --- Adapter processors (thin bindings of manifest names to existing engines) ---
export { createSurfaceRenderProcessor } from './processors/surface-render.js';
export type { SurfaceRenderDeps } from './processors/surface-render.js';
export { createAlbumAssembleProcessor } from './processors/album-assemble.js';
export type { AlbumAssembleDeps } from './processors/album-assemble.js';

// --- Capability offers ---
export { hostCapabilityOffers } from './capabilities.js';

// --- Diagnostics (observational only) ---
export { buildDiagnostics } from './diagnostics.js';
export type { ExecutionDiagnostics, NodeDiagnostic } from './diagnostics.js';
