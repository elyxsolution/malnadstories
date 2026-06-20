'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Library, Package, User, Plus } from 'lucide-react';
import { Sprig } from '@/components/brand';

/**
 * Customer area shell (Claude Design) — the dark forest-green left command rail with the
 * brand mark, primary nav, a gold "New album" CTA and an account chip. Sits beneath the
 * global app header (sticky from top-14). Presentation + navigation only; every link is
 * an existing auth-guarded route.
 */
const NAV = [
  { href: '/dashboard', label: 'Your stories', icon: Library, match: (p: string) => p === '/dashboard' || p.startsWith('/albums') },
  { href: '/orders', label: 'Orders', icon: Package, match: (p: string) => p.startsWith('/orders') },
  { href: '/account', label: 'Account', icon: User, match: (p: string) => p.startsWith('/account') },
];

export default function CustomerShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const initial = (email || 'U').trim().charAt(0).toUpperCase();

  return (
    <div className="brand-surface flex min-h-[calc(100vh-3.5rem)]">
      <aside className="sticky top-14 z-20 flex h-[calc(100vh-3.5rem)] w-[68px] flex-none flex-col bg-[#16271f] py-6 text-[#cbd9cf] sm:w-[236px]">
        <Link href="/dashboard" className="mb-9 flex items-center gap-3 px-4 sm:px-6">
          <span className="grid h-8 w-8 flex-none place-items-center border border-[#b89a5c] text-[#ecd9ad]">
            <Sprig className="h-4 w-4" />
          </span>
          <span className="hidden font-display text-[19px] font-semibold leading-none text-[#f5efe3] sm:block">
            Malnad
            <span className="block text-[10px] uppercase tracking-[0.2em] text-[#8aa395]">Stories</span>
          </span>
        </Link>

        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((n) => {
            const active = n.match(pathname);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-3 rounded-[2px] px-3 py-3 text-sm transition-colors ${
                  active ? 'bg-white/[0.08] font-semibold text-[#f5efe3]' : 'text-[#cbd9cf] hover:bg-white/[0.05]'
                }`}
              >
                <Icon className="h-[18px] w-[18px] flex-none" />
                <span className="hidden sm:inline">{n.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2 px-3">
          <Link
            href="/albums/new"
            className="flex items-center justify-center gap-2 bg-[#ecd9ad] px-3 py-3 text-[13px] font-semibold text-[#1e3a2f] transition-colors hover:bg-[#f2e3bd]"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New album</span>
          </Link>
          <Link
            href="/account"
            className="mt-1 flex items-center gap-3 px-1 py-2 text-[#8aa395] transition-colors hover:text-[#f5efe3]"
          >
            <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[#2a4a3b] font-display text-sm text-[#ecd9ad]">
              {initial}
            </span>
            <span className="hidden min-w-0 leading-tight sm:block">
              <span className="block truncate text-[13px] text-[#cbd9cf]">{email}</span>
              <span className="block text-[11px] text-[#6f8a7c]">View account</span>
            </span>
          </Link>
        </div>
      </aside>

      <main className="min-w-0 flex-1 font-ui">{children}</main>
    </div>
  );
}
