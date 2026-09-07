import Link from 'next/link';
import Image from 'next/image';
import { Plus } from 'lucide-react';
import AccountMenu from '@/components/account/account-menu';
import { accountIdentity } from '@/lib/auth/identity';
import { brandFontVars } from '@/lib/fonts';

/**
 * The authenticated app header. The LEFT side — the mark and the wordmark — is unchanged and
 * stays: it is the only brand statement on these screens now that the rail's duplicate is gone.
 *
 * The RIGHT side used to print the signed-in address in plain text beside a "Log out" link:
 * a customer's email on screen for anyone standing behind them, and a terminal action one
 * mis-click away from the thing next to it. Both are now inside one account control, which
 * carries the identity where a person has to ask for it and puts logging out at the bottom of a
 * menu rather than in the bar. `signOut` itself is untouched — the menu submits the same form.
 *
 * `context="app"` is what makes this menu the way OUT to the public site (Home / Stories /
 * Contact & FAQ). The public header renders the SAME component with `context="public"`.
 */
export default function AppHeader({ email, name }: { email: string; name?: string | null }) {
  return (
    <header
      className={`${brandFontVars} sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/95 px-4 supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur-sm sm:px-8`}
    >
      <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-sm tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-sm:min-h-11 max-sm:min-w-0">
        <Image
          src="/logo.png"
          alt=""
          width={447}
          height={558}
          priority
          unoptimized
          className="h-7 w-auto"
        />
        <span className="font-heading text-[17px] font-semibold max-sm:truncate">Malnad Stories</span>
      </Link>
      <div className="flex flex-none items-center gap-2">
        {/*
          "New album" — PHONE ONLY, and only because the phone has nowhere else to put it. On
          `sm` and up the left rail still carries the gold CTA exactly as it always has, so this
          renders nothing there and the desktop header is byte-identical to before. Below `sm`
          the rail is not drawn at all (see customer-shell), and the app's one creation action
          would otherwise be two navigations deep — so it moves to the bar, at the rail's own
          gold, sized to clear 44px.
        */}
        <Link
          href="/albums/new"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-sm bg-gold-pale px-3 text-[13px] font-semibold text-primary transition-[background-color,transform] duration-150 ease-glide active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:hidden"
        >
          <Plus className="h-4 w-4" />
          New
        </Link>
        <AccountMenu identity={accountIdentity(email, name)} context="app" />
      </div>
    </header>
  );
}
