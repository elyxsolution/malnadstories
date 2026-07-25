import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * ENVIRONMENT FILE LOADING.
 *
 * Worker V2 previously read `process.env` and nothing else. On Render that is correct — the platform
 * injects everything — but locally it meant a developer with a fully-populated `.env.local` still
 * booted into reference mode, because the worker never looked at the file. The worker appeared
 * healthy, processed nothing, and gave no hint why. This module closes that gap.
 *
 * THE CONVENTION IS REUSED, NOT INVENTED. The repository already has one:
 *
 *   • repo-root `.env.local` — the shared secret file. Next.js loads it automatically, and it is
 *     already git-ignored (`.env*.local`). It holds `DIRECT_URL` and the `R2_*` credentials that the
 *     app and the worker deliberately share, so there is one source of truth for a secret.
 *   • `worker/.env` — a worker-only override. Already git-ignored (repo-root `.gitignore` line 11),
 *     which shows it was always the intended place for worker-specific settings.
 *
 * Both are honoured. No new file name is introduced.
 *
 * PRECEDENCE — nearest wins, and the real environment always wins:
 *
 *     process.env  >  <cwd>/.env.local  >  <cwd>/.env  >  <parent>/.env.local  >  … up to the root
 *
 * `override: false` is the load-bearing detail. A variable already present in `process.env` is never
 * replaced, so Render/Docker injection cannot be clobbered by a stray file baked into an image, and
 * an explicit `WV2_INFRA=on node dist/main.js` always beats whatever a file says. That is what keeps
 * this safe to run unconditionally in production rather than gating it behind a dev-only flag.
 *
 * Walking UP from the working directory is what makes it work from every launch point without
 * configuration: `apps/worker` (pnpm dev), `worker/` (pnpm start), the repo root, and `/app` in the
 * container — where no files exist, so it is a silent no-op.
 */

/** How many directory levels to walk up. Enough to reach the repo root from `worker/apps/worker`. */
const MAX_DEPTH = 6;

/** The file names tried at each level, in precedence order. Mirrors the app's Next.js convention. */
const FILE_NAMES = ['.env.local', '.env'] as const;

export interface EnvFileLoad {
  /** Absolute path of the file. */
  readonly path: string;
  /** Variables this file actually CONTRIBUTED (already-set ones are not counted — they were kept). */
  readonly applied: number;
}

export interface EnvLoadResult {
  /** Files found and read, in the order they were applied (nearest first). */
  readonly files: readonly EnvFileLoad[];
  /** Total variables contributed across all files. */
  readonly applied: number;
}

export interface LoadEnvOptions {
  /** Directory to start walking up from. Defaults to the process working directory. */
  readonly cwd?: string;
  /** Target environment object. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Load `.env.local` / `.env` from the working directory upward into `env`, without overriding
 * anything already set. Returns what was loaded, so startup can report it.
 *
 * Never throws: a malformed or unreadable file must not stop the worker from starting, because the
 * real environment may already contain everything it needs.
 */
export function loadEnvFiles(options: LoadEnvOptions = {}): EnvLoadResult {
  const target = options.env ?? process.env;
  const files: EnvFileLoad[] = [];
  let directory = resolve(options.cwd ?? process.cwd());

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    for (const name of FILE_NAMES) {
      const path = join(directory, name);
      if (!existsSync(path)) continue;
      const applied = apply(path, target);
      if (applied !== null) files.push({ path, applied });
    }
    const parent = dirname(directory);
    if (parent === directory) break; // filesystem root
    directory = parent;
  }

  return { files, applied: files.reduce((sum, file) => sum + file.applied, 0) };
}

/** Read one file and merge it in. Returns the count contributed, or `null` if it could not be read. */
function apply(path: string, target: NodeJS.ProcessEnv): number | null {
  const before = Object.keys(target).length;
  const result = loadDotenv({ path, processEnv: target, override: false, quiet: true });
  if (result.error !== undefined) return null; // unreadable/malformed — ignore, never fail startup
  return Object.keys(target).length - before;
}

/**
 * Render the loaded files for the startup report. Paths only — a path is not a secret, and knowing
 * WHICH file supplied the configuration is the single most useful fact when a value is unexpected.
 */
export function describeEnvFiles(result: EnvLoadResult): readonly string[] {
  return result.files.map((file) => `${file.path} (+${file.applied})`);
}
