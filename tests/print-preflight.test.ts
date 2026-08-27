/**
 * PRINT PRE-FLIGHT — the page-count invariant, checked before a print job is enqueued.
 *
 * The interior file must contain EXACTLY the album's content page count. A file with the wrong
 * number of leaves is not a smaller book — it is an unbindable one, and the print partner finds
 * out after the paper is cut. So the check refuses rather than trims, pads or hopes.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertPrintablePageCount } from '@/lib/pdf/print-preflight';

type PageRow = { layout_template: string | null };

/** Minimal stand-in for the two reads the pre-flight performs. */
function client(album: { size: number } | null, pages: PageRow[] | null, pagesError = false): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'albums') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: album, error: album ? null : { message: 'nope' } }) }),
          }),
        };
      }
      if (table === 'album_pages') {
        return {
          select: () => ({
            eq: async () => ({ data: pagesError ? null : pages, error: pagesError ? { message: 'boom' } : null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

const units = (n: number, template = 'single-pair'): PageRow[] =>
  Array.from({ length: n }, () => ({ layout_template: template }));

describe('a complete album passes', () => {
  it.each([24, 36, 48])('a %i-page album with the matching units is printable', async (size) => {
    const res = await assertPrintablePageCount(client({ size }, units(size / 2)), 'a1');
    expect(res).toEqual({ ok: true, pages: size });
  });

  it('counts a double-spread as two pages, like the renderer does', async () => {
    const mixed = [...units(6), ...units(6, 'double-spread')]; // 12 units = 24 pages
    const res = await assertPrintablePageCount(client({ size: 24 }, mixed), 'a1');
    expect(res).toEqual({ ok: true, pages: 24 });
  });
});

describe('a mismatched layout is refused', () => {
  it('refuses when the layout accounts for too few pages', async () => {
    const res = await assertPrintablePageCount(client({ size: 24 }, units(10)), 'a1'); // 20 pages
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('20 content pages');
      expect(res.error).toContain('24-page album');
    }
  });

  it('refuses when the layout accounts for too many pages', async () => {
    const res = await assertPrintablePageCount(client({ size: 24 }, units(14)), 'a1'); // 28 pages
    expect(res.ok).toBe(false);
  });

  it('refuses an album with no saved layout at all', async () => {
    const res = await assertPrintablePageCount(client({ size: 24 }, []), 'a1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('0 content pages');
  });

  it('ignores rows the RENDERER would drop, so the gate and the route agree', async () => {
    // A row with a null/unknown template is filtered out by the print route. Counting it here
    // would let an album through that the route then refuses — a confusing dead end.
    const withJunk = [...units(11), { layout_template: null }, { layout_template: 'not-a-template' }];
    const res = await assertPrintablePageCount(client({ size: 24 }, withJunk), 'a1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('22 content pages');
  });
});

describe('it fails CLOSED', () => {
  it('refuses when the album cannot be read', async () => {
    const res = await assertPrintablePageCount(client(null, units(12)), 'a1');
    expect(res).toEqual({ ok: false, error: 'Album not found.' });
  });

  it('refuses when the LAYOUT read errors — an unknown page count is not a passing one', async () => {
    const res = await assertPrintablePageCount(client({ size: 24 }, null, true), 'a1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/could not read/i);
  });
});

describe('the refusal is legible to an admin', () => {
  it('names both numbers and says what to do', async () => {
    const res = await assertPrintablePageCount(client({ size: 36 }, units(12)), 'a1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('24 content pages');
      expect(res.error).toContain('36-page album');
      expect(res.error).toContain('exactly 36 pages');
    }
  });

  it('never suggests trimming or padding — the only remedy offered is fixing the layout', async () => {
    const res = await assertPrintablePageCount(client({ size: 48 }, units(20)), 'a1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/finish or repair the layout/i);
      expect(res.error).not.toMatch(/blank|padding|truncat/i);
    }
  });
});
