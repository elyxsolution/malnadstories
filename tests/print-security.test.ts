/**
 * PRINT-ROUTE SECURITY — the token gate that stands between the printer-ready exports and the
 * open internet.
 *
 * A print route has no session, no cookie and no RLS in play. It is reached only by the worker's
 * headless Chromium, and THE TOKEN IS THE AUTHORIZATION. So every one of these properties is a
 * real security boundary, not a convenience:
 *
 *   • no token → refuse
 *   • wrong token → refuse (compared by sha256 hash; the raw token is never stored or logged)
 *   • expired token → refuse
 *   • a token for a DIFFERENT ALBUM → refuse
 *   • a token for a DIFFERENT ARTIFACT of the same album → refuse (0058)
 *   • a token replayed long after first use → refuse
 *
 * The caller turns every refusal into a 404, so none of these leak whether the album, the row or
 * the artifact exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

/** The `album_pdfs` rows the fake service client will serve, keyed by `${albumId}:${kind}`. */
type Row = {
  album_id: string;
  kind: string;
  token_hash: string | null;
  token_expires_at: string | null;
  token_used_at: string | null;
};
const rows = new Map<string, Row>();
/** Every UPDATE the gate issued — used to assert first-use stamping is scoped and idempotent. */
const updates: Array<Record<string, unknown>> = [];

