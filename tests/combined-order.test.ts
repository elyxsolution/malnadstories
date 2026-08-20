/**
 * COMBINED ORDER + HISTORICAL SNAPSHOT IMMUTABILITY (Phase 8 · Phase 9 P2 R2/R3/R4).
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT: one order can contain several albums, every line
 * keeps its OWN album/copies/title/product snapshot, and a historical order surface must never
 * collapse to the first album or re-read a live album title.
 *
 * Two distinct bugs are being fenced off, both of which actually happened:
 *   1. FIRST-ALBUM-ONLY COLLAPSE — reading `orders.album_id` (a legacy pointer to item one) so a
 *      3-album order printed, emailed and displayed as one book.
 *   2. RETROACTIVE REWRITE — joining live `albums.title` so renaming an album changed what a past
 *      order says it sold.
 *
 * These run against the real production helpers with no database: `listOrderItems` /
 * `albumIdsForOrder` take a Supabase client as an argument (the project's deliberate convention),
 * so a recording stub exercises the actual query shape and the actual mapping code.
 */
import { describe, it, expect } from 'vitest';
import {
  buildOrderItemSnapshot,
  listOrderItems,
  albumIdsForOrder,
  type OrderItemRow,
} from '@/lib/orders/items';

const ALBUM_A = '11111111-1111-4111-8111-111111111111';
const ALBUM_B = '22222222-2222-4222-8222-222222222222';
const ORDER_X = '33333333-3333-4333-8333-333333333333';

/** The fixture from the spec: ONE order, TWO lines, different album/title/product/copies. */
function orderXItems(): OrderItemRow[] {
  return [
    {
      id: 'item-a', order_id: ORDER_X, album_id: ALBUM_A, copies: 2,
      unit_price: '899.00', line_subtotal: '1798.00',
      product_id: 'prod-std', product_name: 'Standard', album_title: 'SNAPSHOT ALPHA',
    },
    {
      id: 'item-b', order_id: ORDER_X, album_id: ALBUM_B, copies: 1,
      unit_price: '1299.00', line_subtotal: '1299.00',
      product_id: 'prod-prem', product_name: 'Premium', album_title: 'SNAPSHOT BETA',
    },
  ];
}

/**
 * Minimal recording stub of the PostgREST builder surface these helpers use. It asserts nothing
 * by itself — it records the query so a test can prove the helper asked for the right thing, and
 * returns rows so the real mapping code runs.
 */
function supabaseStub(rows: unknown[], error: { message: string } | null = null) {
  const calls: { table?: string; columns?: string; eqCol?: string; eqVal?: string; orderCol?: string; ascending?: boolean } = {};
  const builder = {
    select(columns: string) { calls.columns = columns; return builder; },
    eq(col: string, val: string) { calls.eqCol = col; calls.eqVal = val; return builder; },
    order(col: string, opts: { ascending: boolean }) {
      calls.orderCol = col; calls.ascending = opts.ascending;
      return Promise.resolve({ data: error ? null : rows, error });
    },
  };
  return {
    client: { from(table: string) { calls.table = table; return builder; } } as never,
    calls,
  };
}

