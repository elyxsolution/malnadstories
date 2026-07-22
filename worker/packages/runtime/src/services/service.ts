import type { Container } from '@workerv2/di';
import type { Logger } from '@workerv2/logger';
import type { HealthCheck } from '@workerv2/health';
import type { RuntimeConfig } from '../config.js';
import type { RuntimeMetadata } from '../metadata.js';

/**
 * The environment a service receives on start/stop. Gives access to the DI container, the
 * runtime logger, config, and immutable metadata — everything a hosted component needs, and
 * nothing product-specific.
 */
export interface ServiceContext {
  readonly container: Container;
  readonly logger: Logger;
  readonly config: RuntimeConfig;
  readonly metadata: RuntimeMetadata;
}

/**
 * A hosted, long-lived runtime component with an ordered lifecycle. Generic: a service is
 * anything the runtime starts and stops (NOT a job/handler — those belong to later phases).
 * `dependencies` name other services that must start first.
 */
export interface Service {
  readonly name: string;
  readonly dependencies?: readonly string[];
  start(ctx: ServiceContext): void | Promise<void>;
  stop?(ctx: ServiceContext): void | Promise<void>;
  /** Optional health contribution, surfaced through the runtime health report. */
  healthCheck?(): HealthCheck;
}
