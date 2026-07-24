import { describe, it, expect } from 'vitest';
import { PgBossQueueAdapter } from '../src/infra/queue/pgboss-queue.js';
import type { PgBossJobWithMetadata, PgBossLike } from '../src/infra/queue/pgboss-queue.js';

/** An in-memory fake of the pg-boss surface — lets us exercise the adapter with no database. */
class FakePgBoss implements PgBossLike {
  started = false;
  stopped = false;
  readonly createdQueues: string[] = [];
  readonly completed: Array<{ queue: string; id: string }> = [];
  readonly failed: Array<{ queue: string; id: string; data: object }> = [];
  private readonly queues = new Map<string, PgBossJobWithMetadata<Record<string, unknown>>[]>();

  async start(): Promise<unknown> {
    this.started = true;
    return undefined;
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
  async createQueue(name: string): Promise<void> {
    this.createdQueues.push(name);
  }
  readonly sent: Array<{ name: string; data: object }> = [];
  async send(name: string, data: object): Promise<string | null> {
    this.sent.push({ name, data });
    return 'sent-id';
  }
  async fetch<T>(name: string): Promise<PgBossJobWithMetadata<T>[]> {
    const queue = this.queues.get(name) ?? [];
    const next = queue.shift();
    return (next === undefined ? [] : [next]) as PgBossJobWithMetadata<T>[];
  }
  async complete(name: string, id: string): Promise<void> {
    this.completed.push({ queue: name, id });
  }
  async fail(name: string, id: string, data: object): Promise<void> {
    this.failed.push({ queue: name, id, data });
  }

  seed(queue: string, job: PgBossJobWithMetadata<Record<string, unknown>>): void {
    const existing = this.queues.get(queue) ?? [];
    existing.push(job);
    this.queues.set(queue, existing);
  }
}

function bossJob(
  id: string,
  data: Record<string, unknown>,
  retryCount = 0,
): PgBossJobWithMetadata<Record<string, unknown>> {
  return {
    id,
    name: 'x',
    data,
    retryCount,
    createdOn: new Date('2026-01-01T00:00:00.000Z'),
    singletonKey: null,
  };
}

const QUEUES = ['image-hardening', 'album-pdf'];

describe('PgBossQueueAdapter', () => {
  it('is unhealthy before connect and healthy after (connect declares every queue)', async () => {
    const boss = new FakePgBoss();
    const adapter = new PgBossQueueAdapter(boss, QUEUES);
    expect(await adapter.healthCheck()).toBe('unhealthy');

    await adapter.connect();

    expect(boss.started).toBe(true);
    expect(boss.createdQueues).toEqual(QUEUES);
    expect(await adapter.healthCheck()).toBe('healthy');
  });

  it('returns null when all queues are empty', async () => {
    const adapter = new PgBossQueueAdapter(new FakePgBoss(), QUEUES);
    expect(await adapter.poll()).toBeNull();
  });

  it('maps a pg-boss job into the generic Job envelope (type = queue, payload = data)', async () => {
    const boss = new FakePgBoss();
    boss.seed('image-hardening', bossJob('j1', { photoId: 'p1', correlationId: 'req-9' }, 2));
    const adapter = new PgBossQueueAdapter(boss, QUEUES);

    const job = await adapter.poll();

    expect(job).not.toBeNull();
    expect(job?.id).toBe('j1');
    expect(job?.type).toBe('image-hardening');
    expect(job?.payload).toEqual({ photoId: 'p1', correlationId: 'req-9' });
    expect(job?.metadata.correlationId).toBe('req-9'); // read from payload when present
    expect(job?.metadata.attempt).toBe(3); // retryCount (2) + 1
    expect(job?.enqueuedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('falls back to the job id for correlation when the payload carries none', async () => {
    const boss = new FakePgBoss();
    boss.seed('album-pdf', bossJob('j2', { albumId: 'a1' }));
    const adapter = new PgBossQueueAdapter(boss, QUEUES);
    const job = await adapter.poll();
    expect(job?.metadata.correlationId).toBe('j2');
  });

  it('polls queues in declared priority order', async () => {
    const boss = new FakePgBoss();
    boss.seed('album-pdf', bossJob('late', { albumId: 'a1' }));
    boss.seed('image-hardening', bossJob('early', { photoId: 'p1' }));
    const adapter = new PgBossQueueAdapter(boss, QUEUES);

    expect((await adapter.poll())?.id).toBe('early'); // image-hardening first
    expect((await adapter.poll())?.id).toBe('late');
    expect(await adapter.poll()).toBeNull();
  });

  it('acks by completing the job on its originating queue', async () => {
    const boss = new FakePgBoss();
    boss.seed('image-hardening', bossJob('j1', {}));
    const adapter = new PgBossQueueAdapter(boss, QUEUES);
    const job = await adapter.poll();

    await adapter.ack(job!.id);

    expect(boss.completed).toEqual([{ queue: 'image-hardening', id: 'j1' }]);
  });

  it('nacks by failing the job (pg-boss then retries/dead-letters per policy)', async () => {
    const boss = new FakePgBoss();
    boss.seed('album-pdf', bossJob('j2', {}));
    const adapter = new PgBossQueueAdapter(boss, QUEUES);
    const job = await adapter.poll();

    await adapter.nack(job!.id, new Error('boom'));

    expect(boss.failed).toEqual([{ queue: 'album-pdf', id: 'j2', data: { message: 'boom' } }]);
  });

  it('rejects ack/nack for an id it never polled', async () => {
    const adapter = new PgBossQueueAdapter(new FakePgBoss(), QUEUES);
    await expect(adapter.ack('ghost')).rejects.toThrow(/Unknown job id/);
  });

  it('close stops pg-boss and returns to unhealthy', async () => {
    const boss = new FakePgBoss();
    const adapter = new PgBossQueueAdapter(boss, QUEUES);
    await adapter.connect();
    await adapter.close();
    expect(boss.stopped).toBe(true);
    expect(await adapter.healthCheck()).toBe('unhealthy');
  });
});