function fakeClient() {
  return {
    from(table: string) {
      if (table !== 'album_pdfs') throw new Error(`unexpected table ${table}`);
      const filters: Record<string, unknown> = {};
      const builder = {
        select() {
          return builder;
        },
        update(patch: Record<string, unknown>) {
          Object.assign(filters, { __patch: patch });
          return builder;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return builder;
        },
        is(col: string, val: unknown) {
          filters[`is:${col}`] = val;
          // The update chain terminates on `.is()`; record what it would have written.
          if (filters.__patch) {
            const key = `${filters.album_id}:${filters.kind}`;
            const row = rows.get(key);
            const matches =
              !!row &&
              row.token_hash === filters.token_hash &&
              (val !== null || row.token_used_at === null);
            updates.push({ ...filters, applied: matches });
            if (matches) row.token_used_at = (filters.__patch as Record<string, string>).token_used_at;
          }
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle() {
          const key = `${filters.album_id}:${filters.kind}`;
          return Promise.resolve({ data: rows.get(key) ?? null, error: null });
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => fakeClient() }));

// Static import is safe: Vitest hoists every vi.mock() above it.
import { validatePrintToken } from '@/lib/pdf/print-token';
import { PDF_KINDS } from '@/lib/pdf/kind';

const ALBUM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ALBUM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const future = () => new Date(Date.now() + 60_000).toISOString();
const past = () => new Date(Date.now() - 1_000).toISOString();

function seed(albumId: string, kind: string, token: string, opts?: { expiresAt?: string; usedAt?: string | null }) {
  rows.set(`${albumId}:${kind}`, {
    album_id: albumId,
    kind,
    token_hash: sha(token),
    token_expires_at: opts?.expiresAt ?? future(),
    token_used_at: opts?.usedAt ?? null,
  });
}

beforeEach(() => {
  rows.clear();
  updates.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('a valid token is accepted', () => {
  it.each(PDF_KINDS)('accepts the current unexpired token for %s', async (kind) => {
    seed(ALBUM, kind, 'good-token');
    expect(await validatePrintToken(ALBUM, 'good-token', kind)).toEqual({ ok: true });
  });

  it('defaults to the preview artifact when no kind is named', async () => {
    seed(ALBUM, 'preview', 'good-token');
    expect(await validatePrintToken(ALBUM, 'good-token')).toEqual({ ok: true });
  });
});

describe('a missing or wrong token is refused', () => {
  it('refuses when no token is supplied at all', async () => {
    seed(ALBUM, 'print_cover', 'good-token');
    expect(await validatePrintToken(ALBUM, undefined, 'print_cover')).toEqual({ ok: false });
    expect(await validatePrintToken(ALBUM, '', 'print_cover')).toEqual({ ok: false });
  });

  it('refuses a token that does not hash to the stored value', async () => {
    seed(ALBUM, 'print_content', 'good-token');
    expect(await validatePrintToken(ALBUM, 'guessed-token', 'print_content')).toEqual({ ok: false });
  });

  it('refuses when the row carries no token at all', async () => {
    rows.set(`${ALBUM}:print_cover`, {
      album_id: ALBUM,
      kind: 'print_cover',
      token_hash: null,
      token_expires_at: future(),
      token_used_at: null,
    });
    expect(await validatePrintToken(ALBUM, 'anything', 'print_cover')).toEqual({ ok: false });
  });

  it('refuses when there is no row — generation was never requested', async () => {
    expect(await validatePrintToken(ALBUM, 'anything', 'print_cover')).toEqual({ ok: false });
  });
});

describe('expiry and replay', () => {
  it('refuses an expired token', async () => {
    seed(ALBUM, 'print_cover', 'good-token', { expiresAt: past() });
    expect(await validatePrintToken(ALBUM, 'good-token', 'print_cover')).toEqual({ ok: false });
  });

  it('refuses a token with no expiry recorded — fail closed', async () => {
    rows.set(`${ALBUM}:print_cover`, {
      album_id: ALBUM,
      kind: 'print_cover',
      token_hash: sha('good-token'),
      token_expires_at: null,
      token_used_at: null,
    });
    expect(await validatePrintToken(ALBUM, 'good-token', 'print_cover')).toEqual({ ok: false });
  });

  it('allows the SAME render’s second request (the RSC fetch) within the reuse window', async () => {
    seed(ALBUM, 'print_content', 'good-token');
    expect(await validatePrintToken(ALBUM, 'good-token', 'print_content')).toEqual({ ok: true });
    expect(await validatePrintToken(ALBUM, 'good-token', 'print_content')).toEqual({ ok: true });
  });

  it('refuses a replay long after first use', async () => {
    const usedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    seed(ALBUM, 'print_content', 'good-token', { usedAt });
    expect(await validatePrintToken(ALBUM, 'good-token', 'print_content')).toEqual({ ok: false });
  });

  it('anchors the reuse window to FIRST use — a second request does not extend it', async () => {
    seed(ALBUM, 'print_cover', 'good-token');
    await validatePrintToken(ALBUM, 'good-token', 'print_cover');
    await validatePrintToken(ALBUM, 'good-token', 'print_cover');
    // Exactly one stamping UPDATE was applied; the second call found `token_used_at` already set.
    expect(updates.filter((u) => u.applied)).toHaveLength(1);
  });
});

describe('cross-album isolation', () => {
  it('refuses a valid token belonging to a DIFFERENT album', async () => {
    seed(ALBUM, 'print_content', 'album-a-token');
    seed(OTHER_ALBUM, 'print_content', 'album-b-token');
    // B's token cannot render A's interior, and vice versa.
    expect(await validatePrintToken(ALBUM, 'album-b-token', 'print_content')).toEqual({ ok: false });
    expect(await validatePrintToken(OTHER_ALBUM, 'album-a-token', 'print_content')).toEqual({ ok: false });
  });

  it('scopes the read to the requested album, never a table-wide token match', async () => {
    seed(OTHER_ALBUM, 'print_cover', 'shared-looking-token');
    expect(await validatePrintToken(ALBUM, 'shared-looking-token', 'print_cover')).toEqual({ ok: false });
  });
});

describe('cross-ARTIFACT isolation (0058)', () => {
  it('refuses a preview token on a print route', async () => {
    seed(ALBUM, 'preview', 'preview-token');
    seed(ALBUM, 'print_cover', 'cover-token');
    seed(ALBUM, 'print_content', 'content-token');
    expect(await validatePrintToken(ALBUM, 'preview-token', 'print_cover')).toEqual({ ok: false });
    expect(await validatePrintToken(ALBUM, 'preview-token', 'print_content')).toEqual({ ok: false });
  });

  it('refuses a print token on the preview route', async () => {
    seed(ALBUM, 'preview', 'preview-token');
    seed(ALBUM, 'print_cover', 'cover-token');
    expect(await validatePrintToken(ALBUM, 'cover-token', 'preview')).toEqual({ ok: false });
  });

  it('refuses a cover token on the content route, and the reverse', async () => {
    seed(ALBUM, 'print_cover', 'cover-token');
    seed(ALBUM, 'print_content', 'content-token');
    expect(await validatePrintToken(ALBUM, 'cover-token', 'print_content')).toEqual({ ok: false });
    expect(await validatePrintToken(ALBUM, 'content-token', 'print_cover')).toEqual({ ok: false });
  });

  it('accepts each artifact only with its OWN token', async () => {
    seed(ALBUM, 'preview', 'preview-token');
    seed(ALBUM, 'print_cover', 'cover-token');
    seed(ALBUM, 'print_content', 'content-token');
    expect(await validatePrintToken(ALBUM, 'preview-token', 'preview')).toEqual({ ok: true });
    expect(await validatePrintToken(ALBUM, 'cover-token', 'print_cover')).toEqual({ ok: true });
    expect(await validatePrintToken(ALBUM, 'content-token', 'print_content')).toEqual({ ok: true });
  });

  it('stamps first use on the artifact it validated, and no other', async () => {
    seed(ALBUM, 'preview', 'preview-token');
    seed(ALBUM, 'print_cover', 'cover-token');
    await validatePrintToken(ALBUM, 'cover-token', 'print_cover');
    expect(rows.get(`${ALBUM}:print_cover`)!.token_used_at).not.toBeNull();
    expect(rows.get(`${ALBUM}:preview`)!.token_used_at).toBeNull();
  });
});

describe('the raw token never leaves the gate', () => {
  it('is compared by hash and is absent from every log line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    seed(ALBUM, 'print_cover', 'super-secret-token');
    await validatePrintToken(ALBUM, 'super-secret-token', 'print_cover');
    await validatePrintToken(ALBUM, 'wrong-token', 'print_cover');
    const emitted = JSON.stringify([...warn.mock.calls, ...log.mock.calls]);
    expect(emitted).not.toContain('super-secret-token');
    expect(emitted).not.toContain('wrong-token');
  });
});
