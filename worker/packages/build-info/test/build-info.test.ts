import { describe, expect, it } from 'vitest';
import { createBuildInfo, readBuildInfoFromEnv } from '@workerv2/build-info';

describe('createBuildInfo', () => {
  it('defaults everything and is frozen', () => {
    const info = createBuildInfo({}, () => 'v20.0.0');
    expect(info).toStrictEqual({
      version: '0.0.0',
      gitSha: 'unknown',
      builtAt: 'unknown',
      nodeVersion: 'v20.0.0',
      environment: 'unknown',
    });
    expect(Object.isFrozen(info)).toBe(true);
  });

  it('applies provided values', () => {
    const info = createBuildInfo(
      {
        version: '1.2.3',
        gitSha: 'abc',
        builtAt: '2026-07-22T00:00:00Z',
        environment: 'production',
      },
      () => 'v21.0.0',
    );
    expect(info).toStrictEqual({
      version: '1.2.3',
      gitSha: 'abc',
      builtAt: '2026-07-22T00:00:00Z',
      nodeVersion: 'v21.0.0',
      environment: 'production',
    });
  });
});

describe('readBuildInfoFromEnv', () => {
  it('reads conventional env vars, defaulting unset ones', () => {
    const info = readBuildInfoFromEnv(
      { WORKER_V2_VERSION: '2.0.0', WORKER_V2_ENV: 'staging' },
      () => 'v20.1.0',
    );
    expect(info.version).toBe('2.0.0');
    expect(info.environment).toBe('staging');
    expect(info.gitSha).toBe('unknown');
    expect(info.builtAt).toBe('unknown');
    expect(info.nodeVersion).toBe('v20.1.0');
  });
});
