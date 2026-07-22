import type { JsonObject } from '@workerv2/contracts';
import type { Container } from '@workerv2/di';
import { NoopLogger } from '@workerv2/logger';
import type { Logger } from '@workerv2/logger';
import type { BuildInfo } from '@workerv2/build-info';
import type { HealthReport } from '@workerv2/health';
import { technicalEvent, makeEventId, makeTimestamp } from '@workerv2/control-plane';
import type { RuntimeConfig } from './config.js';
import { createRuntimeMetadata } from './metadata.js';
import type { RuntimeMetadata } from './metadata.js';
import { RUNTIME_MACHINE } from './lifecycle/state.js';
import type { RuntimeState, RuntimeTrigger } from './lifecycle/state.js';
import { ServiceRegistry } from './services/service-registry.js';
import { orderServices } from './services/dependency-graph.js';
import type { Service, ServiceContext } from './services/service.js';
import { CapabilityRegistry } from './capabilities/capability.js';
import type { Capability } from './capabilities/capability.js';
import { applyPlugins } from './plugins/plugin-host.js';
import type { Plugin, PluginContext } from './plugins/plugin.js';
import { TechnicalEventBus } from './events/technical-event-bus.js';
import type { TechnicalEventListener } from './events/technical-event-bus.js';
import { RUNTIME_EVENTS } from './events/runtime-events.js';
import { buildRuntimeHealth } from './health/runtime-health.js';
import { createRuntimeContainer } from './di-integration.js';
import { LifecycleError } from './errors.js';

/** Everything needed to build a runtime. Time + ids are injected (deterministic startup). */
export interface RuntimeOptions {
  readonly runtimeId: string;
  readonly config: RuntimeConfig;
  readonly build: BuildInfo;
  /** Injected clock — the only source of wall-clock time. */
  readonly now: () => Date;
  /** Injected id source for technical-event ids. */
  readonly nextId: () => string;
  readonly logger?: Logger;
  readonly plugins?: readonly Plugin[];
  readonly services?: readonly Service[];
}

interface RuntimeInternals {
  readonly logger: Logger;
  readonly metadata: RuntimeMetadata;
  readonly container: Container;
  readonly config: RuntimeConfig;
  readonly capabilityRegistry: CapabilityRegistry;
  readonly orderedServices: readonly Service[];
  readonly now: () => Date;
  readonly nextId: () => string;
}

/**
 * The Worker V2 Runtime — a generic host for services, capabilities, and plugins. It validates
 * the dependency graph at build time, starts/stops services in deterministic order, emits
 * technical lifecycle events, and reports health. It hosts NO domain behavior and NO jobs.
 */
export class Runtime {
  private state: RuntimeState = 'created';
  private readonly bus = new TechnicalEventBus();
  private readonly serviceContext: ServiceContext;
  private readonly internals: RuntimeInternals;

  private constructor(internals: RuntimeInternals) {
    this.internals = internals;
    this.serviceContext = {
      container: internals.container,
      logger: internals.logger,
      config: internals.config,
      metadata: internals.metadata,
    };
    Object.freeze(this.serviceContext);
  }

  /**
   * Build a runtime: assemble metadata + DI container, apply plugins and services into the
   * registries, and validate the dependency graph. Throws `DependencyGraphError` if the graph
   * is invalid — nothing starts until it is sound. Pure and deterministic (no I/O, no clock).
   */
  static create(options: RuntimeOptions): Runtime {
    const logger = options.logger ?? new NoopLogger();
    const metadata = createRuntimeMetadata({
      runtimeId: options.runtimeId,
      config: options.config,
      build: options.build,
    });
    const container = createRuntimeContainer({ logger, config: options.config, metadata });

    const serviceRegistry = new ServiceRegistry();
    const capabilityRegistry = new CapabilityRegistry();
    const pluginContext: PluginContext = {
      registerService: (service) => serviceRegistry.register(service),
      registerCapability: (capability) => capabilityRegistry.register(capability),
      container,
      config: options.config,
      logger,
    };

    applyPlugins(options.plugins ?? [], pluginContext);
    for (const service of options.services ?? []) serviceRegistry.register(service);

    const ordered = orderServices(serviceRegistry.all());
    if (!ordered.ok) throw ordered.error;

    return new Runtime({
      logger,
      metadata,
      container,
      config: options.config,
      capabilityRegistry,
      orderedServices: ordered.value,
      now: options.now,
      nextId: options.nextId,
    });
  }

