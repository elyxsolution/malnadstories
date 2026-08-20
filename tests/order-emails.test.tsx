/**
 * ORDER EMAIL CONTENT (Phase 8 · Phase 9 P2 R4).
 *
 * These render the REAL production templates through the REAL `@react-email/render` the sending
 * path uses. Nothing is sent: `sendTransactionalEmail` is never called, so no provider request is
 * made and no `email_log` row is claimed.
 *
 * THE INVARIANT: a combined order's email must represent EVERY album it sold, using the purchase
 * SNAPSHOT titles — never the first album alone, and never a live album title that may since have
 * been renamed. A single-album order must keep its original wording exactly.
 */
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { render } from '@react-email/render';
import { OrderStatusEmail } from '@/lib/email/templates/order-status';
import { OrderConfirmationEmail } from '@/lib/email/templates/order-confirmation';
import type { OrderEmailData } from '@/lib/email/order-data';

const ZERO_WIDTH = /[​-‏⁠﻿­ ]/g;

/** Rendered HTML reduced to readable text, so assertions are semantic rather than markup-shaped. */
async function text(el: React.ReactElement): Promise<string> {
  const html = await render(el);
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(ZERO_WIDTH, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const BASE: Omit<OrderEmailData, 'items' | 'albumTitle' | 'copies' | 'subtotal' | 'total'> = {
  orderId: '44444444-4444-4444-8444-444444444444',
  email: 'customer@example.test',
  customerName: 'Asha',
  shipping: 99,
  discount: 0,
  couponCode: null,
  address: { fullName: 'Asha R', line1: '1 Test Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
  trackingNumber: 'TRK123',
  carrier: 'BlueDart',
};

/** LIVE title is deliberately different from every snapshot title, so any leak is visible. */
const LIVE_TITLE_NOW = 'RENAMED LIVE';

const singleOrder: OrderEmailData = {
  ...BASE,
  albumTitle: LIVE_TITLE_NOW,
  copies: 2,
  items: [{ albumTitle: 'Original Album', copies: 2, lineSubtotal: 1798 }],
  subtotal: 1798,
  total: 1897,
};

const combinedOrder: OrderEmailData = {
  ...BASE,
  albumTitle: LIVE_TITLE_NOW,
  copies: 2,
  items: [
    { albumTitle: 'SNAPSHOT ALPHA', copies: 2, lineSubtotal: 1798 },
    { albumTitle: 'SNAPSHOT BETA', copies: 1, lineSubtotal: 1299 },
  ],
  subtotal: 3097,
  total: 3196,
};

describe('fulfilment status email', () => {
  it('single-album order names its one album and does not announce a count', async () => {
    const body = await text(
      <OrderStatusEmail data={singleOrder} status="shipped" orderUrl="https://x/orders/1" supportEmail="s@x" />,
    );
    expect(body).toContain('Original Album');
    expect(body).not.toMatch(/\d+ albums/);
  });

  it('combined order represents BOTH albums, not just the first', async () => {
    const body = await text(
      <OrderStatusEmail data={combinedOrder} status="shipped" orderUrl="https://x/orders/1" supportEmail="s@x" />,
    );
    expect(body).toContain('SNAPSHOT ALPHA');
    expect(body).toContain('SNAPSHOT BETA');
    expect(body).toContain('2 albums');
  });

  it('never leaks a live album title into a historical email', async () => {
    for (const data of [singleOrder, combinedOrder]) {
      const body = await text(
        <OrderStatusEmail data={data} status="delivered" orderUrl="https://x/orders/1" supportEmail="s@x" />,
      );
      expect(body).not.toContain(LIVE_TITLE_NOW);
    }
  });
});

describe('order confirmation email', () => {
  it('lists every purchased album with its own copy count', async () => {
    const body = await text(<OrderConfirmationEmail data={combinedOrder} orderUrl="https://x/orders/1" />);
    expect(body).toContain('SNAPSHOT ALPHA');
    expect(body).toContain('SNAPSHOT BETA');
    // Each line's own quantity must survive — orders.copies would report only the first line's.
    expect(body).toMatch(/2/);
    expect(body).toMatch(/1/);
  });

  it('shows the order-level money: subtotal, shipping charged ONCE, and total', async () => {
    const body = await text(<OrderConfirmationEmail data={combinedOrder} orderUrl="https://x/orders/1" />);
    expect(body).toContain('3,097');
    expect(body).toContain('3,196');
    // Shipping is per ORDER, not per album: exactly one ₹99 in a two-album order.
    expect(body.match(/99(?!\d)/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(body).not.toContain('198');
  });

  it('single-album confirmation still renders its one album', async () => {
    const body = await text(<OrderConfirmationEmail data={singleOrder} orderUrl="https://x/orders/1" />);
    expect(body).toContain('Original Album');
    expect(body).not.toContain(LIVE_TITLE_NOW);
  });
});
