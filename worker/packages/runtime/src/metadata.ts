import type { BuildInfo } from '@workerv2/build-info';
import type { RuntimeConfig } from './config.js';

/**
 * Immutable identity + provenance of a runtime instance. Assembled once at construction and
 * never changed (requirement: immutable runtime metadata). `runtimeId` is injected — the
 * runtime never generates it (id generation is a composition-root concern).
 */
export interface RuntimeMetadata {
  readonly runtimeId: string;
  readonly name: string;
  readonly environment: string;
  readonly build: BuildInfo;
}

/** Build frozen `RuntimeMetadata` from an injected id, config, and build info. */
export function createRuntimeMetadata(input: {
  runtimeId: string;
  config: RuntimeConfig;
  build: BuildInfo;
}): RuntimeMetadata {
  return Object.freeze({
    runtimeId: input.runtimeId,
    name: input.config.name,
    environment: input.config.environment,
    build: input.build,
  });
}