  get status(): RuntimeState {
    return this.state;
  }

  get metadata(): RuntimeMetadata {
    return this.internals.metadata;
  }

  get container(): Container {
    return this.internals.container;
  }

  /** Registered capabilities (name-sorted). */
  capabilities(): Capability[] {
    return this.internals.capabilityRegistry.list();
  }

  /** Service names in deterministic start order. */
  serviceOrder(): string[] {
    return this.internals.orderedServices.map((s) => s.name);
  }

  /** Subscribe to technical lifecycle events; returns an unsubscribe function. */
  onEvent(listener: TechnicalEventListener): () => void {
    return this.bus.subscribe(listener);
  }

  /** Start services in dependency order. Idempotent: a no-op when already running. */
  async start(): Promise<void> {
    if (this.state === 'running') return;
    if (this.state !== 'created') {
      throw new LifecycleError(`Cannot start runtime from state "${this.state}"`, {
        context: { state: this.state },
      });
    }
    this.setState('begin_start');
    this.emit(RUNTIME_EVENTS.starting);
    try {
      for (const service of this.internals.orderedServices) {
        await service.start(this.serviceContext);
        this.emit(RUNTIME_EVENTS.serviceStarted, { service: service.name });
      }
    } catch (error) {
      this.setState('fail');
      throw error;
    }
    this.setState('complete_start');
    this.emit(RUNTIME_EVENTS.started, { services: this.internals.orderedServices.length });
  }

  /** Stop services in reverse order. Idempotent: a no-op when not running. */
  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'created') return;
    if (this.state !== 'running') {
      throw new LifecycleError(`Cannot stop runtime from state "${this.state}"`, {
        context: { state: this.state },
      });
    }
    this.setState('begin_stop');
    this.emit(RUNTIME_EVENTS.stopping);
    try {
      for (const service of [...this.internals.orderedServices].reverse()) {
        if (service.stop) {
          await service.stop(this.serviceContext);
          this.emit(RUNTIME_EVENTS.serviceStopped, { service: service.name });
        }
      }
    } catch (error) {
      this.setState('fail');
      throw error;
    }
    this.setState('complete_stop');
    this.emit(RUNTIME_EVENTS.stopped);
  }

  /** Aggregate health of the runtime + all services. */
  async health(): Promise<HealthReport> {
    const registry = buildRuntimeHealth(this.internals.orderedServices, () =>
      this.state === 'running' ? 'healthy' : 'unhealthy',
    );
    return registry.run();
  }

  private setState(trigger: RuntimeTrigger): void {
    const next = RUNTIME_MACHINE.nextState(this.state, trigger);
    if (!next.ok) {
      throw new LifecycleError(`Illegal runtime transition: ${this.state} --${trigger}-->`, {
        context: { state: this.state, trigger },
      });
    }
    this.state = next.value;
  }

  private emit(type: string, payload?: JsonObject): void {
    const id = makeEventId(this.internals.nextId());
    const occurredAt = makeTimestamp(this.internals.now());
    if (!id.ok) throw new LifecycleError('Injected id source produced an invalid event id');
    if (!occurredAt.ok) throw new LifecycleError('Injected clock produced an invalid timestamp');
    const event = technicalEvent({
      id: id.value,
      type,
      occurredAt: occurredAt.value,
      ...(payload ? { payload } : {}),
    });
    this.bus.publish(event);
    this.internals.logger.debug(type, payload);
  }
}
