/**
 * CUSTOMER ORDER STATUS (Phase 9 P2 R3).
 *
 * `_status.tsx` used to take a single `albumId` (`orders.album_id`), so every link on a combined
 * order's confirmation page pointed at the FIRST album — albums two and three were unreachable
 * from the order the customer had just paid for. It now takes `albums: OrderAlbum[]`.
 *
 * This renders the REAL component with `react-dom/server`. Only framework boundaries are stubbed
 * — the Next router, `next/link`, and the `cancelOrder` server action, none of which can exist
 * outside a Next request. The component's own logic is untouched and is what runs here.
 *
 * Assertions are semantic (visible text, link targets), never CSS-class-shaped.
 */
import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}));
vi.mock('@/lib/actions/orders', () => ({ cancelOrder: async () => ({ ok: true }) }));

// Static import is safe: Vitest hoists every vi.mock() above it.
import OrderStatus from '@/app/(app)/orders/[id]/_status';

const ALBUM_A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'SNAPSHOT ALPHA' };
const ALBUM_B = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'SNAPSHOT BETA' };
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function renderStatus(albums: { id: string; title: string }[], status = 'paid') {
  const html = renderToStaticMarkup(
    React.createElement(OrderStatus, { orderId: ORDER_ID, albums, initialStatus: status as never }),
  );
  const albumHrefs = Array.from(html.matchAll(/href="(\/albums\/[^"]+)"/g)).map((m) => m[1]);
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
  return { html, text, albumHrefs };
}

describe('single-album order — unchanged experience', () => {
  it('renders exactly one album call-to-action, pointing at that album', () => {
    const { albumHrefs } = renderStatus([ALBUM_A]);
    expect(albumHrefs).toEqual([`/albums/${ALBUM_A.id}/build`]);
  });

  it('keeps the original singular wording and does not announce an album count', () => {
    const { text } = renderStatus([ALBUM_A]);
    expect(text).toContain('View your album');
    expect(text).not.toMatch(/albums in this order/);
  });
});

describe('combined order — every album reachable', () => {
  it('renders one call-to-action per album', () => {
    const { albumHrefs } = renderStatus([ALBUM_A, ALBUM_B]);
    expect(albumHrefs).toHaveLength(2);
  });

  it('album A points to A and album B points to B — no first-album-only collapse', () => {
    const { albumHrefs } = renderStatus([ALBUM_A, ALBUM_B]);
    expect(albumHrefs).toContain(`/albums/${ALBUM_A.id}/build`);
    expect(albumHrefs).toContain(`/albums/${ALBUM_B.id}/build`);
    // THE REGRESSION: both links resolving to the first album.
    expect(albumHrefs[0]).not.toBe(albumHrefs[1]);
  });

  it('labels each button with that album’s own snapshot title', () => {
    const { text } = renderStatus([ALBUM_A, ALBUM_B]);
    expect(text).toContain('SNAPSHOT ALPHA');
    expect(text).toContain('SNAPSHOT BETA');
  });

  it('tells the customer both albums ship together', () => {
    const { text } = renderStatus([ALBUM_A, ALBUM_B]);
    expect(text).toContain('2 albums in this order');
  });
});

describe('failure states', () => {
  it('pluralises correctly for a combined order and stays singular for one album', () => {
    expect(renderStatus([ALBUM_A, ALBUM_B], 'failed').text).toContain('albums are');
    expect(renderStatus([ALBUM_A], 'failed').text).toContain('album is');
  });

  it('an empty album list renders without throwing (defensive: lines failed to load)', () => {
    expect(() => renderStatus([])).not.toThrow();
  });
});
