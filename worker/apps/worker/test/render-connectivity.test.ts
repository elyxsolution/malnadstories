/**
 * WORKER → NEXT.JS CONNECTIVITY.
 *
 * The failure this suite exists for: every PDF died with
 *
 *     net::ERR_CONNECTION_REFUSED at http://localhost:3000/albums/<id>/print?t=<token>
 *
 * while the queue, the worker, the processor and Chromium were all healthy. The cause was
 * configuration — `APP_URL` unset, so the render base URL silently defaulted to localhost, which
 * for Chromium means the WORKER's own machine. Three things are pinned here: the URL is built from
 * configuration for every kind, a defaulted base URL is reported rather than silent, and a
 * connection failure is diagnosed as a connection failure instead of a generic render error.
 */
import { describe, it, expect } from 'vitest';
import { ConfigError, parseRenderBaseUrl } from '../src/config-error.js';
import {
  PDF_KINDS,
  printUrl,
  redactToken,
  redactedPrintUrl,
  type PdfKind,
} from '../src/processors/pdf/pdf-contract.js';
import {
  classifyNetworkError,
  unreachableAdvice,
  RenderTargetUnreachableError,
  RendererCrashedError,
  PrintRouteError,
} from '../src/processors/pdf/page-renderer.js';

const TOKEN = 'a'.repeat(64);
const ALBUM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEFAULT_BASE = 'http://localhost:3000';

const resolve = (env: Record<string, string | undefined>) =>
  parseRenderBaseUrl(
    [
      { name: 'APP_URL', value: env['APP_URL'] },
      { name: 'PDF_RENDER_BASE_URL', value: env['PDF_RENDER_BASE_URL'] },
    ],
    DEFAULT_BASE,
  );

