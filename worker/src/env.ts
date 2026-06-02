import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

// Single source of secrets: load the repo-root .env.local (../../.env.local from
// worker/src). The worker is trusted backend — these never reach the browser.
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../.env.local') });

const EnvSchema = z.object({
  // pg-boss needs a SESSION connection (port 5432), not the transaction pooler.
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required (session pooler / port 5432)'),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_ENDPOINT: z.string().url(),
  R2_BUCKET_NAME: z.string().min(1),
  R2_REGION: z.string().default('auto'),
  KEEP_RAW_ORIGINAL: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  WORKER_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[worker] Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
