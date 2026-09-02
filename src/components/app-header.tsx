import Link from 'next/link';
import Image from 'next/image';
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
      className={`${brandFontVars} sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b bg-background/95 px-6 supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur-sm sm:px-8`}
    >
      <Link href="/dashboard" className="inline-flex items-center gap-2 tracking-tight">
        <Image
          src="/logo.png"
          alt=""
          width={447}
          height={558}
          priority
          unoptimized
          className="h-7 w-auto"
        />
        <span className="font-display text-[15px] font-semibold">Malnad Stories</span>
      </Link>
      <AccountMenu identity={accountIdentity(email, name)} context="app" />
    </header>
  );
}
