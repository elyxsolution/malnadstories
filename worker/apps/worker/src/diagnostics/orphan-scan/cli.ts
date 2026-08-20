/**
 * MANUAL ENTRYPOINT for the read-only orphan scan.
 *
 *   pnpm --filter @workerv2/app orphan-scan -- --album <userId> <albumId>
 *   pnpm --filter @workerv2/app orphan-scan -- --user <userId>
 *   pnpm --filter @workerv2/app orphan-scan -- --bucket            (explicit whole-bucket scan)
 *
 *   optional: --min-age-hours <n>   --json   --json-out <path>   --max-objects <n>
 *
 * DELIBERATELY A SCRIPT, NOT A ROUTE. There is no HTTP surface, no admin UI, and no scheduler:
 * exposing a scanner that enumerates every customer's object keys would be a new data-egress
 * surface for no benefit, and scheduling belongs to a later phase. An operator runs this.
 *
 * CREDENTIALS COME FROM THE ENVIRONMENT ONLY — never from an argument. `loadEnvFiles()` is the
 * worker's existing discovery (repo-root `.env.local` upward), and `process.env` always wins.
 */

import { writeFileSync } from 'node:fs';
import { loadEnvFiles } from '../../env.js';
import { ORPHAN_MIN_AGE_MS, type OrphanScanReport } from './model.js';
import { R2ReadOnlyLister } from './object-lister.js';
import { resolveScope, type ScopeRequest } from './scope.js';
import { runOrphanScan } from './scan.js';

interface Args {
  readonly scope: ScopeRequest;
  readonly minAgeMs: number;
  readonly json: boolean;
  readonly jsonOut: string | null;
  readonly maxObjects: number | null;
}

