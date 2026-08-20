/**
 * SAFE ORPHAN RECLAMATION — manual entrypoint.
 *
 *   pnpm --filter @workerv2/app orphan-cleanup -- --album <userId> <albumId>   (DRY RUN)
 *   pnpm --filter @workerv2/app orphan-cleanup -- --user  <userId>             (DRY RUN)
 *   pnpm --filter @workerv2/app orphan-cleanup -- --bucket                     (DRY RUN)
 *
 *   add --execute to actually delete.  Without it, NOTHING is ever deleted.
 *
 * DEFAULTS TO DRY RUN, and dry run is not a flag the code checks — it is a different executor
 * that holds no deleter at all (see `executor.ts`). The `--execute` path is the only one that
 * ever constructs an S3 client capable of `DeleteObject`.
 *
 * No credentials are accepted from arguments; the environment is the only source.
 */

import { writeFileSync } from 'node:fs';
import { loadEnvFiles } from '../../env.js';
import {
  ORPHAN_MIN_AGE_MS,
  R2ReadOnlyLister,
  resolveScope,
  type ScopeRequest,
} from '../orphan-scan/index.js';
import { runOrphanCleanup } from './cleanup.js';
import { R2VerifiedOrphanDeleter } from './deleter.js';
import { dryRunExecutor, executingExecutor } from './executor.js';
import { MIN_DESTRUCTIVE_AGE_MS, type CleanupReport } from './model.js';

/**
 * ONE unambiguous sentence naming which of the five possible situations occurred, so an operator
 * (or a log grep) never has to infer the outcome by comparing several counters.
 */
function outcomeLine(report: CleanupReport): string {
  if (report.aborted)
    return `ABORTED before deletion — ${report.abortReason ?? 'no reason recorded'}`;
  if (report.deleteFailed > 0 || report.deleteVerificationFailed > 0) {
    return `PARTIAL — ${report.deleted} deleted, ${report.deleteFailed} failed, ${report.deleteVerificationFailed} unverified. Re-run to retry the remainder.`;
  }
  if (report.deleted > 0)
    return `DELETED ${report.deleted} object(s), ${report.bytesReclaimed} bytes reclaimed.`;
  if (report.mode === 'dry-run' && report.verifiedCandidates > 0) {
    return `DRY RUN — ${report.verifiedCandidates} object(s) WOULD be deleted. Nothing was deleted.`;
  }
  if (report.candidatesFound > 0) {
    return `NOTHING DELETED — ${report.candidatesFound} candidate(s) found, all protected by revalidation.`;
  }
  return 'NOTHING ELIGIBLE — no orphan candidates in scope.';
}

interface Args {
  readonly scope: ScopeRequest;
  readonly minAgeMs: number;
  readonly execute: boolean;
  readonly json: boolean;
  readonly jsonOut: string | null;
}

function usage(): string {
  return [
    'Safe R2 orphan reclamation (Phase 6 Prompt 3). DEFAULTS TO DRY RUN.',
    '',
    'Usage:',
    '  orphan-cleanup --album <userId> <albumId>',
    '  orphan-cleanup --user  <userId>',
    '  orphan-cleanup --bucket',
    '',
    'Options:',
    '  --execute             ACTUALLY DELETE verified orphans (default: dry run, deletes nothing)',
    '  --min-age-hours <n>   grace period before an unowned object is a candidate (default 24)',
    '  --json                print the full report as JSON',
    '  --json-out <path>     write the full JSON report to a file',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): Args | { readonly error: string } {
  let scope: ScopeRequest | null = null;
  let minAgeMs = ORPHAN_MIN_AGE_MS;
  let execute = false;
  let json = false;
  let jsonOut: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--album': {
        const userId = argv[i + 1];
        const albumId = argv[i + 2];
        if (userId === undefined || albumId === undefined)
          return { error: '--album needs <userId> <albumId>' };
        scope = { kind: 'album', userId, albumId };
        i += 2;
        break;
      }
      case '--user': {
        const userId = argv[i + 1];
        if (userId === undefined) return { error: '--user needs <userId>' };
        scope = { kind: 'user', userId };
        i += 1;
        break;
      }
      case '--bucket':
        scope = { kind: 'bucket' };
        break;
      case '--execute':
        execute = true;
        break;
      case '--min-age-hours': {
        const raw = Number(argv[i + 1]);
        if (!Number.isFinite(raw) || raw < 0)
          return { error: '--min-age-hours must be a non-negative number' };
        minAgeMs = raw * 3600000;
        i += 1;
        break;
      }
      case '--json':
        json = true;
        break;
      case '--json-out': {
        const path = argv[i + 1];
        if (path === undefined) return { error: '--json-out needs <path>' };
        jsonOut = path;
        i += 1;
        break;
      }
      default:
        return { error: `unknown argument "${arg}"` };
    }
  }

  if (scope === null) return { error: 'a scope is required: --album, --user, or --bucket' };
  return { scope, minAgeMs, execute, json, jsonOut };
}

