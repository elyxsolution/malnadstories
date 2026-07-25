import { describe, it, expect } from 'vitest';
import {
  loadInfrastructureConfig,
  createInfrastructure,
  preflightInfrastructure,
  closeInfrastructure,
  InfrastructureError,
  ConfigError,
} from '../src/infra/index.js';
import type {
  DatabaseAdapter,
  DatabaseTransaction,
  InfrastructureConfig,
  ManagedQueue,
  ObjectMetadata,
  ObjectStore,
} from '../src/infra/index.js';

type Health = 'healthy' | 'unhealthy';

class FakeQueue implements ManagedQueue {
  connected = false;
  closed = false;
  health: Health = 'healthy';
  async poll(): Promise<null> {
    return null;
  }
  async ack(): Promise<void> {}
  async nack(): Promise<void> {}
  async enqueue(): Promise<void> {}
  async connect(): Promise<void> {
    this.connected = true;
  }
  async healthCheck(): Promise<Health> {
    return this.health;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeObjectStore implements ObjectStore {
  health: Health = 'healthy';
  async read(): Promise<Uint8Array | null> {
    return null;
  }
  async write(key: string, data: Uint8Array): Promise<ObjectMetadata> {
    return { key, sizeBytes: data.byteLength };
  }
  async delete(): Promise<void> {}
  async exists(): Promise<boolean> {
    return false;
  }
  async head(): Promise<ObjectMetadata | null> {
    return null;
  }
  async healthCheck(): Promise<Health> {
    return this.health;
  }
}

class FakeDatabase implements DatabaseAdapter {
  connected = false;
  closed = false;
  health: Health = 'healthy';
  async connect(): Promise<void> {
    this.connected = true;
  }
  async query<T = Record<string, unknown>>(): Promise<readonly T[]> {
    return [];
  }
  async transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    return fn({ query: async () => [] });
  }
  async healthCheck(): Promise<Health> {
    return this.health;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

const FULL_ENV = {
  WV2_INFRA: 'on',
  DIRECT_URL: 'postgres://user:pass@host:5432/db',
  R2_ENDPOINT: 'https://acc.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'ak',
  R2_SECRET_ACCESS_KEY: 'sk',
  R2_BUCKET_NAME: 'bucket',
};

function fakes(): { queue: FakeQueue; objectStore: FakeObjectStore; database: FakeDatabase } {
  return {
    queue: new FakeQueue(),
    objectStore: new FakeObjectStore(),
    database: new FakeDatabase(),
  };
}

function config(): InfrastructureConfig {
  const c = loadInfrastructureConfig(FULL_ENV);
  if (c === null) throw new Error('expected config');
  return c;
}

describe('loadInfrastructureConfig', () => {
  it('is disabled (null) unless WV2_INFRA=on', () => {
    expect(loadInfrastructureConfig({})).toBeNull();
    expect(loadInfrastructureConfig({ DIRECT_URL: 'x', WV2_INFRA: 'off' })).toBeNull();
  });

  it('builds the full config from the shared env when enabled', () => {
    const c = config();
    expect(c.database.connectionString).toBe(FULL_ENV.DIRECT_URL);
    expect(c.queue.connectionString).toBe(FULL_ENV.DIRECT_URL);
    expect(c.queue.queues).toContain('image-hardening');
    expect(c.queue.queues).toContain('album-pdf');
    expect(c.storage).toMatchObject({
      endpoint: FULL_ENV.R2_ENDPOINT,
      bucket: 'bucket',
      region: 'auto',
    });
    expect(c.database.maxConnections).toBe(5);
  });

  it('fails fast when enabled but a required variable is missing', () => {
    expect(() => loadInfrastructureConfig({ WV2_INFRA: 'on' })).toThrow(ConfigError);
    const missingBucket = { ...FULL_ENV } as Record<string, string | undefined>;
    delete missingBucket['R2_BUCKET_NAME'];
    expect(() => loadInfrastructureConfig(missingBucket)).toThrow(/R2_BUCKET_NAME/);
  });
});

describe('createInfrastructure (dependency injection)', () => {
  it('returns the injected adapters instead of building real ones', () => {
    const f = fakes();
    const infra = createInfrastructure(config(), f);
    expect(infra.queue).toBe(f.queue);
    expect(infra.objectStore).toBe(f.objectStore);
    expect(infra.database).toBe(f.database);
  });
});

describe('preflightInfrastructure', () => {
  // Phase I-4: preflight no longer logs. It RETURNS the probe outcomes and the startup report
  // presents them, so connectivity is reported exactly once instead of in two disagreeing shapes.
  it('connects + health-probes every dependency and returns each outcome', async () => {
    const f = fakes();
    const probes = await preflightInfrastructure(createInfrastructure(config(), f));

    expect(f.database.connected).toBe(true);
    expect(f.queue.connected).toBe(true);
    expect(probes.map((p) => p.dependency)).toEqual(['database', 'queue', 'storage']);
    expect(probes.every((p) => p.state === 'healthy')).toBe(true);
    expect(probes.every((p) => typeof p.durationMs === 'number')).toBe(true);
  });

  it('throws InfrastructureError (fail fast) when a dependency is unhealthy', async () => {
    const f = fakes();
    f.database.health = 'unhealthy';
    await expect(preflightInfrastructure(createInfrastructure(config(), f))).rejects.toBeInstanceOf(
      InfrastructureError,
    );
  });
});

describe('closeInfrastructure', () => {
  it('closes the connection-holding adapters and reports failures', async () => {
    const f = fakes();
    const result = await closeInfrastructure(createInfrastructure(config(), f));
    expect(f.queue.closed).toBe(true);
    expect(f.database.closed).toBe(true);
    expect(result.failures).toBe(0);
  });
});
