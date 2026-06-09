'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Package, Ticket, Users, Image as ImageIcon } from 'lucide-react';

const ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/orders', label: 'Orders', icon: Package, exact: false },
  { href: '/admin/coupons', label: 'Coupons', icon: Ticket, exact: false },
  { href: '/admin/customers', label: 'Customers', icon: Users, exact: false },
  { href: '/admin/albums', label: 'Albums', icon: ImageIcon, exact: false },
];

export default function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b bg-card px-4">
      {ITEMS.map((it) => {
        const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
        const Icon = it.icon;
        return (
          <Link
            key={it.href}
            href={it.href}
            // Prefetch disabled on the always-present admin nav: by default Next would
            // prefetch all 5 admin routes whenever this bar is in view, firing 5
            // concurrent RSC requests that each hit middleware getUser() + requireAdmin()
            // and race to refresh/rotate the same refresh token (→ refresh_token_not_found
            // + serialized auth stalls). Navigation is on click instead.
            prefetch={false}
            className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
              active
                ? 'border-foreground font-medium text-foreground'
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
