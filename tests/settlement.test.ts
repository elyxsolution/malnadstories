/**
 * PAID-TRANSITION CASCADE (Phase 8 `settleOrderFulfilment`).
 *
 * ONE downstream path, called by BOTH the Razorpay webhook and `/api/payments/verify` after
 * `process_razorpay_event` reports a capture. Everything a purchase triggers — confirmation
 * email, review queue, preview PDF, cart clearing — happens here.
 *
 * THE INVARIANTS:
 *   · It iterates `order_items`, NEVER `orders.album_id`. A combined order must review and render
 *     EVERY album; the legacy pointer names only the first.
 *   · It refuses to fulfil anything that is not already in the paid family, whatever the caller
 *     believed — the floor that stops a failed or pending order being fulfilled.
 *   · Cart rows are cleared ONLY for the albums in THIS order and ONLY for that order's owner.
 *   · It NEVER THROWS. A sleeping worker or a bounced email must not turn a settled payment into
 *     a 503 that Razorpay will retry.
 *   · It never writes `orders.status` — `process_razorpay_event` is the only path to paid.
 *
 * The real function runs; the Supabase service client, the email sender and the PDF starter are
 * stubbed so the test can observe exactly what it did.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORDER = '55555555-5555-4555-8555-555555555555';
const OWNER = '66666666-6666-4666-8666-666666666666';
const ALBUM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALBUM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const state = {
  order: null as { id: string; user_id: string; status: string } | null,
  items: [] as { album_id: string }[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  pdfStarts: [] as string[],
  emailsSent: [] as string[],
  cartDeletes: [] as { user_id?: string; album_ids?: string[] }[],
  orderWrites: [] as unknown[],
  emailThrows: false,
  pdfThrows: false,
};

function serviceStub() {
  return {
    from(table: string) {
      if (table === 'orders') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.order, error: null }) }) }),
          update: (row: unknown) => { state.orderWrites.push(row); return { eq: async () => ({ error: null }) }; },
        };
      }
      if (table === 'order_items') {
        return { select: () => ({ eq: () => ({ order: async () => ({ data: state.items, error: null }) }) }) };
      }
      if (table === 'cart_items') {
        const rec: { user_id?: string; album_ids?: string[] } = {};
        // Mirrors the real chain exactly: .delete().eq().in().select('id')
        const chain = {
          delete: () => chain,
          eq: (_c: string, v: string) => { rec.user_id = v; return chain; },
          in: (_c: string, v: string[]) => { rec.album_ids = v; state.cartDeletes.push(rec); return chain; },
          select: async () => ({ data: (rec.album_ids ?? []).map((a) => ({ id: a })), error: null }),
        };
        return chain;
      }
      throw new Error(`unexpected table in settlement: ${table}`);
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ fn, args });
      return { data: null, error: null };
    },
  } as never;
}

vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => serviceStub() }));
vi.mock('@/lib/email/events', () => ({
  sendOrderConfirmationEmail: async (id: string) => {
    if (state.emailThrows) throw new Error('smtp down');
    state.emailsSent.push(id);
  },
}));
vi.mock('@/lib/pdf/generate', () => ({
  startAlbumPdfGeneration: async (albumId: string) => {
    if (state.pdfThrows) throw new Error('worker asleep');
    state.pdfStarts.push(albumId);
    return { ok: true };
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

// Static import is safe: Vitest hoists every vi.mock() above it.
import { settleOrderFulfilment } from '@/lib/orders/settlement';

beforeEach(() => {
  state.order = { id: ORDER, user_id: OWNER, status: 'paid' };
  state.items = [{ album_id: ALBUM_A }, { album_id: ALBUM_B }];
  state.rpcCalls = []; state.pdfStarts = []; state.emailsSent = [];
  state.cartDeletes = []; state.orderWrites = [];
  state.emailThrows = false; state.pdfThrows = false;
});

describe('multi-album settlement', () => {
  it('fulfils EVERY album in the order, not just the first', async () => {
    const r = await settleOrderFulfilment(ORDER, 'test');
    expect(r.settled).toBe(true);
    expect(r.albumIds).toEqual([ALBUM_A, ALBUM_B]);
    expect(state.pdfStarts).toEqual([ALBUM_A, ALBUM_B]);
    expect(state.rpcCalls.filter((c) => c.fn === 'submit_album_for_review').map((c) => c.args.p_album_id))
      .toEqual([ALBUM_A, ALBUM_B]);
  });

  it('sends exactly ONE confirmation email per order, not one per album', async () => {
    await settleOrderFulfilment(ORDER, 'test');
    expect(state.emailsSent).toEqual([ORDER]);
  });

  it('clears the cart only for THIS order’s albums and THIS order’s owner', async () => {
    const r = await settleOrderFulfilment(ORDER, 'test');
    expect(state.cartDeletes).toHaveLength(1);
    expect(state.cartDeletes[0].user_id).toBe(OWNER);
    expect(state.cartDeletes[0].album_ids).toEqual([ALBUM_A, ALBUM_B]);
    expect(r.cartRowsCleared).toBe(2);
  });

  it('never writes orders.status — process_razorpay_event owns the paid transition', async () => {
    await settleOrderFulfilment(ORDER, 'test');
    expect(state.orderWrites).toEqual([]);
  });
});

describe('the paid-family floor', () => {
  it.each(['pending', 'failed', 'cancelled'])('refuses to fulfil a %s order', async (status) => {
    state.order = { id: ORDER, user_id: OWNER, status };
    const r = await settleOrderFulfilment(ORDER, 'test');
    expect(r).toMatchObject({ settled: false, reason: 'not-paid' });
    // Nothing may happen: no email, no review, no PDF, and above all no cart clearing.
    expect(state.emailsSent).toEqual([]);
    expect(state.pdfStarts).toEqual([]);
    expect(state.rpcCalls).toEqual([]);
    expect(state.cartDeletes).toEqual([]);
  });

  it('a failed payment leaves the cart completely untouched', async () => {
    state.order = { id: ORDER, user_id: OWNER, status: 'failed' };
    await settleOrderFulfilment(ORDER, 'test');
    expect(state.cartDeletes).toEqual([]);
  });

  it('an unknown order is reported, not fulfilled', async () => {
    state.order = null;
    const r = await settleOrderFulfilment(ORDER, 'test');
    expect(r).toMatchObject({ settled: false, reason: 'order-not-found' });
    expect(state.cartDeletes).toEqual([]);
  });
});

describe('idempotency and failure tolerance', () => {
  it('running twice — the verify+webhook race — repeats the same reachable state', async () => {
    const first = await settleOrderFulfilment(ORDER, 'webhook');
    const second = await settleOrderFulfilment(ORDER, 'verify');
    expect(second.albumIds).toEqual(first.albumIds);
    // The cart delete is a filtered DELETE, so the second run is a harmless no-op on real rows.
    expect(state.cartDeletes).toHaveLength(2);
    expect(state.cartDeletes[1].album_ids).toEqual([ALBUM_A, ALBUM_B]);
  });

  it('NEVER THROWS when the email fails — a settled payment must not become a 503 retry', async () => {
    state.emailThrows = true;
    const r = await settleOrderFulfilment(ORDER, 'test');
    expect(r.settled).toBe(true);
    expect(r.emailSent).toBe(false);
    // The rest of the cascade still runs.
    expect(state.pdfStarts).toEqual([ALBUM_A, ALBUM_B]);
  });

  it('NEVER THROWS when the PDF worker is unreachable, and still clears the cart', async () => {
    state.pdfThrows = true;
    const r = await settleOrderFulfilment(ORDER, 'test');
    expect(r.settled).toBe(true);
    expect(r.pdfsStarted).toBe(0);
    expect(state.cartDeletes).toHaveLength(1);
  });

  it('a single-album order behaves exactly as before', async () => {
    state.items = [{ album_id: ALBUM_A }];
    const r = await settleOrderFulfilment(ORDER, 'test');
    expect(r.albumIds).toEqual([ALBUM_A]);
    expect(state.pdfStarts).toEqual([ALBUM_A]);
    expect(state.emailsSent).toEqual([ORDER]);
  });

  it('deduplicates album ids defensively', async () => {
    state.items = [{ album_id: ALBUM_A }, { album_id: ALBUM_A }];
    const r = await settleOrderFulfilment(ORDER, 'test');
    expect(r.albumIds).toEqual([ALBUM_A]);
    expect(state.pdfStarts).toEqual([ALBUM_A]);
  });
});
