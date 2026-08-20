/**
 * PREVIEW-PDF RECLAMATION — manual entrypoint.
 *
 *   pnpm preview-pdf-cleanup                 (DRY RUN — nothing is deleted)
 *   pnpm preview-pdf-cleanup -- --execute    (deletes VERIFIED preview-PDF orphans)
 *
 * DEFAULTS TO DRY RUN, and dry run is not a flag the code checks — it is a different executor that
 * holds no deleter at all (see `executor.ts`). `--execute` is the only path that ever constructs
 * an S3 client capable of `DeleteObject`, and it refuses a grace period below the shared 24h floor.
 *
 * No credentials are accepted from arguments; the environment is the only source.
 */

import { writeFileSync } from 'node:fs';
import { loadEnvFiles } from '../../env.js';
import { ORPHAN_MIN_AGE_MS, R2ReadOnlyLister } from '../orphan-scan/index.js';
import { reclaimPreviewPdfs } from './reclaim.js';
import { R2VerifiedPreviewDeleter, previewDryRunExecutor, previewExecutingExecutor } from './executor.js';
import { MIN_DESTRUCTIVE_AGE_MS, type PreviewCleanupReport } from './model.js';

function outcomeLine(r: PreviewCleanupReport): string {
  if (r.aborted) return `ABORTED before deletion — ${r.abortReason ?? 'no reason recorded'}`;
  if (r.deleteFailed > 0 || r.deleteVerificationFailed > 0) {
    return `PARTIAL — ${r.deleted} deleted, ${r.deleteFailed} failed, ${r.deleteVerificationFailed} unverified.`;
  }
  if (r.deleted > 0) return `DELETED ${r.deleted} preview PDF(s), ${r.bytesReclaimed} bytes reclaimed.`;
  if (r.mode === 'dry-run' && r.verifiedCandidates > 0) {
    return `DRY RUN — ${r.verifiedCandidates} preview PDF(s) WOULD be deleted. Nothing was deleted.`;
  }
  if (r.candidates > 0) {
    return `NOTHING DELETED — ${r.candidates} candidate(s), all protected by revalidation.`;
  }
  return 'NOTHING ELIGIBLE — no preview-PDF orphans.';
}

interface Args {
  readonly minAgeMs: number;
  readonly execute: boolean;
  readonly json: boolean;
  readonly jsonOut: string | null;
}

function usage(): string {
  return [
    '',
    'Preview-PDF orphan reclamation (Phase 6 Prompt 13). DEFAULTS TO DRY RUN.',
    '',
    'Usage:',
    '  preview-pdf-cleanup [--execute] [--min-age-hours <n>] [--json] [--json-out <path>]',
    '',
    'A preview PDF is reclaimable ONLY when ALL of these hold:',
    '  · the key is a structurally valid {userId}/albums/{albumId}/preview.pdf',
    '  · NO album_pdfs row references that exact key',
    '  · the owning album DOES NOT EXIST (a live album may still adopt the object via recovery)',
    '  · it is older than the grace period (default 24h; --execute never accepts less)',
    '  · it is not inside an admin namespace (cover-templates/, album-products/, stickers/)',
    '',
    'Options:',
    '  --execute             ACTUALLY DELETE verified orphans (default: dry run, deletes nothing)',
    `  --min-age-hours <n>   grace period (default ${ORPHAN_MIN_AGE_MS / 3600000})`,
    '  --json                print the full report as JSON',
    '  --json-out <path>     write the full JSON report to a file',
    '',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): Args | { readonly error: string } {
  let minAgeMs = ORPHAN_MIN_AGE_MS;
  let execute = false;
  let json = false;
  let jsonOut: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--execute':
        execute = true;
        break;
      case '--min-age-hours': {
        const raw = Number(argv[i + 1]);
        if (!Number.isFinite(raw) || raw < 0) return { error: '--min-age-hours must be a non-negative number' };
        minAgeMs = raw * 3600000;
        i += 1;
        break;
      }
      case '--json':
        json = true;
        break;
      case '--json-out': {
        const p = argv[i + 1];
        if (p === undefined) return { error: '--json-out requires a path' };
        jsonOut = p;
        i += 1;
        break;
      }
      case '--help':
      case '-h':
        return { error: 'help' };
      default:
        return { error: `unknown argument "${arg ?? ''}"` };
    }
  }
  return { minAgeMs, execute, json, jsonOut };
}

