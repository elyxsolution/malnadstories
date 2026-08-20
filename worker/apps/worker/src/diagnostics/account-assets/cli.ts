/**
 * ACCOUNT ASSET PREFLIGHT — read-only report.
 *
 *   pnpm --filter @workerv2/app account-assets -- --user <userUuid>
 *
 * Answers "why can't I delete this profile, and what would it strand?" after migration 0054
 * turned the silent cascade into a loud refusal.
 *
 * READS ONLY. `SELECT`s and nothing else: no delete, no update, no enqueue, no R2 call.
 */

import { loadEnvFiles } from '../../env.js';
import { collectAccountAssets, type AccountAssets } from './assets.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function print(a: AccountAssets): void {
  const lines = [
    '',
    '──────── ACCOUNT ASSET PREFLIGHT (READ-ONLY) ────────',
    `  user             ${a.userId}`,
    `  profile exists   ${a.profileExists ? 'yes' : 'NO'}`,
    `  delete blocked   ${a.deletionBlocked ? 'YES — 0054 RESTRICT would refuse this delete' : 'no'}`,
    '',
    `  albums           ${a.albums}`,
    `  photos           ${a.photos}   ${JSON.stringify(a.photosByStatus)}`,
    '',
    '  R2 objects still owned (from the explicit key columns):',
    `    raw uploads    ${a.rawKeys}`,
    `    masters        ${a.masterKeys}`,
    `    thumbnails     ${a.thumbnailKeys}`,
    `    preview PDFs   ${a.pdfKeys}`,
    `    distinct keys  ${a.keys.length}`,
    '',
    `  ${a.guidance}`,
    '',
    '  Nothing was deleted. This subsystem has no deletion capability.',
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let userId: string | null = null;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--user') {
      const v = argv[i + 1];
      if (v === undefined) {
        process.stderr.write('--user needs <userUuid>\n');
        return 2;
      }
      userId = v;
      i += 1;
    } else if (argv[i] === '--json') json = true;
    else {
      process.stderr.write(`unknown argument "${argv[i]}"\n`);
      return 2;
    }
  }
  if (userId === null) {
    process.stderr.write('usage: account-assets --user <userUuid> [--json]\n');
    return 2;
  }
  // Validated rather than interpolated — the id reaches SQL only as a bound parameter, and a
  // non-UUID never reaches the query at all.
  if (!UUID.test(userId)) {
    process.stderr.write('--user must be a canonical lowercase UUID\n');
    return 2;
  }

  loadEnvFiles();
  if ((process.env['DIRECT_URL'] ?? '').trim().length === 0) {
    process.stderr.write('Missing environment variable: DIRECT_URL\n');
    return 2;
  }

  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env['DIRECT_URL'] as string, { max: 1, prepare: false });
  const db = {
    query: async <T = Record<string, unknown>>(text: string, params: readonly unknown[] = []) =>
      (await sql.unsafe(text, params as never[])) as unknown as readonly T[],
  };

  try {
    const assets = await collectAccountAssets(db, userId);
    if (json) process.stdout.write(JSON.stringify(assets, null, 2) + '\n');
    else print(assets);
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const invokedPath = process.argv[1] ?? '';
if (invokedPath.includes('account-assets')) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exit(1);
    });
}
