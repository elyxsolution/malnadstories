import * as React from 'react';
import { Section, Text } from '@react-email/components';
import { EmailLayout, H, P, CTA, SummaryRow, Divider } from './components';
import { type OrderEmailData } from '../order-data';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function OrderConfirmationEmail({
  data,
  orderUrl,
}: {
  data: OrderEmailData;
  orderUrl: string;
}) {
  const short = data.orderId.slice(0, 8);
  return (
    <EmailLayout preview={`Order confirmed — #${short}`}>
      <H>Thank you, {data.customerName}!</H>
      <P>
        Your payment was received and your order is confirmed. We&apos;ll email you as it
        moves through printing and shipping.
      </P>

      <SummaryRow label="Order" value={`#${short}`} />
      <SummaryRow label="Album" value={data.albumTitle} />
      <SummaryRow label="Copies" value={String(data.copies)} />
      <Divider />
      <SummaryRow label="Subtotal" value={inr(data.subtotal)} />
      <SummaryRow label="Shipping" value={inr(data.shipping)} />
      {data.discount > 0 && (
        <SummaryRow
          label={`Discount${data.couponCode ? ` (${data.couponCode})` : ''}`}
          value={`- ${inr(data.discount)}`}
        />
      )}
      <SummaryRow label="Total" value={inr(data.total)} bold />

      {data.address && (
        <>
          <Divider />
          <Text style={{ color: '#8898aa', fontSize: '13px', margin: '0 0 4px' }}>Shipping to</Text>
          <P>
            {data.address.fullName}
            <br />
            {data.address.line1}, {data.address.city}, {data.address.state} —{' '}
            {data.address.pincode}
          </P>
        </>
      )}

      <Section style={{ marginTop: '18px' }}>
        <CTA href={orderUrl}>View your order</CTA>
      </Section>
    </EmailLayout>
  );
}
