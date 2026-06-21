import * as React from 'react';
import { Section, Text } from '@react-email/components';
import { EmailLayout, H, P, CTA, Divider } from './components';

/**
 * One reusable template for every support notification (created / reply / resolved).
 * Copy is passed in by the caller so there is a single layout to maintain. Composes the
 * shared email primitives — no bespoke markup.
 */
export function SupportNotificationEmail({
  customerName,
  title,
  intro,
  subject,
  ticketRef,
  ctaLabel,
  ticketUrl,
}: {
  customerName: string;
  title: string;
  intro: string;
  subject: string;
  ticketRef: string;
  ctaLabel: string;
  ticketUrl: string;
}) {
  return (
    <EmailLayout preview={`${title} — ${subject}`}>
      <H>{title}</H>
      <P>
        Hi {customerName}, {intro}
      </P>
      <Divider />
      <Text style={{ color: '#8898aa', fontSize: '13px', margin: '0 0 4px' }}>
        Request #{ticketRef}
      </Text>
      <Text style={{ color: '#0f172a', fontSize: '14px', fontWeight: 600, margin: '0 0 12px' }}>
        {subject}
      </Text>
      <Section style={{ marginTop: '18px' }}>
        <CTA href={ticketUrl}>{ctaLabel}</CTA>
      </Section>
    </EmailLayout>
  );
}
