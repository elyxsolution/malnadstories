/**
 * CART ELIGIBILITY + THE TWO ADD HELPERS (Phase 6/7).
 *
 * Phase 6 proved the ATOMICITY of the cart write against the live database (10 genuinely
 * concurrent adds → one row at quantity 10, zero lost increments). That property lives in a
 * single SQL statement (`cart_add_or_increment`'s `on conflict … least(existing + excluded, 10)`)
 * and cannot be re-proved without a database, so it is not re-tested here — see
 * `tests/README.md`. What IS re-testable, and what had no durable coverage, is the decision
 * layer above it:
 *
 *   · which SQL function each caller uses — the manual add MUST increment, the submit auto-add
 *     MUST be `do nothing`. Swapping them is a silent bug: resubmitting an album would quietly
 *     raise its copy count.
 *   · the eligibility gates: ownership, blueprint drafts, and submitted-only.
 *   · that identity always comes from `auth.uid()` and never from client input.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ALBUM = '77777777-7777-4777-8777-777777777777';
const USER = '88888888-8888-4888-8888-888888888888';

const state = {
  user: { id: USER } as { id: string } | null,
  album: null as { id: string; status: string; blueprint_draft_of: string | null } | null,
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  count: 1,
};

function authedClientStub() {
  return {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from(table: string) {
      if (table === 'albums') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.album }) }) }) };
      }
      if (table === 'cart_items') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          then: (res: (v: unknown) => unknown) => res({ count: state.count, error: null }),
        };
        return chain;
      }
      throw new Error(`unexpected table: ${table}`);
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ fn, args });
      return { error: null };
    },
  } as never;
}

vi.mock('@/lib/supabase/server', () => ({ createClient: () => authedClientStub() }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/cart/queries', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, getCartCount: async () => state.count };
});

// Static imports are safe: Vitest hoists every vi.mock() above them.
import { addAlbumToCart } from '@/lib/actions/cart';
import { addOrIncrementCartItem, ensureCartItem } from '@/lib/cart/queries';

beforeEach(() => {
  state.user = { id: USER };
  state.album = { id: ALBUM, status: 'submitted', blueprint_draft_of: null };
  state.rpcCalls = [];
  state.count = 1;
});

describe('the two add helpers are NOT interchangeable', () => {
  it('the manual add calls cart_add_or_increment (atomic increment, capped in SQL)', async () => {
    await addOrIncrementCartItem(authedClientStub(), ALBUM, 2);
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].fn).toBe('cart_add_or_increment');
  });

  it('the submit auto-add calls cart_ensure_item (do nothing) so resubmitting never increments', async () => {
    await ensureCartItem(authedClientStub(), ALBUM);
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].fn).toBe('cart_ensure_item');
    expect(state.rpcCalls[0].fn).not.toBe('cart_add_or_increment');
  });

  it('neither helper accepts a user id — identity comes from auth.uid() inside the policy', async () => {
    await addOrIncrementCartItem(authedClientStub(), ALBUM, 1);
    await ensureCartItem(authedClientStub(), ALBUM);
    for (const call of state.rpcCalls) {
      expect(Object.keys(call.args)).not.toContain('p_user_id');
      expect(JSON.stringify(call.args)).not.toContain(USER);
    }
  });
});

describe('addAlbumToCart eligibility', () => {
  it('adds a submitted album the customer owns', async () => {
    const r = await addAlbumToCart({ albumId: ALBUM, quantity: 1 });
    expect(r).toMatchObject({ ok: true });
    expect(state.rpcCalls[0].fn).toBe('cart_add_or_increment');
  });

  it('refuses a blueprint draft — an authoring scaffold is not a product', async () => {
    state.album = { id: ALBUM, status: 'submitted', blueprint_draft_of: 'some-blueprint' };
    const r = await addAlbumToCart({ albumId: ALBUM, quantity: 1 });
    expect(r.ok).toBe(false);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('refuses a draft album — eligibility matches checkout exactly', async () => {
    state.album = { id: ALBUM, status: 'draft', blueprint_draft_of: null };
    const r = await addAlbumToCart({ albumId: ALBUM, quantity: 1 });
    expect(r.ok).toBe(false);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('a foreign album is an ordinary "not found" — RLS resolves it to null, no existence oracle', async () => {
    state.album = null;
    const r = await addAlbumToCart({ albumId: ALBUM, quantity: 1 });
    expect(r).toMatchObject({ ok: false, error: 'Album not found' });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('refuses when nobody is signed in', async () => {
    state.user = null;
    const r = await addAlbumToCart({ albumId: ALBUM, quantity: 1 });
    expect(r).toMatchObject({ ok: false, error: 'Not signed in' });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('rejects malformed input at the Zod boundary before any query runs', async () => {
    for (const bad of [{}, { albumId: 'not-a-uuid', quantity: 1 }, { albumId: ALBUM, quantity: 0 }, { albumId: ALBUM, quantity: 99 }]) {
      const r = await addAlbumToCart(bad);
      expect(r.ok).toBe(false);
    }
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('returns the DISTINCT-ALBUM count, so the badge cannot drift on a repeat add', async () => {
    state.count = 2;
    const first = await addAlbumToCart({ albumId: ALBUM, quantity: 1 });
    const second = await addAlbumToCart({ albumId: ALBUM, quantity: 5 });
    // Album A at quantity 9 + album B at quantity 1 is a badge of 2, never 10.
    expect(first).toMatchObject({ ok: true, count: 2 });
    expect(second).toMatchObject({ ok: true, count: 2 });
  });
});
