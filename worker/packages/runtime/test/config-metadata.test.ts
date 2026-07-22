import { describe, expect, it } from 'vitest';
import { readRuntimeConfig, createRuntimeMetadata } from '@workerv2/runtime';
import { createBuildInfo } from '@workerv2/build-info';
import { unwrap as unwrapConfig } from './helpers.js';

describe('readRuntimeConfig', () => {
  it('applies safe defaults and freezes the result', () => {
    const cfg = unwrapConfig(readRuntimeConfig({}));
    expect(cfg).toStrictEqual({ name: 'worker-v2', environment: 'development' });
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it('reads injected env overrides', () => {
    const cfg = unwrapConfig(
      readRuntimeConfig({ WORKER_V2_RUNTIME_NAME: 'pdf-host', WORKER_V2_ENV: 'production' }),
    );
    expect(cfg).toStrictEqual({ name: 'pdf-host', environment: 'production' });
  });
});

describe('createRuntimeMetadata', () => {
  it('builds frozen, immutable metadata from id + config + build', () => {
    const build = createBuildInfo({ version: '1.2.3' }, () => 'v20.0.0');
    const config = unwrapConfig(readRuntimeConfig({ WORKER_V2_ENV: 'staging' }));
    const meta = createRuntimeMetadata({ runtimeId: 'rt-1', config, build });
    expect(meta).toStrictEqual({
      runtimeId: 'rt-1',
      name: 'worker-v2',
      environment: 'staging',
      build,
    });
    expect(Object.isFrozen(meta)).toBe(true);
  });
});
