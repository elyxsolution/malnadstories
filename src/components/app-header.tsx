import Link from 'next/link';
import { signOut } from '@/lib/actions/auth';
import { Sprig } from '@/components/brand';
import { brandFontVars } from '@/lib/fonts';

export default function AppHeader({ email }: { email: string }) {
  return (
    <header
      className={`${brandFontVars} sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b bg-background/80 px-6 backdrop-blur-md sm:px-8`}
    >
      <Link href="/dashboard" className="inline-flex items-center gap-2 tracking-tight">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/[0.07] text-primary ring-1 ring-primary/15">
          <Sprig className="h-[15px] w-[15px]" />
        </span>
        <span className="font-display text-[15px] font-semibold">Malnad Stories</span>
      </Link>
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}