// ═════════════════════════════════════════════════════════════════════════════════════════════
// URL construction
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('the render URL is built from configuration', () => {
  it('uses the configured base for the preview route', () => {
    expect(printUrl('https://example.com', ALBUM, TOKEN, 'preview')).toBe(
      `https://example.com/albums/${ALBUM}/print?t=${TOKEN}`,
    );
  });

  it('routes each kind to its OWN page — never all three to one', () => {
    const base = 'https://example.com';
    const urls = PDF_KINDS.map((k) => printUrl(base, ALBUM, TOKEN, k));
    expect(urls[0]).toContain(`/albums/${ALBUM}/print?t=`);
    expect(urls[1]).toContain(`/albums/${ALBUM}/print/cover?t=`);
    expect(urls[2]).toContain(`/albums/${ALBUM}/print/content?t=`);
    expect(new Set(urls.map((u) => new URL(u).pathname)).size).toBe(3);
  });

  it('defaults to the preview route when no kind is given', () => {
    expect(printUrl('https://example.com', ALBUM, TOKEN)).toBe(
      printUrl('https://example.com', ALBUM, TOKEN, 'preview'),
    );
  });

  it('never emits localhost when a base URL is configured', () => {
    for (const k of PDF_KINDS) {
      const url = printUrl('https://malnad.example', ALBUM, TOKEN, k);
      expect(url).not.toContain('localhost');
      expect(new URL(url).origin).toBe('https://malnad.example');
    }
  });

  it('tolerates a trailing slash on the base without doubling it', () => {
    expect(printUrl('https://example.com/', ALBUM, TOKEN)).toBe(
      printUrl('https://example.com', ALBUM, TOKEN),
    );
    expect(printUrl('https://example.com///', ALBUM, TOKEN)).not.toContain('//albums');
  });

  it('keeps a legitimate sub-path prefix', () => {
    expect(printUrl('https://example.com/app', ALBUM, TOKEN)).toBe(
      `https://example.com/app/albums/${ALBUM}/print?t=${TOKEN}`,
    );
  });

  it('always carries the token — it is the route’s only authorization', () => {
    for (const k of PDF_KINDS) {
      const url = new URL(printUrl('https://example.com', ALBUM, TOKEN, k));
      expect(url.searchParams.get('t')).toBe(TOKEN);
    }
  });

  it('url-encodes the token rather than pasting it raw', () => {
    const url = printUrl('https://example.com', ALBUM, 'a b&c=d');
    expect(url).toContain('t=a%20b%26c%3Dd');
    expect(new URL(url).searchParams.get('t')).toBe('a b&c=d');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Configuration resolution
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('render base URL configuration', () => {
  it('takes APP_URL when set, and says so', () => {
    expect(resolve({ APP_URL: 'https://malnadstories.example' })).toEqual({
      url: 'https://malnadstories.example',
      source: 'env',
      varName: 'APP_URL',
    });
  });

  it('accepts PDF_RENDER_BASE_URL as an explicit alias', () => {
    // A variable that is set but silently ignored is worse than one that is missing.
    expect(resolve({ PDF_RENDER_BASE_URL: 'https://alias.example' })).toEqual({
      url: 'https://alias.example',
      source: 'env',
      varName: 'PDF_RENDER_BASE_URL',
    });
  });

  it('prefers APP_URL when both are set', () => {
    const r = resolve({ APP_URL: 'https://a.example', PDF_RENDER_BASE_URL: 'https://b.example' });
    expect(r.url).toBe('https://a.example');
    expect(r.varName).toBe('APP_URL');
  });

  it('ignores an empty or whitespace-only value rather than accepting it', () => {
    expect(resolve({ APP_URL: '' }).source).toBe('default');
    expect(resolve({ APP_URL: '   ' }).source).toBe('default');
    expect(resolve({ APP_URL: '  ', PDF_RENDER_BASE_URL: 'https://b.example' }).url).toBe(
      'https://b.example',
    );
  });

  it('DOES fall back to localhost — but never silently', () => {
    // The fallback is retained so `pnpm dev` on one machine needs no setup. The contract is that
    // it is REPORTED: `source: 'default'` is what the startup banner turns into a visible warning,
    // and it is the difference between a configured localhost and an unconfigured one.
    const r = resolve({});
    expect(r.url).toBe(DEFAULT_BASE);
    expect(r.source).toBe('default');
    expect(r.varName).toBeNull();
  });

  it('reports source: env for a DELIBERATE localhost, distinguishing it from the fallback', () => {
    const r = resolve({ APP_URL: 'http://localhost:3000' });
    expect(r.url).toBe(DEFAULT_BASE);
    expect(r.source).toBe('env');
  });

  it('supports the Docker-host form without special-casing it', () => {
    // Nothing in the parser knows about Docker; `host.docker.internal` is just a hostname.
    const r = resolve({ APP_URL: 'http://host.docker.internal:3000' });
    expect(r.url).toBe('http://host.docker.internal:3000');
    expect(printUrl(r.url, ALBUM, TOKEN)).toContain('http://host.docker.internal:3000/albums/');
  });

  it('rejects a malformed URL', () => {
    expect(() => resolve({ APP_URL: 'not a url' })).toThrow(ConfigError);
    expect(() => resolve({ APP_URL: 'example.com' })).toThrow(/absolute URL/i);
  });

  it('rejects a non-http(s) protocol', () => {
    expect(() => resolve({ APP_URL: 'ftp://example.com' })).toThrow(/http or https/i);
    expect(() => resolve({ APP_URL: 'file:///tmp' })).toThrow(/http or https/i);
  });

  it('rejects a pasted RENDER url instead of a base url', () => {
    // The mistake this catches would otherwise build `…/albums/x/print/albums/y/print`.
    expect(() =>
      resolve({ APP_URL: `https://example.com/albums/${ALBUM}/print` }),
    ).toThrow(/base URL, not a render URL/i);
    expect(() => resolve({ APP_URL: 'https://example.com/albums' })).toThrow(/base URL/i);
  });

  it('rejects a query string or fragment on the base', () => {
    expect(() => resolve({ APP_URL: 'https://example.com?x=1' })).toThrow(/query string or fragment/i);
    expect(() => resolve({ APP_URL: 'https://example.com#frag' })).toThrow(/query string or fragment/i);
  });

  it('names the offending variable in the error', () => {
    expect(() => resolve({ PDF_RENDER_BASE_URL: 'nope' })).toThrow(/PDF_RENDER_BASE_URL/);
    expect(() => resolve({ APP_URL: 'nope' })).toThrow(/APP_URL/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Diagnostics
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('a connection failure is diagnosed as a connection failure', () => {
  it('recognises the exact Chromium error that was observed', () => {
    expect(
      classifyNetworkError(
        `net::ERR_CONNECTION_REFUSED at http://localhost:3000/albums/${ALBUM}/print?t=${TOKEN}`,
      ),
    ).toBe('refused');
  });

  it('separates DNS from connection from timeout from TLS', () => {
    expect(classifyNetworkError('net::ERR_NAME_NOT_RESOLVED at https://typo.example/')).toBe('dns');
    expect(classifyNetworkError('getaddrinfo ENOTFOUND typo.example')).toBe('dns');
    expect(classifyNetworkError('connect ECONNREFUSED 127.0.0.1:3000')).toBe('refused');
    expect(classifyNetworkError('net::ERR_CONNECTION_TIMED_OUT')).toBe('timeout');
    expect(classifyNetworkError('net::ERR_CERT_AUTHORITY_INVALID')).toBe('tls');
    expect(classifyNetworkError('net::ERR_CONNECTION_RESET')).toBe('network');
    // Found by the end-to-end harness: Chromium refuses its own blocked-port list outright, and
    // the message names neither "refused" nor "timed out".
    expect(classifyNetworkError('net::ERR_UNSAFE_PORT at http://127.0.0.1:1/')).toBe('blocked');
  });

  it('does NOT claim a network fault for an unrelated error', () => {
    // These must keep their own classifications — a crashed browser is not an unreachable app.
    expect(classifyNetworkError('Navigation timeout of 45000 ms exceeded')).toBeNull();
    expect(classifyNetworkError('Protocol error: Target closed')).toBeNull();
    expect(classifyNetworkError('page.pdf produced 0 bytes')).toBeNull();
  });

  it('gives an operator something to act on, naming the origin', () => {
    const advice = unreachableAdvice('refused', 'http://localhost:3000');
    expect(advice).toContain('http://localhost:3000');
    expect(advice).toMatch(/APP_URL/);
    // The specific misconception that caused the incident is spelled out.
    expect(advice).toMatch(/localhost.*WORKER/i);
  });

  it('advises differently for each reason', () => {
    const all = (['dns', 'refused', 'timeout', 'tls', 'blocked', 'network'] as const).map((r) =>
      unreachableAdvice(r, 'https://x.example'),
    );
    expect(new Set(all).size).toBe(6);
    expect(unreachableAdvice('dns', 'https://x.example')).toMatch(/resolve/i);
    expect(unreachableAdvice('tls', 'https://x.example')).toMatch(/http:\/\//);
  });

  it('is a distinct error type from a crashed browser', () => {
    const unreachable = new RenderTargetUnreachableError('refused', 'http://localhost:3000', 'boom');
    expect(unreachable).toBeInstanceOf(Error);
    expect(unreachable).not.toBeInstanceOf(RendererCrashedError);
    expect(unreachable).not.toBeInstanceOf(PrintRouteError);
    expect(unreachable.reason).toBe('refused');
    expect(unreachable.origin).toBe('http://localhost:3000');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// The token must never be logged
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('the print token never reaches a log, an event, or album_pdfs.error', () => {
  const chromiumError = `net::ERR_CONNECTION_REFUSED at http://localhost:3000/albums/${ALBUM}/print?t=${TOKEN}`;

  it('redacts the token from the exact error that was observed', () => {
    const safe = redactToken(chromiumError);
    expect(safe).not.toContain(TOKEN);
    expect(safe).toContain('t=[REDACTED]');
    // Everything an operator needs survives.
    expect(safe).toContain('ERR_CONNECTION_REFUSED');
    expect(safe).toContain('http://localhost:3000');
    expect(safe).toContain(ALBUM);
  });

  it('redacts every kind’s URL', () => {
    for (const k of PDF_KINDS as readonly PdfKind[]) {
      const url = printUrl('https://example.com', ALBUM, TOKEN, k);
      const safe = redactedPrintUrl(url);
      expect(safe).not.toContain(TOKEN);
      expect(safe).toContain('t=[REDACTED]');
      // The route is preserved, so the kind is still diagnosable from the log line.
      expect(safe).toContain(new URL(url).pathname);
    }
  });

  it('handles a token in any query position, and more than one URL in a message', () => {
    expect(redactToken(`?a=1&t=${TOKEN}&b=2`)).toBe('?a=1&t=[REDACTED]&b=2');
    const two = redactToken(`first ?t=${TOKEN} then ?t=${TOKEN}`);
    expect(two).not.toContain(TOKEN);
    expect(two.match(/\[REDACTED\]/g)).toHaveLength(2);
  });

  it('stops at a quote or bracket so it cannot swallow surrounding text', () => {
    expect(redactToken(`url="https://x/print?t=${TOKEN}" done`)).toContain('" done');
  });

  it('leaves a message with no token completely untouched', () => {
    const plain = 'Navigation timeout of 45000 ms exceeded';
    expect(redactToken(plain)).toBe(plain);
  });

  it('is idempotent — redacting twice changes nothing', () => {
    const once = redactToken(chromiumError);
    expect(redactToken(once)).toBe(once);
  });
});
