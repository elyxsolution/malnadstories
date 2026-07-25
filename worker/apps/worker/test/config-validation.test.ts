import { describe, it, expect } from 'vitest';
import {
  ConfigError,
  loadAppConfig,
  loadObservabilityConfig,
  summarizeConfig,
} from '../src/config.js';
import { validateAppConfig } from '../src/config-validation.js';

/** The minimum environment that turns infrastructure on. */
const INFRA_ENV: NodeJS.ProcessEnv = {
  WV2_INFRA: 'on',
  DIRECT_URL: 'postgres://user:secret@db.example.com:5432/postgres',
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'bucket',
};

describe('per-field configuration validation (parse time)', () => {
  it('rejects out-of-range integers, naming the variable', () => {
    expect(() => loadAppConfig({ WV2_POLL_INTERVAL_MS: '-5' })).toThrow(/WV2_POLL_INTERVAL_MS/);
    expect(() => loadAppConfig({ WV2_POLL_INTERVAL_MS: '0' })).toThrow(/WV2_POLL_INTERVAL_MS/);
    expect(() => loadAppConfig({ WV2_MONITOR_INTERVAL_MS: '10' })).toThrow(
      /WV2_MONITOR_INTERVAL_MS/,
    );
    expect(() => loadAppConfig({ PORT: '0' })).toThrow(/PORT/);
    expect(() => loadAppConfig({ PORT: '99999' })).toThrow(/PORT/);
  });

  it('rejects malformed booleans, enums and ratios rather than silently defaulting', () => {
    expect(() => loadAppConfig({ WV2_TRACING: 'maybe' })).toThrow(/WV2_TRACING/);
    expect(() => loadAppConfig({ WV2_LOG_FORMAT: 'xml' })).toThrow(/WV2_LOG_FORMAT/);
    expect(() => loadAppConfig({ WV2_TRACE_SAMPLE: '2' })).toThrow(/WV2_TRACE_SAMPLE/);
    expect(() => loadAppConfig({ WV2_TRACE_SAMPLE: 'half' })).toThrow(/WV2_TRACE_SAMPLE/);
  });

  it('validates URL shape at boot instead of on the first PDF job', () => {
    expect(() => loadAppConfig({ ...INFRA_ENV, APP_URL: 'not-a-url' })).toThrow(/APP_URL/);
    expect(() => loadAppConfig({ ...INFRA_ENV, APP_URL: 'ftp://example.com' })).toThrow(
      /http or https/,
    );
    const config = loadAppConfig({ ...INFRA_ENV, APP_URL: 'https://app.example.com/' });
    expect(config.infrastructure?.render.appUrl).toBe('https://app.example.com');
  });

  it('validates concurrency, retry limits and memory limits', () => {
    expect(() => loadAppConfig({ ...INFRA_ENV, WV2_DB_MAX_CONNECTIONS: '0' })).toThrow(
      /WV2_DB_MAX_CONNECTIONS/,
    );
    expect(() => loadAppConfig({ ...INFRA_ENV, WV2_RECOVERY_PDF_MAX_ATTEMPTS: '0' })).toThrow(
      /WV2_RECOVERY_PDF_MAX_ATTEMPTS/,
    );
    expect(() => loadAppConfig({ WV2_MEMORY_SOFT_LIMIT_MB: '0' })).toThrow(
      /WV2_MEMORY_SOFT_LIMIT_MB/,
    );
  });

  it('still fails fast on the pre-existing storage requirement', () => {
    expect(() => loadAppConfig({ WV2_STORAGE: 'filesystem' })).toThrow(ConfigError);
  });

  it('accepts the runtime\'s "warning" level spelling for one shared variable', () => {
    expect(loadObservabilityConfig({ WV2_LOG_LEVEL: 'warning' }).level).toBe('warn');
    expect(loadObservabilityConfig({ WV2_LOG_LEVEL: 'nonsense' }).level).toBe('info'); // degrades
  });
});

