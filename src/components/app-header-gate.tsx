'use client';

import { usePathname } from 'next/navigation';
import AppHeader from '@/components/app-header';

/**
 * Renders the global customer app header everywhere EXCEPT the routes that ship their own
 * unified, full-bleed header (logo + progress + actions): the album builder
 * (`albums/[id]/build/_header.tsx`) and the album-creation wizard (`albums/new/_wizard.tsx`).
 * This removes the old duplicate-navbar problem without changing the header on any other page.
 */
export default function AppHeaderGate({ email }: { email: string }) {
  const pathname = usePathname() ?? '';
  const ownsHeader =
    /^\/albums\/[^/]+\/build\/?$/.test(pathname) || // album builder
    /^\/albums\/new\/?$/.test(pathname); // album-creation wizard
  if (ownsHeader) return null;
  return <AppHeader email={email} />;
}
