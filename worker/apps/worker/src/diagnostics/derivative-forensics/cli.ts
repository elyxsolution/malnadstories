/**
 * DERIVATIVE OWNERSHIP FORENSICS — read-only report.
 *
 *   pnpm --filter @workerv2/app derivative-forensics
 *
 * READS ONLY. It lists R2 and runs SELECTs. There is no delete, no write, no queue insertion and
 * no scheduler anywhere in this directory — deliberately, because this slice exists to decide
 * WHETHER derivative cleanup could ever be safe, not to perform it.
 */

import { writeFileSync } from 'node:fs';
import { loadEnvFiles } from '../../env.js';
import { R2ReadOnlyLister } from '../orphan-scan/index.js';
import { buildDerivativeInventory, type DerivativeInventory } from './inventory.js';

function print(inv: DerivativeInventory): void {
  const lines = [
    '',
    '──────── R2 DERIVATIVE OWNERSHIP FORENSICS (READ-ONLY) ────────',
    `  generatedAt      ${inv.generatedAt}`,
    `  scanComplete     ${inv.scanComplete ? 'true' : 'FALSE — counts below are PARTIAL'}`,
    '',
    `  objects listed   ${inv.totalObjects}`,
    `  non-derivative   ${inv.nonDerivative}   (raw uploads, PDFs, admin namespaces)`,
    `  masters          ${inv.masters}`,
    `  thumbnails       ${inv.thumbnails}`,
    `  distinct bases   ${inv.distinctBases}`,
    `  master w/o thumb ${inv.masterWithoutThumbnail.length}`,
    `  thumb w/o master ${inv.thumbnailWithoutMaster.length}`,
    '',
    '  OWNERSHIP (authority = photos.sanitized_key / photos.thumb_key):',
    `    OWNED                  ${inv.owned}`,
    `    RECONSTRUCTED_PENDING  ${inv.reconstructedPending}   (legitimate mid-processing window)`,
    `    NO_DB_REFERENCE        ${inv.noDbReference}   ← NOT a deletion verdict`,
    '',
    `  photo rows             ${inv.photoRows}`,
    `    with sanitized_key   ${inv.photoRowsWithMasterKey}`,
    `    with thumb_key       ${inv.photoRowsWithThumbKey}`,
    `    dangling references  ${inv.danglingReferences.length}   (row names a key absent from R2)`,
    '',
    '  UNREFERENCED OBJECTS BY ALBUM STATE:',
    `    album still exists   ${inv.unreferencedInLiveAlbums}`,
    `    album deleted        ${inv.unreferencedInDeletedAlbums}`,
    `    distinct albums      ${inv.albumsWithUnreferenced}`,
    '',
  ];
  if (inv.errors.length > 0) {
    lines.push('  ERRORS (inventory is PARTIAL):');
    for (const e of inv.errors) lines.push(`    ${e}`);
    lines.push('');
  }
  lines.push('  This is a FORENSIC REPORT. Nothing was deleted and nothing can be:');
  lines.push('  this subsystem contains no deletion capability of any kind.');
  lines.push('');
  process.stdout.write(lines.join('\n') + '\n');
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let jsonOut: string | null = null;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') json = true;
    else if (argv[i] === '--json-out') {
      const p = argv[i + 1];
      if (p === undefined) {
        process.stderr.write('--json-out needs <path>\n');
        return 2;
      }
      jsonOut = p;
      i += 1;
    } else {
      process.stderr.write(`unknown argument "${argv[i]}"\n`);
      return 2;
    }
  }

  loadEnvFiles();
  const missing = [
    'R2_ENDPOINT',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'DIRECT_URL',
  ].filter((n) => (process.env[n] ?? '').trim().length === 0);
  if (missing.length > 0) {
    process.stderr.write(`Missing environment variable(s): ${missing.join(', ')}\n`);
    return 2;
  }

  const lister = R2ReadOnlyLister.fromConfig({
    endpoint: process.env['R2_ENDPOINT'] as string,
    region: process.env['R2_REGION'] ?? 'auto',
    accessKeyId: process.env['R2_ACCESS_KEY_ID'] as string,
    secretAccessKey: process.env['R2_SECRET_ACCESS_KEY'] as string,
    bucket: process.env['R2_BUCKET_NAME'] as string,
  });

  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env['DIRECT_URL'] as string, { max: 1, prepare: false });
  const db = {
    query: async <T = Record<string, unknown>>(text: string, params: readonly unknown[] = []) =>
      (await sql.unsafe(text, params as never[])) as unknown as readonly T[],
  };

  try {
    const inv = await buildDerivativeInventory({ lister, db });
    if (jsonOut !== null) writeFileSync(jsonOut, JSON.stringify(inv, null, 2), 'utf8');
    if (json) process.stdout.write(JSON.stringify(inv, null, 2) + '\n');
    else print(inv);
    return inv.scanComplete ? 0 : 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const invokedPath = process.argv[1] ?? '';
if (invokedPath.includes('derivative-forensics')) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exit(1);
    });
}