function usage(): string {
  return [
    'Read-only R2 orphan detection (Phase 6). Deletes NOTHING.',
    '',
    'Usage:',
    '  orphan-scan --album <userId> <albumId>',
    '  orphan-scan --user  <userId>',
    '  orphan-scan --bucket                      (explicit whole-bucket scan)',
    '',
    'Options:',
    '  --min-age-hours <n>   grace period before an unowned object is a candidate (default 24)',
    '  --json                print the full report as JSON',
    '  --json-out <path>     write the full JSON report to a file',
    '  --max-objects <n>     stop after roughly n objects (bounded exploratory runs)',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): Args | { readonly error: string } {
  let scope: ScopeRequest | null = null;
  let minAgeMs = ORPHAN_MIN_AGE_MS;
  let json = false;
  let jsonOut: string | null = null;
  let maxObjects: number | null = null;

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
      case '--min-age-hours': {
        const raw = Number(argv[i + 1]);
        if (!Number.isFinite(raw) || raw < 0)
          return { error: '--min-age-hours must be a non-negative number' };
        minAgeMs = raw * 3600000;
        i += 1;
        break;
      }
      case '--max-objects': {
        const raw = Number(argv[i + 1]);
        if (!Number.isInteger(raw) || raw <= 0)
          return { error: '--max-objects must be a positive integer' };
        maxObjects = raw;
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
  return { scope, minAgeMs, json, jsonOut, maxObjects };
}

/** Required environment, read here and nowhere else in this subsystem. */
function readStorageEnv(env: NodeJS.ProcessEnv):
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

/** Operator-facing summary. Prints completeness FIRST, so a partial scan cannot read as clean. */
function printSummary(report: OrphanScanReport): void {
  const lines = [
    '',
    '─────────── R2 ORPHAN SCAN (READ-ONLY — NOTHING WAS DELETED) ───────────',
    `  scanId            ${report.scanId}`,
    `  scanComplete      ${report.scanComplete ? 'true' : 'FALSE  ← counts below are PARTIAL'}`,
    `  scope             ${report.scope.kind}${report.scope.bucketWide ? '  (WHOLE BUCKET)' : ''}  prefix="${report.scope.prefix}"`,
    `  graceperiod       ${report.minAgeHours}h   clock-skew allowance ${report.clockSkewAllowanceMinutes}m`,
    `  pages / lookups   ${report.pagesListed} listing pages, ${report.dbLookups} DB queries`,
    `  duration          ${report.durationMs}ms`,
    '',
    `  scanned                ${report.scanned}${report.duplicateListingEntries > 0 ? `  (${report.duplicateListingEntries} duplicate listing entries deduped)` : ''}`,
    `  not a raw upload       ${report.notRawUpload}`,
    `  raw-upload candidates  ${report.candidates}`,
    `    OWNED                ${report.owned}`,
    `    RECENT_UNCONFIRMED   ${report.recentUnconfirmed}   (protected)`,
    `    UNKNOWN_AGE          ${report.unknownAge}   (protected)`,
    `    CLOCK_SKEW_PROTECTED ${report.clockSkewProtected}   (protected)`,
    `    MALFORMED_KEY        ${report.malformed}   (protected)`,
    `    UNDETERMINED         ${report.undetermined}   (protected)`,
    `    ORPHAN_CANDIDATE     ${report.orphanCandidates}   ← investigate; NOT proven safe to delete`,
    `  unknownKey (rollup)    ${report.unknownKey}`,
    '',
  ];
  if (report.dbInconsistencies.length > 0) {
    lines.push('  DB INCONSISTENCIES:');
    for (const i of report.dbInconsistencies)
      lines.push(`    ${i.kind}: ${i.uploadKey} (${i.rowCount} rows)`);
    lines.push('');
  }
  if (report.errors.length > 0) {
    lines.push('  ERRORS (scan is PARTIAL):');
    for (const e of report.errors)
      lines.push(`    [${e.stage}]${e.page ? ` page ${e.page}` : ''} ${e.message}`);
    lines.push('');
  }
  if (report.orphanCandidates > 0) {
    lines.push('  Orphan candidates:');
    for (const o of report.objects) {
      if (o.classification !== 'ORPHAN_CANDIDATE') continue;
      const age = o.ageMs === null ? '?' : `${Math.round(o.ageMs / 3600000)}h`;
      lines.push(`    ${o.key}  ${o.sizeBytes ?? '?'}B  age=${age}`);
    }
    lines.push('');
    lines.push('  This phase is REPORT-ONLY. No deletion capability exists in this build.');
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

  loadEnvFiles(); // process.env always wins; never overridden
  const env = readStorageEnv(process.env);
  if (!env.ok) {
    process.stderr.write(`Missing required environment variable(s): ${env.missing.join(', ')}\n`);
    return 2;
  }

  const scoped = resolveScope(parsed.scope);
  if (!scoped.ok) {
    process.stderr.write(`Invalid scope: ${scoped.error}\n`);
    return 2;
  }

  const lister = R2ReadOnlyLister.fromConfig({
    endpoint: env.value.endpoint,
    region: env.value.region,
    accessKeyId: env.value.accessKeyId,
    secretAccessKey: env.value.secretAccessKey,
    bucket: env.value.bucket,
  });

  // postgres.js is already a worker dependency (the Supabase adapter uses it). A dedicated
  // single-connection client keeps this diagnostic isolated from the processors' pool.
  const { default: postgres } = await import('postgres');
  const sql = postgres(env.value.databaseUrl, { max: 1, prepare: false });
  const db = {
    query: async <T = Record<string, unknown>>(text: string, params: readonly unknown[] = []) =>
      (await sql.unsafe(text, params as never[])) as unknown as readonly T[],
  };

  try {
    const report = await runOrphanScan({
      lister,
      db,
      scope: scoped.scope,
      minAgeMs: parsed.minAgeMs,
      ...(parsed.maxObjects === null
        ? {}
        : { maxPages: Math.max(1, Math.ceil(parsed.maxObjects / 1000)) }),
      onProgress: ({ page, objects, scanId }) =>
        process.stderr.write(
          `${JSON.stringify({ event: 'orphan_scan.page', scanId, page, objects, prefix: scoped.scope.prefix })}\n`,
        ),
    });

    if (parsed.jsonOut !== null)
      writeFileSync(parsed.jsonOut, JSON.stringify(report, null, 2), 'utf8');
    if (parsed.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    else printSummary(report);

    // Non-zero on an incomplete scan so an operator (or CI) cannot mistake it for a clean result.
    return report.scanComplete ? 0 : 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Executed directly (not imported by a test)?
const invokedPath = process.argv[1] ?? '';
if (invokedPath.includes('orphan-scan')) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exit(1);
    });
}
