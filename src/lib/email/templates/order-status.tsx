import * as React from 'react';
import { Section, Text } from '@react-email/components';
import { EmailLayout, H, P, CTA, Divider } from './components';
import { type OrderEmailData } from '../order-data';

// One template for every fulfilment status — status-specific copy, plus a tracking
// block for 'shipped' and support contact for 'delivered'.
const COPY: Record<string, { title: string; body: string }> = {
  processing: {
    title: 'We are preparing your order',
    body: "Good news — we've started preparing your album for print.",
  },
  printing: {
    title: 'Your album is being printed',
    body: "Your album is on the press now. We'll let you know once it's packed.",
  },
  packed: {
    title: 'Your order is packed',
    body: 'Your album is packed and ready to ship.',
  },
  shipped: {
    title: 'Your order has shipped',
    body: 'Your album is on its way!',
  },
  delivered: {
    title: 'Your order was delivered',
    body: 'Your album has been delivered — we hope you love it. Thank you for choosing Malnad Stories.',
  },
};

export function OrderStatusEmail({
  data,
  status,
  orderUrl,
  supportEmail,
}: {
  data: OrderEmailData;
  status: string;
  orderUrl: string;
  supportEmail: string;
}) {
  const c = COPY[status] ?? { title: 'Order update', body: 'Your order status has changed.' };
  const short = data.orderId.slice(0, 8);
  return (
    <EmailLayout preview={`${c.title} — #${short}`}>
      <H>{c.title}</H>
      <P>
        Hi {data.customerName}, {c.body}
      </P>
      {/*
        A single-album order reads exactly as before ("Order #1234abcd · Coorg"). A combined order
        names its count instead of only the first album — the header used `data.albumTitle`, which
        is the legacy first-item field, so a three-album order announced one book.
      */}
      <Text style={{ color: '#8898aa', fontSize: '13px', margin: '0 0 12px' }}>
        Order #{short} ·{' '}
        {data.items.length > 1 ? `${data.items.length} albums` : (data.items[0]?.albumTitle ?? data.albumTitle)}
      </Text>
      {data.items.length > 1 && (
        <Text style={{ color: '#8898aa', fontSize: '13px', margin: '-6px 0 12px' }}>
          {data.items.map((i) => (i.copies > 1 ? `${i.albumTitle} × ${i.copies}` : i.albumTitle)).join(' · ')}
        </Text>
      )}

      {status === 'shipped' && data.trackingNumber && (
        <>
          <Divider />
          <P>
            Carrier: <strong>{data.carrier ?? '—'}</strong>
            <br />
            Tracking number: <strong>{data.trackingNumber}</strong>
          </P>
        </>
      )}

      {status === 'delivered' && (
        <P>
          Questions about your order? Contact us at {supportEmail || 'our support team'}.
        </P>
      )}

      <Section style={{ marginTop: '18px' }}>
        <CTA href={orderUrl}>View your order</CTA>
      </Section>
    </EmailLayout>
  );
}