describe('cross-field configuration validation (assembled)', () => {
  it('rejects a soft memory limit at or above the hard limit', () => {
    expect(() =>
      loadAppConfig({ WV2_MEMORY_SOFT_LIMIT_MB: '2048', WV2_MEMORY_HARD_LIMIT_MB: '1024' }),
    ).toThrow(/soft memory limit must be below the hard limit/);
  });

  it("rejects a PDF stale threshold shorter than a render's own worst case", () => {
    // A shorter threshold would make the sweep re-drive renders that are still legitimately running.
    expect(() => loadAppConfig({ ...INFRA_ENV, WV2_RECOVERY_PDF_STALE_MS: '120000' })).toThrow(
      /worst-case runtime/,
    );
  });

  it('reports EVERY error at once rather than one restart at a time', () => {
    try {
      loadAppConfig({
        ...INFRA_ENV,
        WV2_MEMORY_SOFT_LIMIT_MB: '2048',
        WV2_MEMORY_HARD_LIMIT_MB: '1024',
        WV2_RECOVERY_PDF_STALE_MS: '120000',
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/WV2_MEMORY_SOFT_LIMIT_MB/);
      expect(message).toMatch(/WV2_RECOVERY_PDF_STALE_MS/);
    }
  });

  it('surfaces non-fatal problems as warnings and still starts', () => {
    const config = loadAppConfig({ ...INFRA_ENV, WV2_STORAGE: 'memory' });
    expect(config.warnings.some((w) => w.startsWith('WV2_STORAGE:'))).toBe(true);
    expect(config.infrastructure).not.toBeNull(); // loaded successfully despite the warning
  });

  it('warns when tracing is on but sampled to zero', () => {
    const config = loadAppConfig({ WV2_TRACING: 'on', WV2_TRACE_SAMPLE: '0' });
    expect(config.warnings.some((w) => w.startsWith('WV2_TRACE_SAMPLE:'))).toBe(true);
  });

  it('warns about an oversized connection pool and an oversized recovery batch', () => {
    const issues = validateAppConfig(
      loadAppConfig({ ...INFRA_ENV, WV2_DB_MAX_CONNECTIONS: '50', WV2_RECOVERY_BATCH: '5000' }),
    );
    const fields = issues.map((i) => i.field);
    expect(fields).toContain('WV2_DB_MAX_CONNECTIONS');
    expect(fields).toContain('WV2_RECOVERY_BATCH');
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('a default configuration, and a fully-specified production one, are clean', () => {
    expect(loadAppConfig({}).warnings).toEqual([]);
    // A real deployment pairs infrastructure with durable storage, which is what makes restart
    // recovery meaningful — that combination produces no warnings at all.
    expect(
      validateAppConfig(
        loadAppConfig({ ...INFRA_ENV, WV2_STORAGE: 'filesystem', WV2_STORAGE_ROOT: '/data' }),
      ),
    ).toEqual([]);
  });
});

describe('configuration summary is safe to expose', () => {
  it('reports shape, never secret values', () => {
    const summary = summarizeConfig(
      loadAppConfig({ ...INFRA_ENV, APP_URL: 'https://app.example.com' }),
    );
    const serialized = JSON.stringify(summary);

    expect(summary).toMatchObject({
      storage: 'memory',
      infrastructure: 'enabled',
      logFormat: 'json',
      tracing: true,
    });
    // The connection string, bucket credentials and secret key never appear.
    expect(serialized).not.toMatch(/postgres:\/\//);
    expect(serialized).not.toMatch(/secret/i);
    expect(serialized).not.toMatch(/bucket/);
    // The app origin IS included — it is not a secret and it is the first thing to check.
    expect(summary['appUrl']).toBe('https://app.example.com');
  });

  it('includes the observability settings an operator needs to interpret the logs', () => {
    const summary = summarizeConfig(loadAppConfig({ WV2_LOG_LEVEL: 'debug' }));
    expect(summary).toMatchObject({
      logLevel: 'debug',
      memorySoftLimitMb: 768,
      memoryHardLimitMb: 1536,
      monitorIntervalMs: 30_000,
    });
  });
});
