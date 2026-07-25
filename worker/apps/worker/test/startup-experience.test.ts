import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { loadEnvFiles, describeEnvFiles } from '../src/env.js';
import { ConfigError, infrastructureDisabledReason, loadAppConfig } from '../src/config.js';
import { infrastructureRequested, missingInfrastructureVars } from '../src/infra/config.js';
import { renderStartupBanner, startupModeFields } from '../src/startup-banner.js';

/**
 * STARTUP EXPERIENCE — the developer-facing behaviour, pinned.
 *
 * The bug these guard against is not a crash; it is a worker that boots, reports itself healthy, and
 * processes nothing while giving no indication why. Every assertion here is about whether the answer
 * is VISIBLE.
 */

const temporary: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wv2-env-'));
  temporary.push(dir);
  return dir;
}

afterEach(() => {
  while (temporary.length > 0) {
    const dir = temporary.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const INFRA_VARS = {
  DIRECT_URL: 'postgresql://u:p@h:5432/postgres',
  R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'bucket',
};

describe('environment file loading', () => {
  it('loads .env.local from the working directory', () => {
    const dir = scratch();
    writeFileSync(join(dir, '.env.local'), 'WV2_INFRA=on\nAPP_URL=https://example.com\n');
    const env: NodeJS.ProcessEnv = {};

    const result = loadEnvFiles({ cwd: dir, env });

    expect(env['WV2_INFRA']).toBe('on');
    expect(env['APP_URL']).toBe('https://example.com');
    expect(result.files).toHaveLength(1);
    expect(result.applied).toBe(2);
  });

  it('NEVER overrides an existing variable — Render/Docker injection always wins', () => {
    const dir = scratch();
    writeFileSync(join(dir, '.env.local'), 'WV2_INFRA=off\nAPP_URL=https://from-file.example\n');
    const env: NodeJS.ProcessEnv = { WV2_INFRA: 'on' }; // as if injected by the platform

    loadEnvFiles({ cwd: dir, env });

    expect(env['WV2_INFRA']).toBe('on'); // the file did NOT clobber it
    expect(env['APP_URL']).toBe('https://from-file.example'); // but it filled the gap
  });

  it('prefers .env.local over .env in the same directory', () => {
    const dir = scratch();
    writeFileSync(join(dir, '.env.local'), 'APP_URL=https://local.example\n');
    writeFileSync(join(dir, '.env'), 'APP_URL=https://plain.example\n');
    const env: NodeJS.ProcessEnv = {};

    loadEnvFiles({ cwd: dir, env });

    expect(env['APP_URL']).toBe('https://local.example');
  });

  it('walks UP to find the repo-root file — works from apps/worker, worker/ or the root', () => {
    const root = scratch();
    // Mirror the real layout: repo-root .env.local, launched from worker/apps/worker.
    writeFileSync(join(root, '.env.local'), 'DIRECT_URL=postgresql://from-root\n');
    const nested = join(root, 'worker', 'apps', 'worker');
    mkdirSync(nested, { recursive: true });
    const env: NodeJS.ProcessEnv = {};

    loadEnvFiles({ cwd: nested, env });

    expect(env['DIRECT_URL']).toBe('postgresql://from-root');
  });

  it('lets a NEARER file win over a farther one', () => {
    const root = scratch();
    writeFileSync(join(root, '.env.local'), 'APP_URL=https://root.example\n');
    const nested = join(root, 'worker');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, '.env'), 'APP_URL=https://worker.example\n');
    const env: NodeJS.ProcessEnv = {};

    loadEnvFiles({ cwd: nested, env });

    expect(env['APP_URL']).toBe('https://worker.example');
  });

  it('is a silent no-op when no files exist (the container case)', () => {
    const dir = scratch();
    const env: NodeJS.ProcessEnv = {};
    const result = loadEnvFiles({ cwd: dir, env });
    expect(result.files).toEqual([]);
    expect(result.applied).toBe(0);
    expect(describeEnvFiles(result)).toEqual([]);
  });

  it('reports which file supplied the values, for traceability', () => {
    const dir = scratch();
    writeFileSync(join(dir, '.env'), 'APP_URL=https://x.example\n');
    const described = describeEnvFiles(loadEnvFiles({ cwd: dir, env: {} }));
    expect(described[0]).toContain('.env');
    expect(described[0]).toContain('(+1)');
  });
});

describe('the WV2_INFRA switch', () => {
  it('accepts every common truthy spelling', () => {
    for (const value of ['on', 'true', '1', 'yes', 'ON', 'True']) {
      expect(infrastructureRequested({ WV2_INFRA: value })).toBe(true);
    }
  });

  it('accepts every common falsy spelling', () => {
    for (const value of ['off', 'false', '0', 'no']) {
      expect(infrastructureRequested({ WV2_INFRA: value })).toBe(false);
    }
  });

  it('defaults to disabled when unset', () => {
    expect(infrastructureRequested({})).toBe(false);
  });

  it('REJECTS an unrecognised value instead of silently disabling production mode', () => {
    // The old behaviour — `!== 'on'` — turned a typo into a healthy-looking worker that consumed
    // nothing. Failing loudly is the whole point.
    expect(() => infrastructureRequested({ WV2_INFRA: 'enabled' })).toThrow(/WV2_INFRA/);
    expect(() => loadAppConfig({ WV2_INFRA: 'yep' })).toThrow(ConfigError);
  });
});

describe('missing-variable reporting', () => {
  it('names EVERY missing variable at once, not just the first', () => {
    const missing = missingInfrastructureVars({ WV2_INFRA: 'on', DIRECT_URL: 'x' });
    expect(missing.map((v) => v.name)).toEqual([
      'R2_ENDPOINT',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET_NAME',
    ]);
  });

  it('treats a blank value as missing', () => {
    const missing = missingInfrastructureVars({ ...INFRA_VARS, DIRECT_URL: '   ' });
    expect(missing.map((v) => v.name)).toEqual(['DIRECT_URL']);
  });

  it('produces one actionable error listing all of them, with purposes', () => {
    let message = '';
    try {
      loadAppConfig({ WV2_INFRA: 'on' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DIRECT_URL');
    expect(message).toContain('R2_BUCKET_NAME');
    expect(message).toContain('port 5432'); // the purpose, so it is actionable
    expect(message).toContain('worker/.env.example'); // where to look
  });

  it('NEVER prints a value — only names', () => {
    let message = '';
    try {
      loadAppConfig({ WV2_INFRA: 'on', DIRECT_URL: 'postgresql://user:HUNTER2@host:5432/db' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('HUNTER2');
    expect(message).not.toContain('postgresql://');
  });

  it('starts cleanly once every variable is present', () => {
    const config = loadAppConfig({ WV2_INFRA: 'on', ...INFRA_VARS });
    expect(config.mode).toBe('production');
    expect(config.infrastructure).not.toBeNull();
  });
});

describe('mode reporting', () => {
  it('explains WHY infrastructure is disabled when the switch is unset', () => {
    const config = loadAppConfig({});
    expect(infrastructureDisabledReason(config, {})).toEqual({
      reason: 'WV2_INFRA is not set',
      expected: 'WV2_INFRA=on',
    });
  });

  it('distinguishes "not set" from "deliberately turned off"', () => {
    const config = loadAppConfig({ WV2_INFRA: 'off' });
    const why = infrastructureDisabledReason(config, { WV2_INFRA: 'off' });
    expect(why?.reason).toContain('"off"');
  });

  it('reports no reason at all in production mode', () => {
    const config = loadAppConfig({ WV2_INFRA: 'on', ...INFRA_VARS });
    expect(infrastructureDisabledReason(config, { WV2_INFRA: 'on' })).toBeNull();
  });

  it('the structured worker.mode record carries the real processor list', () => {
    const config = loadAppConfig({ WV2_INFRA: 'on', ...INFRA_VARS });
    const fields = startupModeFields({
      config,
      processors: ['image-hardening', 'album-pdf', 'r2-cleanup'],
      envFiles: ['/repo/.env.local (+6)'],
      workerVersion: '0.0.0',
      env: { WV2_INFRA: 'on' },
    });
    expect(fields).toMatchObject({
      mode: 'production',
      infrastructure: 'enabled',
      processorCount: 3,
      recovery: 'enabled',
    });
    expect(fields['processors']).toEqual(['image-hardening', 'album-pdf', 'r2-cleanup']);
  });
});

describe('the startup banner', () => {
  it('states reference mode, the reason, and the fix', () => {
    const config = loadAppConfig({ WV2_LOG_FORMAT: 'console' });
    const banner = renderStartupBanner({
      config,
      processors: [],
      envFiles: [],
      workerVersion: '0.0.0',
      env: {},
    });

    expect(banner).toContain('REFERENCE');
    expect(banner).toContain('no production jobs will be processed');
    expect(banner).toContain('WV2_INFRA is not set');
    expect(banner).toContain('WV2_INFRA=on');
    expect(banner).toContain('worker/.env.example');
    expect(banner).toContain('none found — using process.env only');
  });

  it('lists every registered processor by name in production mode', () => {
    const config = loadAppConfig({ WV2_INFRA: 'on', WV2_LOG_FORMAT: 'console', ...INFRA_VARS });
    const banner = renderStartupBanner({
      config,
      processors: ['image-hardening', 'album-pdf', 'r2-cleanup'],
      envFiles: ['/repo/.env.local (+6)'],
      workerVersion: '0.0.0',
      env: { WV2_INFRA: 'on' },
    });

    expect(banner).toContain('PRODUCTION');
    expect(banner).toContain('3 registered');
    expect(banner).toContain('✓ image-hardening');
    expect(banner).toContain('✓ album-pdf');
    expect(banner).toContain('✓ r2-cleanup');
    expect(banner).toContain('/repo/.env.local');
    // The old lie is gone: a working worker never reports "0".
    expect(banner).not.toContain('0 registered');
  });

  it('never leaks a secret into the banner', () => {
    const config = loadAppConfig({
      WV2_INFRA: 'on',
      WV2_LOG_FORMAT: 'console',
      WV2_DIAGNOSTICS_TOKEN: 'tok-SUPERSECRET',
      ...INFRA_VARS,
      DIRECT_URL: 'postgresql://user:HUNTER2@host:5432/db',
    });
    const banner = renderStartupBanner({
      config,
      processors: ['image-hardening'],
      envFiles: [],
      workerVersion: '0.0.0',
      env: { WV2_INFRA: 'on' },
    });

    expect(banner).not.toContain('HUNTER2');
    expect(banner).not.toContain('tok-SUPERSECRET');
    expect(banner).not.toContain('secret');
    expect(banner).toContain('protected'); // reports the STATE, not the token
  });

  it('says so plainly when running headless with no health endpoint', () => {
    const config = loadAppConfig({ WV2_LOG_FORMAT: 'console' });
    const banner = renderStartupBanner({
      config,
      processors: [],
      envFiles: [],
      workerVersion: '0.0.0',
      env: {},
    });
    expect(banner).toContain('headless');
  });
});
