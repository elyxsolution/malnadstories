/**
 * WORKER → NEXT.JS CONNECTIVITY — end-to-end verification.
 *
 *   pnpm --filter @workerv2/app exec tsx scripts/verify-render-connectivity.ts [baseUrl]
 *
 * Drives the REAL `PuppeteerPageRenderer` with a REAL Chromium against a base URL, for all three
 * PDF kinds, and then deliberately points it at an unreachable host to confirm the diagnosis.
 *
 * With no argument it starts a local stand-in for the print routes, so the whole worker→browser→
 * HTTP path is exercised with no database and no deployment. Pass a base URL to check a real one
 * (the routes will 404 without a valid token — which still proves reachability, and the script
 * says so).
 *
 * This is a DIAGNOSTIC, not part of the test suite: it launches a browser and binds a port.
 */
import http from 'node:http';
import type { Browser } from 'puppeteer';
import { PuppeteerPageRenderer } from '../src/processors/pdf/puppeteer-renderer.js';
import { RenderTargetUnreachableError } from '../src/processors/pdf/page-renderer.js';
import { PDF_KINDS, PRINT_READY_FLAG, printUrl, redactToken } from '../src/processors/pdf/pdf-contract.js';

const ALBUM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN = 'b'.repeat(64);
const TIMEOUTS = {
  newPageMs: 20_000,
  navigationMs: 20_000,
  readinessMs: 20_000,
  settleMs: 3_000,
  pdfMs: 30_000,
};

/** A stand-in for the print routes: requires the token, then flips the readiness flag. */
async function startStandIn(): Promise<{ base: string; seen: string[]; close: () => void }> {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const ok = url.searchParams.get('t') === TOKEN;
    seen.push(`${url.pathname} token=${ok ? 'valid' : 'MISSING'}`);
    if (!ok) {
      res.writeHead(404).end('no token');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(
      `<!doctype html><html><head><style>@page{size:206mm 291mm;margin:0}html,body{margin:0}` +
        `.p{width:779px;height:1100px;background:#c0392b}</style></head><body><div class="p"></div>` +
        `<script>window.${PRINT_READY_FLAG}=true;</script></body></html>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${port}`, seen, close: () => server.close() };
}

async function main(): Promise<void> {
  const argBase = process.argv[2];
  const standIn = argBase ? null : await startStandIn();
  const base = argBase ?? standIn!.base;

  const puppeteer = await import('puppeteer');
  const browser: Browser = await puppeteer.default.launch({
    headless: 'shell',
    args: ['--no-sandbox'],
  });

  const renderer = new PuppeteerPageRenderer({
    acquire: async () => browser,
    reset: async () => {},
  } as never);

  console.log(`\nrender base URL: ${base}${standIn ? '  (local stand-in)' : ''}\n`);

  let failures = 0;
  for (const kind of PDF_KINDS) {
    const url = printUrl(base, ALBUM, TOKEN, kind);
    try {
      const out = await renderer.render({
        url,
        origin: new URL(base).origin,
        readinessFlag: PRINT_READY_FLAG,
        timeouts: TIMEOUTS,
      });
      console.log(
        `  ✓ ${kind.padEnd(13)} HTTP ${out.httpStatus}  ${out.pdf.byteLength} bytes  ← ${redactToken(url)}`,
      );
    } catch (error) {
      const e = error as Error & { reason?: string };
      const reachable = !(error instanceof RenderTargetUnreachableError);
      console.log(
        `  ${reachable ? '~' : '✗'} ${kind.padEnd(13)} ${e.name}${e.reason ? ` (${e.reason})` : ''}: ${e.message}`,
      );
      // A non-connectivity error against a REAL app (404 without a valid token) still proves the
      // network path works, which is what this script is checking.
      if (!reachable) failures++;
      else if (!argBase) failures++;
    }
  }

  if (standIn) {
    console.log('\n  routes Chromium actually requested:');
    for (const s of standIn.seen) console.log(`    ${s}`);
  }

  // A port that is genuinely closed: bind one, learn its number, then release it. This reproduces
  // the ORIGINAL incident exactly — a normal port with nothing listening — rather than relying on
  // Chromium's blocked-port list, which is a different failure.
  const closedPort = await (async () => {
    const s = http.createServer();
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    const p = (s.address() as { port: number }).port;
    await new Promise<void>((r) => s.close(() => r()));
    return p;
  })();

  console.log('\n  --- unreachable host (the original incident) ---');
  for (const [label, dead] of [
    ['connection refused', `http://127.0.0.1:${closedPort}`],
    ['blocked port', 'http://127.0.0.1:1'],
    ['unresolvable host', 'http://this-host-does-not-exist.invalid'],
  ] as const) {
    try {
      await renderer.render({
        url: printUrl(dead, ALBUM, TOKEN, 'preview'),
        origin: dead,
        readinessFlag: PRINT_READY_FLAG,
        timeouts: { ...TIMEOUTS, navigationMs: 8_000 },
      });
      console.log(`  ✗ ${label}: expected a failure, got a render`);
      failures++;
    } catch (error) {
      const e = error as Error & { reason?: string; origin?: string };
      const leaked = e.message.includes(TOKEN);
      console.log(`  ✓ ${label}: ${e.name} reason=${e.reason ?? '—'} tokenLeak=${leaked ? 'YES' : 'no'}`);
      console.log(`      ${e.message}`);
      if (leaked || !(error instanceof RenderTargetUnreachableError)) failures++;
    }
  }

  await browser.close();
  standIn?.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
