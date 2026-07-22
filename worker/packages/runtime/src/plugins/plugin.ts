import type { Container } from '@workerv2/di';
import type { Logger } from '@workerv2/logger';
import type { RuntimeConfig } from '../config.js';
import type { Service } from '../services/service.js';
import type { Capability } from '../capabilities/capability.js';

/**
 * What a plugin may contribute during registration. A plugin extends the runtime ADDITIVELY —
 * it registers services and capabilities and may register DI bindings via `container`. It runs
 * once, synchronously, at build time; it performs no work of its own (no jobs, no domain logic).
 */
export interface PluginContext {
  registerService(service: Service): void;
  registerCapability(capability: Capability): void;
  readonly container: Container;
  readonly config: RuntimeConfig;
  readonly logger: Logger;
}

/** A unit of additive runtime extension. */
export interface Plugin {
  readonly name: string;
  register(context: PluginContext): void;
}
