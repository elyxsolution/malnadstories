import type { Metadata } from 'next';
import './globals.css';
import { brandFontVars } from '@/lib/fonts';
import Grain from '@/components/grain';

export const metadata: Metadata = {
  title: 'Malnad Stories',
  description: 'Turn your travel memories into beautiful printed photo albums.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/* Editorial typography (Cormorant Garamond + Work Sans) applied globally via the
          brand font vars; Work Sans (`font-ui`) is the base UI face. The paper-grain
          overlay sits above content (pointer-events: none) for the handcrafted feel. */}
      <body className={`${brandFontVars} font-ui`}>
        {children}
        <Grain />
      </body>
    </html>
  );
}
