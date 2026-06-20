'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Library, Package, User } from 'lucide-react';

/**
 * Customer area sub-nav (Dashboard library / Orders / Account) — the prototype's left
 * rail rendered as a calm top tab strip. Presentation only; every destination is an
 * existing, auth-guarded (app) route.
 */
const ITEMS = [
  { href: '/dashboard', label: 'Your stories', icon: Library, match: (p: string) => p === '/dashboard' || p.startsWith('/albums') },
  { href: '/orders', label: 'Orders', icon: Package, match: (p: string) => p === '/orders' || p.startsWith('/orders/') },
  { href: '/account', label: 'Account', icon: User, match: (p: string) => p.startsWith('/account') },
];

export default function CustomerNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 border-b border-border/70">
      {ITEMS.map((it) => {
        const active = it.match(pathname);
        const Icon = it.icon;
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" /> {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
