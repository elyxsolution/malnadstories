import { Container, token } from '@workerv2/di';
import type { Token } from '@workerv2/di';
import type { Logger } from '@workerv2/logger';
import type { RuntimeConfig } from './config.js';
import type { RuntimeMetadata } from './metadata.js';

/** Well-known DI tokens the runtime provides to every service and plugin. */
export const LoggerToken: Token<Logger> = token<Logger>('runtime.logger');
export const ConfigToken: Token<RuntimeConfig> = token<RuntimeConfig>('runtime.config');
export const MetadataToken: Token<RuntimeMetadata> = token<RuntimeMetadata>('runtime.metadata');

/**
 * Create the runtime's root DI container pre-populated with the well-known runtime values, so
 * services/plugins can resolve the logger, config, and metadata without bespoke wiring.
 */
export function createRuntimeContainer(deps: {
  logger: Logger;
  config: RuntimeConfig;
  metadata: RuntimeMetadata;
}): Container {
  const container = new Container();
  container.registerValue(LoggerToken, deps.logger);
  container.registerValue(ConfigToken, deps.config);
  container.registerValue(MetadataToken, deps.metadata);
  return container;
}
