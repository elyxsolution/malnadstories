import { z } from 'zod';
import { deleteObject } from '../r2.js';

const JobSchema = z.object({ keys: z.array(z.string().min(1)).max(2000) });

/**
 * Delete a batch of R2 object keys (album deletion cleanup). Idempotent: R2's
 * DeleteObject succeeds even if the object is already gone, so retries are safe and
 * re-deleting already-removed keys is harmless. If any delete throws (transient),
 * we throw so pg-boss retries the whole batch.
 */
export async function cleanupR2(rawInput: unknown): Promise<void> {
  const parsed = JobSchema.safeParse(rawInput);
  if (!parsed.success) {
    console.error('[worker] invalid r2-cleanup payload, dropping:', parsed.error.issues[0]?.message);
    return;
  }
  const { keys } = parsed.data;
  if (keys.length === 0) return;

  const failures: string[] = [];
  for (const key of keys) {
    try {
      await deleteObject(key);
    } catch (e) {
      console.error(`[worker] r2-cleanup delete failed for ${key}:`, (e as Error).message);
      failures.push(key);
    }
  }

  if (failures.length > 0) {
    // Throw → pg-boss retries the batch; already-deleted keys are no-ops on retry.
    throw new Error(`r2-cleanup: ${failures.length}/${keys.length} object deletes failed`);
  }

  console.log(`[worker] r2-cleanup removed ${keys.length} object(s)`);
}
