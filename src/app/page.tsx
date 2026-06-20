import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      {/* Soft brand ambience — a quiet sage wash, never a loud gradient. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_-10%,hsl(var(--accent)/0.55),transparent_70%)]"
      />

      {/* Minimal top bar */}
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="h-2 w-2 rounded-full bg-primary" />
          Malnad Stories
        </span>
        <Button render={<Link href="/login" />} variant="ghost" size="sm">
          Log in
        </Button>
      </header>

      {/* Hero */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="animate-rise max-w-2xl space-y-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
            Premium printed photo albums · delivered across India
          </span>

          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Turn your travel memories into a book worth keeping.
          </h1>

          <p className="text-pretty mx-auto max-w-xl text-lg leading-relaxed text-muted-foreground">
            Upload your photos, arrange them into beautiful pages, and we’ll print
            and deliver a premium hardcover album — made to be held, gifted, and kept.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button render={<Link href="/signup" />} size="lg">
              Create your album
            </Button>
            <Button render={<Link href="/login" />} variant="outline" size="lg">
              Log in
            </Button>
          </div>

          <p className="pt-2 text-xs text-muted-foreground">
            Secure checkout · 24, 36 &amp; 48-page hardcovers · No app required
          </p>
        </div>
      </div>
    </main>
  );
}
