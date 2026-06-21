import Link from 'next/link';
import { Sprig } from '@/components/brand';

/**
 * Shared chrome for the public (anon-readable) CMS pages — FAQ, testimonials, stories.
 * Minimal brand header + a footer linking the three. Presentation only; no auth, no data.
 */
export default function PublicPage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="brand-surface flex min-h-screen flex-col font-ui">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/" className="inline-flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center border border-[#b89a5c] text-gold">
            <Sprig className="h-4 w-4" />
          </span>
          <span className="font-display text-lg font-semibold leading-none text-primary">
            Malnad <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Stories</span>
          </span>
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary"
        >
          Log in
        </Link>
      </header>

      <main className="flex-1 px-6 py-10 sm:px-10 lg:py-16">
        <div className="mx-auto max-w-3xl">
          {eyebrow && (
            <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.18em] text-gold">{eyebrow}</p>
          )}
          <h1 className="font-display text-[2.6rem] font-normal leading-none tracking-tight text-primary">{title}</h1>
          {intro && <p className="mt-3 max-w-2xl text-base font-light text-muted-foreground">{intro}</p>}
          <div className="mt-10">{children}</div>
        </div>
      </main>

      <footer className="border-t border-border px-6 py-8 sm:px-10">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link href="/faq" className="transition-colors hover:text-primary">
            FAQ
          </Link>
          <Link href="/stories" className="transition-colors hover:text-primary">
            Stories
          </Link>
          <Link href="/testimonials" className="transition-colors hover:text-primary">
            Testimonials
          </Link>
          <span className="ml-auto text-xs">© {new Date().getFullYear()} Malnad Stories</span>
        </div>
      </footer>
    </div>
  );
}
