'use client';

import { usePathname } from 'next/navigation';
import AppHeader from '@/components/app-header';

/**
 * Renders the global customer app header everywhere EXCEPT the album builder route, which
 * ships its own unified, full-bleed header (`albums/[id]/build/_header.tsx`). This removes
 * the old duplicate-navbar problem without changing the header on any other page.
 */
export default function AppHeaderGate({ email }: { email: string }) {
  const pathname = usePathname() ?? '';
  const onBuilder = /^\/albums\/[^/]+\/build\/?$/.test(pathname);
  if (onBuilder) return null;
  return <AppHeader email={email} />;
}
