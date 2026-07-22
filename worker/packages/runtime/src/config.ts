import type { Result } from '@workerv2/contracts';
import { ok } from '@workerv2/utils';
import { optionalEnv } from '@workerv2/config';
import type { EnvSource } from '@workerv2/config';
import type { ValidationError } from '@workerv2/errors';

/**
 * Runtime-level configuration — deliberately minimal and product-agnostic. Immutable once read.
 * Product/subsystem configuration is NOT modelled here; each subsystem loads its own later.
 */
export interface RuntimeConfig {
  readonly name: string;
  readonly environment: string;
}

const DEFAULT_NAME = 'worker-v2';
const DEFAULT_ENV = 'development';

/**
 * Read runtime config from an injected environment source (never `process.env` directly). Both
 * fields have safe defaults, so this is total — it returns `Result` only to keep the signature
 * uniform with validated config readers. The result is frozen (immutable metadata contract).
 */
export function readRuntimeConfig(env: EnvSource): Result<RuntimeConfig, ValidationError> {
  const config: RuntimeConfig = {
    name: optionalEnv(env, 'WORKER_V2_RUNTIME_NAME', DEFAULT_NAME) ?? DEFAULT_NAME,
    environment: optionalEnv(env, 'WORKER_V2_ENV', DEFAULT_ENV) ?? DEFAULT_ENV,
  };
  return ok(Object.freeze(config));
}
