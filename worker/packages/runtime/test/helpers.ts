import type { Result } from '@workerv2/contracts';
import { createBuildInfo } from '@workerv2/build-info';
import { readRuntimeConfig } from '@workerv2/runtime';
import type { RuntimeConfig, Service } from '@workerv2/runtime';

/** Force-unwrap a `Result` in tests; throws on the error branch. */
export function unwrap<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`unwrap() called on Err: ${String(r.error)}`);
  return r.value;
}

export const testBuild = createBuildInfo({ version: '0.0.0' }, () => 'v20.0.0');

export function testConfig(): RuntimeConfig {
  return unwrap(readRuntimeConfig({}));
}

/** A service that appends `start:<name>` / `stop:<name>` to a shared log when driven. */
export function recordingService(
  name: string,
  log: string[],
  dependencies?: readonly string[],
): Service {
  return {
    name,
    ...(dependencies ? { dependencies } : {}),
    start() {
      log.push(`start:${name}`);
    },
    stop() {
      log.push(`stop:${name}`);
    },
  };
}

/** A deterministic incrementing id source for technical-event ids. */
export function counterId(): () => string {
  let n = 0;
  return () => `evt-${++n}`;
}

export const fixedNow = (): Date => new Date('2026-07-22T00:00:00.000Z');
