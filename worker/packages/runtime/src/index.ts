// @workerv2/runtime — the Worker V2 hosting framework.
//
// Generic runtime: lifecycle, service/capability registries, a plugin framework, DI + config
// + health integration, and technical lifecycle events. Contains NO domain behavior, NO jobs,
// NO coordinator/queue — those belong to later phases.

// --- Errors ---
export { DependencyGraphError, LifecycleError, RegistrationError } from './errors.js';

// --- Configuration ---
export type { RuntimeConfig } from './config.js';
export { readRuntimeConfig } from './config.js';

// --- Metadata ---
export type { RuntimeMetadata } from './metadata.js';
export { createRuntimeMetadata } from './metadata.js';

// --- Lifecycle ---
export type { RuntimeState, RuntimeTrigger } from './lifecycle/state.js';
export { RUNTIME_MACHINE } from './lifecycle/state.js';

// --- Services ---
export type { Service, ServiceContext } from './services/service.js';
export { ServiceRegistry } from './services/service-registry.js';
export { orderServices } from './services/dependency-graph.js';

// --- Capabilities ---
export type { Capability } from './capabilities/capability.js';
export { CapabilityRegistry } from './capabilities/capability.js';
// Capability version negotiation — interfaces only (implementation deferred).
export type {
  CapabilityRequirement,
  CapabilityOffer,
  CapabilityMatch,
  CapabilityNegotiationResult,
  CapabilityNegotiator,
} from './capabilities/negotiation.js';

// --- Plugins ---
export type { Plugin, PluginContext } from './plugins/plugin.js';
export { applyPlugins } from './plugins/plugin-host.js';

// --- Technical events (INV-12) ---
export type { TechnicalEventListener } from './events/technical-event-bus.js';
export { TechnicalEventBus } from './events/technical-event-bus.js';
export { RUNTIME_EVENTS } from './events/runtime-events.js';
export type { RuntimeEventType } from './events/runtime-events.js';

// --- Health ---
export { buildRuntimeHealth } from './health/runtime-health.js';

// --- DI integration ---
export {
  createRuntimeContainer,
  LoggerToken,
  ConfigToken,
  MetadataToken,
} from './di-integration.js';

// --- Runtime ---
export type { RuntimeOptions } from './runtime.js';
export { Runtime } from './runtime.js';
