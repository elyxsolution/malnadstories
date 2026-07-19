import type { Metadata } from 'next';
import './globals.css';
import './loader.css'; // the ONE loading animation, loaded once (src/components/loading)
import { brandFontVars } from '@/lib/fonts';
import Grain from '@/components/grain';
import { LoadingProvider } from '@/components/loading';

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
        {/* Single app-wide loading overlay host (long-running ops via useGlobalLoading). */}
        <LoadingProvider>{children}</LoadingProvider>
        <Grain />
      </body>
    </html>
  );
}
