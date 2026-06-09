import * as React from 'react';
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components';
import { emailConfig } from '../config';

// Shared, reusable email building blocks (Header/Footer/Layout/Button/Section/
// OrderSummary) — every template composes these so there is no duplicated markup.
// Inline styles + explicit light colors keep it dark-mode-safe and mobile-friendly.

const styles = {
  main: {
    backgroundColor: '#f6f6f6',
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
    margin: 0,
    padding: '24px 0',
  } as React.CSSProperties,
  container: {
    backgroundColor: '#ffffff',
    margin: '0 auto',
    maxWidth: '560px',
    width: '100%',
    borderRadius: '8px',
    overflow: 'hidden',
    border: '1px solid #eaeaea',
  } as React.CSSProperties,
  header: { backgroundColor: '#0f172a', padding: '20px 24px' } as React.CSSProperties,
  brand: { color: '#ffffff', fontSize: '18px', fontWeight: 700, margin: 0 } as React.CSSProperties,
  content: { padding: '24px' } as React.CSSProperties,
  footer: { padding: '16px 24px' } as React.CSSProperties,
  footerText: { margin: 0, color: '#8898aa', fontSize: '12px', lineHeight: '18px' } as React.CSSProperties,
  h: { fontSize: '20px', color: '#0f172a', margin: '0 0 12px', lineHeight: '26px' } as React.CSSProperties,
  p: { fontSize: '14px', color: '#444444', lineHeight: '22px', margin: '0 0 12px' } as React.CSSProperties,
  cta: {
    backgroundColor: '#0f172a',
    color: '#ffffff',
    borderRadius: '8px',
    padding: '11px 20px',
    fontSize: '14px',
    fontWeight: 600,
    textDecoration: 'none',
  } as React.CSSProperties,
  rowLabel: { color: '#8898aa', fontSize: '13px', margin: '3px 0' } as React.CSSProperties,
  rowValue: { color: '#0f172a', fontSize: '13px', margin: '3px 0', textAlign: 'right' as const },
  rowLabelBold: { color: '#0f172a', fontSize: '14px', fontWeight: 700, margin: '4px 0' } as React.CSSProperties,
  rowValueBold: { color: '#0f172a', fontSize: '14px', fontWeight: 700, margin: '4px 0', textAlign: 'right' as const },
  hr: { borderColor: '#eaeaea', margin: '14px 0' } as React.CSSProperties,
};

export function EmailLayout({ preview, children }: { preview: string; children: React.ReactNode }) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <Text style={styles.brand}>Malnad Stories</Text>
          </Section>
          <Section style={styles.content}>{children}</Section>
          <Hr style={{ borderColor: '#eaeaea', margin: 0 }} />
          <Section style={styles.footer}>
            <Text style={styles.footerText}>
              Need help? Contact {emailConfig.supportEmail || 'our support team'}.
            </Text>
            <Text style={styles.footerText}>© Malnad Stories</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function H({ children }: { children: React.ReactNode }) {
  return <Heading style={styles.h}>{children}</Heading>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <Text style={styles.p}>{children}</Text>;
}

export function CTA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button href={href} style={styles.cta}>
      {children}
    </Button>
  );
}

export function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <Row>
      <Column>
        <Text style={bold ? styles.rowLabelBold : styles.rowLabel}>{label}</Text>
      </Column>
      <Column>
        <Text style={bold ? styles.rowValueBold : styles.rowValue}>{value}</Text>
      </Column>
    </Row>
  );
}

export function Divider() {
  return <Hr style={styles.hr} />;
}