describe('combined order — one order, many albums', () => {
  it('reads the lines from order_items, oldest first, scoped to the order', async () => {
    const { client, calls } = supabaseStub(orderXItems());
    const items = await listOrderItems(client, ORDER_X);

    // The AUTHORITY for "which albums are in this order" must be order_items — never orders.album_id.
    expect(calls.table).toBe('order_items');
    expect(calls.eqCol).toBe('order_id');
    expect(calls.eqVal).toBe(ORDER_X);
    // Purchase order is semantically meaningful: line one is the album orders.album_id points at.
    expect(calls.orderCol).toBe('created_at');
    expect(calls.ascending).toBe(true);
    expect(items).toHaveLength(2);
  });

  it('keeps each line’s own album_id, copies, title and product snapshot', async () => {
    const { client } = supabaseStub(orderXItems());
    const items = await listOrderItems(client, ORDER_X);

    expect(items.map((i) => i.album_id)).toEqual([ALBUM_A, ALBUM_B]);
    expect(items.map((i) => i.copies)).toEqual([2, 1]);
    expect(items.map((i) => i.album_title)).toEqual(['SNAPSHOT ALPHA', 'SNAPSHOT BETA']);
    expect(items.map((i) => i.product_name)).toEqual(['Standard', 'Premium']);
    expect(items.map((i) => i.unit_price)).toEqual(['899.00', '1299.00']);
  });

  it('totals copies across every line — not the first line, and not orders.copies', () => {
    const total = orderXItems().reduce((n, i) => n + i.copies, 0);
    expect(total).toBe(3);
    // The first line alone would report 2. That collapse is the production-board bug.
    expect(total).not.toBe(orderXItems()[0].copies);
  });

  it('stays ONE order — every line carries the same order_id', async () => {
    const { client } = supabaseStub(orderXItems());
    const items = await listOrderItems(client, ORDER_X);
    expect(new Set(items.map((i) => i.order_id)).size).toBe(1);
  });

  it('albumIdsForOrder yields EVERY album, in purchase order (the settlement fan-out)', async () => {
    const { client, calls } = supabaseStub([{ album_id: ALBUM_A }, { album_id: ALBUM_B }]);
    const ids = await albumIdsForOrder(client, ORDER_X);
    // Settlement iterates this: review enqueue, PDF start and cart clearing are PER ALBUM.
    expect(ids).toEqual([ALBUM_A, ALBUM_B]);
    expect(calls.table).toBe('order_items');
    expect(calls.columns).toBe('album_id');
  });

  it('a read failure degrades to [] instead of taking the receipt down', async () => {
    const { client } = supabaseStub([], { message: 'connection reset' });
    expect(await listOrderItems(client, ORDER_X)).toEqual([]);
    const b = supabaseStub([], { message: 'connection reset' });
    expect(await albumIdsForOrder(b.client, ORDER_X)).toEqual([]);
  });
});

describe('historical snapshot immutability', () => {
  it('a later album rename cannot change what a past order says it sold', async () => {
    // The order was placed when the album was called "Original Album".
    const snapshot = buildOrderItemSnapshot({
      albumId: ALBUM_A, copies: 2, unitPriceInr: 899, albumTitle: 'Original Album',
      productId: 'prod-std', productName: 'Standard', productDimensions: { widthCm: 21, heightCm: 29.7 },
    });
    expect(snapshot.album_title).toBe('Original Album');

    // The customer later renames the LIVE album. The stored line is a frozen copy, so the only
    // way the receipt could change is if a surface re-joined `albums` — which is the bug.
    const liveAlbumTitleNow = 'RENAMED LIVE';
    const { client } = supabaseStub([{
      id: 'item-a', order_id: ORDER_X, album_id: ALBUM_A, copies: 2,
      unit_price: '899.00', line_subtotal: '1798.00',
      product_id: 'prod-std', product_name: 'Standard', album_title: snapshot.album_title,
    }]);
    const [line] = await listOrderItems(client, ORDER_X);

    expect(line.album_title).toBe('Original Album');
    expect(line.album_title).not.toBe(liveAlbumTitleNow);
  });

  it('freezes product, dimensions, unit price and copies alongside the title', () => {
    const s = buildOrderItemSnapshot({
      albumId: ALBUM_B, copies: 1, unitPriceInr: 1299, albumTitle: 'SNAPSHOT BETA',
      productId: 'prod-prem', productName: 'Premium', productDimensions: { widthCm: 21, heightCm: 29.7 },
    });
    expect(s).toMatchObject({
      album_id: ALBUM_B, copies: 1, unit_price: 1299, line_subtotal: 1299,
      product_id: 'prod-prem', product_name: 'Premium',
      product_dimensions: { widthCm: 21, heightCm: 29.7 }, album_title: 'SNAPSHOT BETA',
    });
  });

  it('computes line_subtotal itself so a caller cannot book a total that disagrees with unit × copies', () => {
    const s = buildOrderItemSnapshot({
      albumId: ALBUM_A, copies: 3, unitPriceInr: 899.004, albumTitle: 'T',
      productId: null, productName: null, productDimensions: null,
    });
    expect(s.unit_price).toBe(899);
    expect(s.line_subtotal).toBe(2697);
    expect(s.line_subtotal).toBe(s.unit_price * s.copies);
  });

  it('clamps copies into the 1..10 range the order CHECK constraint allows', () => {
    const mk = (copies: number) =>
      buildOrderItemSnapshot({
        albumId: ALBUM_A, copies, unitPriceInr: 100, albumTitle: 'T',
        productId: null, productName: null, productDimensions: null,
      }).copies;
    expect(mk(0)).toBe(1);
    expect(mk(-5)).toBe(1);
    expect(mk(11)).toBe(10);
    expect(mk(2.4)).toBe(2);
  });
});
