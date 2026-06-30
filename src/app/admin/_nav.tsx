'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ClipboardList,
  Factory,
  Truck,
  Users,
  LifeBuoy,
  BadgeIndianRupee,
  RotateCcw,
  Image as ImageIcon,
  ClipboardCheck,
  LayoutTemplate,
  BookImage,
  Sticker,
  Ticket,
  BarChart3,
  Server,
  Shield,
  ShieldAlert,
  HardDrive,
  Settings,
  FileText,
  Newspaper,
  Activity,
  Bug,
} from 'lucide-react';

type Item = { href: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };

const GROUPS: { label: string; items: Item[] }[] = [
  { label: 'Operations', items: [{ href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true }] },
  {
    label: 'Fulfilment',
    items: [
      { href: '/admin/orders', label: 'Orders', icon: ClipboardList },
      { href: '/admin/production', label: 'Production', icon: Factory },
      { href: '/admin/shipping', label: 'Shipping', icon: Truck },
    ],
  },
  {
    label: 'Relationships',
    items: [
      { href: '/admin/customers', label: 'Customers', icon: Users },
      { href: '/admin/support', label: 'Support', icon: LifeBuoy },
      { href: '/admin/refunds', label: 'Refunds', icon: BadgeIndianRupee },
      { href: '/admin/reprints', label: 'Reprints', icon: RotateCcw },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { href: '/admin/albums', label: 'Albums', icon: ImageIcon },
      { href: '/admin/reviews', label: 'Album Reviews', icon: ClipboardCheck },
      { href: '/admin/templates', label: 'Layouts', icon: LayoutTemplate },
      { href: '/admin/covers', label: 'Covers', icon: BookImage },
      { href: '/admin/stickers', label: 'Stickers', icon: Sticker },
      { href: '/admin/coupons', label: 'Coupons', icon: Ticket },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/cms', label: 'CMS', icon: FileText, exact: true },
      { href: '/admin/cms/content', label: 'Content', icon: Newspaper },
    ],
  },
  { label: 'Business', items: [{ href: '/admin/analytics', label: 'Analytics', icon: BarChart3 }] },
  {
    label: 'Platform',
    items: [
      { href: '/admin/monitoring', label: 'Monitoring', icon: Activity },
      { href: '/admin/errors', label: 'Errors', icon: Bug },
      { href: '/admin/security', label: 'Security', icon: ShieldAlert },
      { href: '/admin/storage', label: 'Storage', icon: HardDrive },
      { href: '/admin/system', label: 'System', icon: Server },
      { href: '/admin/users', label: 'Users & Roles', icon: Shield },
      { href: '/admin/settings', label: 'Settings', icon: Settings },
    ],
  },
];

/**
 * Operations command rail (Claude Design) — dark forest-green grouped left nav. Presentation
 * only; every destination is an existing requireAdmin-gated route. Prefetch disabled so the
 * always-present rail doesn't fan out RSC requests that race the refresh token.
 */
export default function AdminNav({ allowed }: { allowed: string[] }) {
  const pathname = usePathname();
  // Filter to the server-computed allow-list (RBAC). Drop groups with no visible items.
  const allow = new Set(allowed);
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => allow.has(it.href)) })).filter(
    (g) => g.items.length > 0,
  );
  return (
    <nav className="sticky top-14 z-20 h-[calc(100vh-3.5rem)] w-[60px] flex-none overflow-y-auto bg-[#16271f] py-4 text-[#a9bdb0] sm:w-[218px]">
      <div className="px-3 sm:px-4">
        <p className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5f7d6e] sm:block">Command Center</p>
      </div>
      {groups.map((g) => (
        <div key={g.label} className="mt-4">
          <p className="hidden px-4 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5f7d6e] sm:block">{g.label}</p>
          <div className="flex flex-col gap-0.5 px-2">
            {g.items.map((it) => {
              const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
              const Icon = it.icon;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  prefetch={false}
                  title={it.label}
                  className={`flex items-center gap-3 rounded-[2px] border-l-2 px-2.5 py-2 text-[13px] transition-colors ${
                    active
                      ? 'border-[#ecd9ad] bg-white/[0.06] font-medium text-[#f5efe3]'
                      : 'border-transparent text-[#a9bdb0] hover:bg-white/[0.04] hover:text-[#f5efe3]'
                  }`}
                >
                  <Icon className="h-[18px] w-[18px] flex-none" />
                  <span className="hidden sm:inline">{it.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