function readEnv(env: NodeJS.ProcessEnv):
  | {
      ok: true;
      value: {
        endpoint: string;
        region: string;
        accessKeyId: string;
        secretAccessKey: string;
        bucket: string;
        databaseUrl: string;
      };
    }
  | { ok: false; missing: readonly string[] } {
  const names = [
    'R2_ENDPOINT',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'DIRECT_URL',
  ] as const;
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

function printReport(report: CleanupReport): void {
  const head =
    report.mode === 'execute'
      ? '─────── R2 ORPHAN CLEANUP — EXECUTE MODE (OBJECTS WERE DELETED) ───────'
      : '─────── R2 ORPHAN CLEANUP — DRY RUN (NOTHING WAS DELETED) ───────';
  const lines = [
    '',
    head,
    `  cleanupId             ${report.cleanupId}`,
    `  scanId                ${report.scanId}`,
    `  mode                  ${report.mode}`,
    `  scope                 ${report.scope.kind}${report.scope.bucketWide ? '  (WHOLE BUCKET)' : ''}  prefix="${report.scope.prefix}"`,
    `  grace period          ${report.minAgeHours}h`,
    `  scanComplete          ${report.scanComplete ? 'true' : 'FALSE'}`,
    `  revalidationComplete  ${report.revalidationComplete ? 'true' : 'FALSE'}`,
    `  aborted               ${report.aborted ? `TRUE — ${report.abortReason ?? ''}` : 'false'}`,
    `  duration              ${report.durationMs}ms`,
    '',
    `  scanned objects       ${report.scannedObjects}`,
    `  orphan candidates     ${report.candidatesFound}`,
    `  VERIFIED (deletable)  ${report.verifiedCandidates}`,
    '',
    '  protected during revalidation:',
    `    OWNED_AT_RECHECK      ${report.ownedAtRecheck}`,
    `    MISSING_AT_RECHECK    ${report.missingAtRecheck}`,
    `    CHANGED_SINCE_SCAN    ${report.changedSinceScan}`,
    `    RECENT_AT_RECHECK     ${report.recentAtRecheck}`,
    `    UNKNOWN_AGE           ${report.unknownAge}`,
    `    CLOCK_SKEW_PROTECTED  ${report.clockSkewProtected}`,
    `    OUT_OF_SCOPE          ${report.outOfScope}`,
    `    UNDETERMINED          ${report.undetermined}`,
    `    R2_ERROR              ${report.r2Errors}`,
    '',
    `  delete attempted      ${report.deleteAttempted}`,
    `  DELETED               ${report.deleted}`,
    `  delete failed         ${report.deleteFailed}`,
    `  verification failed   ${report.deleteVerificationFailed}`,
    `  skipped / planned     ${report.skipped}`,
    `  bytes reclaimed       ${report.bytesReclaimed}`,
    '',
    `  OUTCOME: ${outcomeLine(report)}`,
    '',
  ];
  if (report.errors.length > 0) {
    lines.push('  ERRORS:');
    for (const e of report.errors.slice(0, 40))
      lines.push(`    [${e.stage}]${e.key ? ` ${e.key}` : ''} ${e.message}`);
    lines.push('');
  }
  const deleted = report.objects.filter((o) => o.action === 'DELETED');
  if (deleted.length > 0) {
    lines.push('  Deleted keys:');
    for (const o of deleted) lines.push(`    ${o.key}  ${o.finalSize ?? '?'}B`);
    lines.push('');
  }
  const planned = report.objects.filter((o) => o.action === 'PLANNED');
  if (planned.length > 0) {
    lines.push(`  WOULD DELETE (dry run) — ${planned.length} object(s):`);
    for (const o of planned.slice(0, 50)) lines.push(`    ${o.key}  ${o.finalSize ?? '?'}B`);
    if (planned.length > 50) lines.push(`    … and ${planned.length - 50} more`);
    lines.push('');
    lines.push('  Re-run with --execute to delete these.');
    lines.push('');
  }
  process.stdout.write(lines.join('\n') + '\n');
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    process.stderr.write(`${parsed.error}\n\n${usage()}\n`);
    return 2;
  }

  loadEnvFiles();
  const env = readEnv(process.env);
  if (!env.ok) {
    process.stderr.write(`Missing required environment variable(s): ${env.missing.join(', ')}\n`);
    return 2;
  }

  const scoped = resolveScope(parsed.scope);
  if (!scoped.ok) {
    process.stderr.write(`Invalid scope: ${scoped.error}\n`);
    return 2;
  }

  /**
   * THE DESTRUCTIVE-AGE FLOOR, surfaced early for a clear message.
   *
   * This is a courtesy check only — the AUTHORITATIVE gate lives in `runOrphanCleanup`, so a
   * programmatic caller or a future scheduler is protected even though it never reaches this
   * file. Duplicating it here just turns an abort report into a one-line explanation.
   */
  if (parsed.execute && parsed.minAgeMs < MIN_DESTRUCTIVE_AGE_MS) {
    process.stderr.write(
      [
        '',
        '  REFUSING TO EXECUTE.',
        `    requested grace period : ${parsed.minAgeMs / 3600000}h`,
        `    minimum for --execute  : ${MIN_DESTRUCTIVE_AGE_MS / 3600000}h`,
        '',
        '  An object younger than the grace period may be an upload whose confirm is still in',
        '  flight; R2 holds the only copy of its bytes. Destructive runs therefore cannot go',
        '  below the production grace period.',
        '',
        '  Drop --execute to inspect this age range as a dry run (which deletes nothing).',
        '',
      ].join('\n'),
    );
    return 2;
  }

  if (parsed.execute) {
    process.stderr.write(
      [
        '',
        '  ****************************************************************',
        '  WARNING: EXECUTE MODE — THIS WILL PERMANENTLY DELETE R2 OBJECTS.',
        '  DELETION IS IRREVERSIBLE. There is no undo and no recycle bin.',
        '',
        `  scope                 ${scoped.scope.kind}  prefix="${scoped.scope.prefix}"`,
        `  effective minimum age ${parsed.minAgeMs / 3600000}h`,
        '',
        '  ONLY verified orphaned RAW UPLOADS are eligible. Every object must pass:',
        '    · strict raw-upload key — derivatives (_full/_thumb), preview.pdf,',
        '      cover-templates/, album-products/ and stickers/ are NOT part of this',
        '      cleanup and cannot be deleted by it',
        '    · UNOWNED on a FRESH database lookup (owned photos are protected)',
        '    · unchanged since the scan (size + ETag + LastModified)',
        `    · at least ${parsed.minAgeMs / 3600000}h old on FRESH metadata`,
        '    · inside the requested scope, and nothing outside it',
        '',
        scoped.scope.bucketWide
          ? '  >>> WHOLE BUCKET CLEANUP — every album of every user is in scope. <<<\n'
          : '  Scoped run: objects outside the prefix above are untouched.\n',
        '  The exact number of objects to be deleted is printed after verification,',
        '  immediately before the first deletion.',
        '  ****************************************************************',
        '',
      ].join('\n'),
    );
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
    ? executingExecutor(
        R2VerifiedOrphanDeleter.fromConfig({
          endpoint: env.value.endpoint,
          region: env.value.region,
          accessKeyId: env.value.accessKeyId,
          secretAccessKey: env.value.secretAccessKey,
          bucket: env.value.bucket,
        }),
      )
    : dryRunExecutor();

  try {
    const report = await runOrphanCleanup({
      lister,
      reader: lister, // the same READ-ONLY object; heads and lists, cannot delete
      db,
      scope: scoped.scope,
      executor,
      minAgeMs: parsed.minAgeMs,
      onEvent: (e) => process.stderr.write(`${JSON.stringify(e)}\n`),
      /**
       * The last thing printed before anything is destroyed, with counts that are now EXACT
       * because every candidate has already been revalidated.
       */
      onPreDelete: (s) =>
        process.stderr.write(
          [
            '',
            '  ---------------- ABOUT TO DELETE ----------------',
            `    scope                ${s.scopeKind}${s.bucketWide ? ' (WHOLE BUCKET)' : ''}  prefix="${s.prefix}"`,
            `    effective min age    ${s.minAgeHours}h`,
            `    scanned objects      ${s.scannedObjects}`,
            `    orphan candidates    ${s.candidatesFound}`,
            `    passed verification  ${s.verifiedCandidates}`,
            `    protected / skipped  ${s.protectedCount}`,
            `    WILL DELETE NOW      ${s.aboutToDelete}`,
            '  -------------------------------------------------',
            '',
          ].join('\n'),
        ),
    });

    if (parsed.jsonOut !== null)
      writeFileSync(parsed.jsonOut, JSON.stringify(report, null, 2), 'utf8');
    if (parsed.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    else printReport(report);

    // Non-zero when the run aborted, revalidation was partial, or a delete failed — so a
    // half-finished cleanup can never be mistaken for a clean one.
    const clean =
      !report.aborted &&
      report.revalidationComplete &&
      report.deleteFailed === 0 &&
      report.deleteVerificationFailed === 0;
    return clean ? 0 : 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const invokedPath = process.argv[1] ?? '';
if (invokedPath.includes('orphan-cleanup')) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exit(1);
    });
}
