/**
 * Dashboard route skeleton (Phase: premium loading). Mirrors the customer shell — the
 * forest-green command rail + the library masthead, filter chips and book-spine shelf — so
 * the dashboard fades in over a calm shimmer rather than a blank flash. CSS-only.
 */
export default function DashboardLoading() {
  return (
    <div className="brand-surface flex min-h-[calc(100vh-3.5rem)]" aria-busy="true" aria-label="Loading your stories">
      {/* Command rail (matches CustomerShell) */}
      <aside className="sticky top-14 z-20 hidden h-[calc(100vh-3.5rem)] w-[68px] flex-none flex-col bg-primary-deep py-6 sm:flex sm:w-[236px]">
        <div className="mb-9 flex items-center gap-3 px-4 sm:px-6">
          <div className="h-8 w-8 flex-none rounded-sm bg-primary-foreground/15" />
          <div className="hidden h-5 w-24 rounded bg-primary-foreground/15 sm:block" />
        </div>
        <div className="flex flex-col gap-2 px-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-11 w-full rounded-sm bg-primary-foreground/10" />
          ))}
        </div>
        <div className="mt-auto px-3">
          <div className="h-11 w-full rounded-sm bg-primary-foreground/15" />
        </div>
      </aside>

      {/* Content */}
      <main className="min-w-0 flex-1 px-5 py-8 sm:px-10 sm:py-12">
        {/* Masthead */}
        <div className="skeleton h-4 w-28 rounded-md" />
        <div className="skeleton mt-3 h-10 w-72 max-w-full rounded-lg" />
        <div className="skeleton mt-3 h-4 w-96 max-w-full rounded-md" />

        {/* Filter row */}
        <div className="mt-8 flex flex-wrap items-center gap-2">
          <div className="skeleton h-9 w-64 max-w-full rounded-lg" />
          <div className="ml-auto flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-8 w-24 rounded-full" />
            ))}
          </div>
        </div>

        {/* Shelf grid */}
        <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <div className="skeleton aspect-[3/4] w-full rounded-lg" />
              <div className="skeleton h-4 w-3/4 rounded-md" />
              <div className="skeleton h-3 w-1/2 rounded-md" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
