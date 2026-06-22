import { NextResponse } from 'next/server';
import { rateLimit, sweepRateLimits } from '@/lib/rate-limit';
import { captureMessage } from '@/lib/observability/capture';

// Node runtime: the capture layer uses the service-role client + Node crypto.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CSP violation sink (Phase 10C). The Report-Only policy set in middleware points its
 * `report-uri` / `report-to` here. Browsers POST violations in one of two shapes:
 *   - legacy `application/csp-report`  → { "csp-report": { ... } }
 *   - modern `application/reports+json` → [ { type: 'csp-violation', body: { ... } }, ... ]
 *
 * NOT an admin surface — unauthenticated but IP-rate-limited and recorded through the
 * 10B capture layer (which re-sanitizes + dedupes by fingerprint, so a noisy directive
 * collapses to one growing row). Returns no data. This is the data feed that tells us
 * what an ENFORCED nonce policy would block before we flip enforcement on.
 */

type CspReportBody = {
  'document-uri'?: string;
  documentURL?: string;
  'violated-directive'?: string;
  'effective-directive'?: string;
  effectiveDirective?: string;
  'blocked-uri'?: string;
  blockedURL?: string;
  'source-file'?: string;
  sourceFile?: string;
  'line-number'?: number;
  lineNumber?: number;
};

function extractReports(payload: unknown): CspReportBody[] {
  if (Array.isArray(payload)) {
    // Reporting API: [{ type, body }, ...]
    return payload
      .filter((r) => r && typeof r === 'object' && (r as { type?: string }).type === 'csp-violation')
      .map((r) => (r as { body?: CspReportBody }).body ?? {});
  }
  if (payload && typeof payload === 'object' && 'csp-report' in payload) {
    return [(payload as { 'csp-report': CspReportBody })['csp-report'] ?? {}];
  }
  return [];
}

/** Drop query/hash so a violation message is stable (dedupes) and carries no URL PII. */
function trimUri(uri: string | undefined): string {
  if (!uri) return 'unknown';
  const cut = uri.split(/[?#]/)[0];
  return cut.length > 200 ? cut.slice(0, 200) : cut;
}

export async function POST(request: Request) {
  sweepRateLimits();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit(`csp-report:${ip}`, 30, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const requestId = request.headers.get('x-request-id');

  for (const report of extractReports(payload)) {
    const directive =
      report['effective-directive'] || report.effectiveDirective || report['violated-directive'] || 'unknown';
    const blocked = trimUri(report['blocked-uri'] || report.blockedURL);
    // Stable message → the 10B fingerprint collapses repeats into one row.
    const message = `CSP violation: ${directive} blocked ${blocked}`;

    await captureMessage(message, {
      source: 'csp',
      category: 'system',
      severity: 'warning',
      requestId,
      metadata: {
        directive,
        blockedUri: blocked,
        documentUri: trimUri(report['document-uri'] || report.documentURL),
        sourceFile: trimUri(report['source-file'] || report.sourceFile),
        lineNumber: report['line-number'] ?? report.lineNumber ?? null,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
