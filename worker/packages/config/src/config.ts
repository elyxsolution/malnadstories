import { deepFreeze } from '@workerv2/utils';
import type { DeepReadonly } from '@workerv2/contracts';
import { ConfigError } from '@workerv2/errors';

/**
 * A validator turns unknown raw input into a typed config value, or throws. Consumers plug
 * their own (e.g. a Zod `.parse`) — this framework holds NO schema library (dependency
 * inversion). Foundation config packages stay product-agnostic.
 */
export type ConfigValidator<T> = (raw: unknown) => T;

/**
 * Validate raw input into an immutable (deep-frozen) config object. Any validation failure
 * is normalized to a `ConfigError` (with the original thrown value as `cause`), so callers
 * catch one error type regardless of the validator used.
 */
export function loadConfig<T>(
  raw: unknown,
  validate: ConfigValidator<T>,
  label = 'config',
): DeepReadonly<T> {
  let parsed: T;
  try {
    parsed = validate(raw);
  } catch (cause) {
    throw new ConfigError(`Invalid ${label}`, { context: { label }, cause });
  }
  return deepFreeze(parsed);
}
