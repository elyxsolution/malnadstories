import type PgBoss from 'pg-boss';
import { createBoss, IMAGE_HARDENING_QUEUE, type ImageHardeningJob } from './queue.js';
import { processPhoto } from './jobs/image-hardening.js';
import { supabase } from './supabase.js';
import { env } from './env.js';

const SEND_OPTS = { retryLimit: 3, retryDelay: 30, retryBackoff: true } as const;

/**
 * Self-healing sweep: re-enqueue any 'pending' photo with a raw object (covers a
 * missed enqueue from the app, a worker restart, or legacy rows from before the
 * pipeline existed). singletonKey dedupes against an already-queued job per photo.
 */
async function sweepPending(boss: PgBoss): Promise<void> {
  const { data, error } = await supabase
    .from('photos')
    .select('id')
    .eq('status', 'pending')
    .not('r2_key', 'is', null)
    .limit(500);
  if (error) {
    console.error('[worker] sweep query failed:', error.message);
    return;
  }
  const rows = (data ?? []) as { id: string }[];
  if (rows.length === 0) return;
  console.log(`[worker] sweeping ${rows.length} pending photo(s)`);
  for (const r of rows) {
    await boss.send(IMAGE_HARDENING_QUEUE, { photoId: r.id }, { ...SEND_OPTS, singletonKey: r.id });
  }
}

async function main(): Promise<void> {
  const boss = createBoss();
  boss.on('error', (e) => console.error('[worker] pg-boss error:', e));
  await boss.start();
  await boss.createQueue(IMAGE_HARDENING_QUEUE);

  await boss.work<ImageHardeningJob>(
    IMAGE_HARDENING_QUEUE,
    { pollingIntervalSeconds: 2 },
    async (jobs) => {
      for (const job of jobs) {
        await processPhoto(job.data);
      }
    },
  );

  console.log('[worker] image-hardening worker started');

  await sweepPending(boss);
  const timer = setInterval(() => {
    sweepPending(boss).catch((e) => console.error('[worker] sweep error:', e));
  }, env.WORKER_SWEEP_INTERVAL_MS);

  const shutdown = async () => {
    clearInterval(timer);
    await boss.stop({ graceful: true }).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[worker] fatal:', e);
  process.exit(1);
});