function printReport(r: PreviewCleanupReport): void {
  const head =
    r.mode === 'execute'
      ? '─────── PREVIEW-PDF CLEANUP — EXECUTE MODE (OBJECTS WERE DELETED) ───────'
      : '─────── PREVIEW-PDF CLEANUP — DRY RUN (NOTHING WAS DELETED) ───────';
  const lines = [
    '',
    head,
    `  runId                  ${r.runId}`,
    `  mode                   ${r.mode}`,
    `  minAgeHours            ${r.minAgeHours}`,
    `  scanComplete           ${r.scanComplete}`,
    `  revalidationComplete   ${r.revalidationComplete}`,
    '',
    `  objects scanned        ${r.scannedObjects}`,
    `  preview PDFs seen      ${r.previewPdfsSeen}`,
    `    owned (live)         ${r.owned}`,
    `    album still exists   ${r.albumStillExists}`,
    `    recent (grace)       ${r.recentUnconfirmed}`,
    `    unknown age          ${r.unknownAge}`,
    `    clock-skew protected ${r.clockSkewProtected}`,
    `    malformed            ${r.malformed}`,
    `    undetermined         ${r.undetermined}`,
    `  orphan candidates      ${r.candidates}`,
    '',
    `  verified candidates    ${r.verifiedCandidates}`,
    `    owned at recheck     ${r.ownedAtRecheck}`,
    `    album exists recheck ${r.albumExistsAtRecheck}`,
    `    missing at recheck   ${r.missingAtRecheck}`,
    `    changed since scan   ${r.changedSinceScan}`,
    `    recent at recheck    ${r.recentAtRecheck}`,
    `    r2 errors            ${r.r2Errors}`,
    '',
    `  delete attempted       ${r.deleteAttempted}`,
    `  deleted                ${r.deleted}`,
    `  delete failed          ${r.deleteFailed}`,
    `  delete unverified      ${r.deleteVerificationFailed}`,
    `  bytes reclaimed        ${r.bytesReclaimed}`,
    '',
    `  OUTCOME: ${outcomeLine(r)}`,
  ];
  const acted = r.objects.filter((o) => o.action === 'PLANNED' || o.action === 'DELETED');
  if (acted.length > 0) {
    lines.push('', `  ${r.mode === 'execute' ? 'DELETED' : 'WOULD DELETE (dry run)'} — ${acted.length} object(s):`);
    for (const o of acted) lines.push(`    ${o.key}  ${o.sizeBytes ?? '?'}B  album=${o.albumId ?? '?'}`);
    if (r.mode === 'dry-run') lines.push('  Re-run with --execute to delete these.');
  }
  const refused = r.objects.filter((o) => o.action === 'SKIPPED');
  if (refused.length > 0) {
    lines.push('', `  PROTECTED BY REVALIDATION — ${refused.length}:`);
    for (const o of refused) lines.push(`    ${o.key}  ${o.revalidatedClassification} — ${o.reason}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function readEnv(env: NodeJS.ProcessEnv):
  | { ok: true; value: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string; bucket: string; databaseUrl: string } }
  | { ok: false; missing: readonly string[] } {
  const names = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'DIRECT_URL'] as const;
  const missing = names.filter((n) => (env[n] ?? '').trim().length === 0);
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    value: {
      endpoint: env['R2_ENDPOINT'] as string,
      region: env['R2_REGION'] ?? 'auto',
      accessKeyId: env['R2_ACCESS_KEY_ID'] as string,
      secretAccessKey: env['R2_SECRET_ACCESS_KEY'] as string,
      bucket: env['R2_BUCKET_NAME'] as string,
      databaseUrl: env['DIRECT_URL'] as string,
    },
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    if (parsed.error !== 'help') process.stderr.write(`${parsed.error}\n`);
    process.stdout.write(`${usage()}\n`);
    return parsed.error === 'help' ? 0 : 2;
  }

  loadEnvFiles();
  const env = readEnv(process.env);
  if (!env.ok) {
    process.stderr.write(`missing required environment: ${env.missing.join(', ')}\n`);
    return 2;
  }

  // THE HARD FLOOR, enforced before any client is built (the reclaim core enforces it again).
  if (parsed.execute && parsed.minAgeMs < MIN_DESTRUCTIVE_AGE_MS) {
    process.stderr.write(
      [
        '',
        'REFUSING TO EXECUTE.',
        `  requested --min-age-hours : ${parsed.minAgeMs / 3600000}`,
        `  minimum for --execute     : ${MIN_DESTRUCTIVE_AGE_MS / 3600000}h`,
        '  Drop --execute to inspect this age range as a dry run (which deletes nothing).',
        '',
      ].join('\n'),
    );
    return 2;
  }

  const lister = R2ReadOnlyLister.fromConfig({
    endpoint: env.value.endpoint,
    region: env.value.region,
    accessKeyId: env.value.accessKeyId,
    secretAccessKey: env.value.secretAccessKey,
    bucket: env.value.bucket,
  });

  const { default: postgres } = await import('postgres');
  const sql = postgres(env.value.databaseUrl, { max: 1, prepare: false });
  const db = {
    query: async <T = Record<string, unknown>>(text: string, params: readonly unknown[] = []) =>
      (await sql.unsafe(text, params as never[])) as unknown as readonly T[],
  };

  // THE ONLY PLACE A DELETE-CAPABLE CLIENT IS EVER CONSTRUCTED. In dry run this branch is not
  // taken, so no such client exists in the process at all.
  const executor = parsed.execute
    ? previewExecutingExecutor(
        R2VerifiedPreviewDeleter.fromConfig({
          endpoint: env.value.endpoint,
          region: env.value.region,
          accessKeyId: env.value.accessKeyId,
          secretAccessKey: env.value.secretAccessKey,
          bucket: env.value.bucket,
        }),
      )
    : previewDryRunExecutor();

  try {
    const report = await reclaimPreviewPdfs({
      lister,
      reader: lister,
      db,
      executor,
      minAgeMs: parsed.minAgeMs,
    });
    if (parsed.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else printReport(report);
    if (parsed.jsonOut !== null) writeFileSync(parsed.jsonOut, JSON.stringify(report, null, 2), 'utf8');
    if (report.aborted) return 2;
    if (report.deleteFailed > 0 || report.deleteVerificationFailed > 0) return 1;
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const invokedPath = process.argv[1] ?? '';
if (invokedPath.includes('preview-pdf-cleanup')) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
