/**
 * Checkout route skeleton (Phase: premium loading). Mirrors the checkout layout — a stepper,
 * the main panel, and the persistent order rail — so the flow opens over a calm shimmer
 * instead of a blank screen while the album + pricing load server-side. CSS-only.
 */
export default function CheckoutLoading() {
  return (
    <div className="brand-surface min-h-[calc(100vh-3.5rem)]" aria-busy="true" aria-label="Preparing checkout">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        {/* Stepper */}
        <div className="mb-8 flex items-center gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-1 items-center gap-3">
              <div className="skeleton h-8 w-8 flex-none rounded-full" />
              <div className="skeleton h-3 flex-1 rounded-full" />
            </div>
          ))}
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
          {/* Main panel */}
          <div className="space-y-4">
            <div className="skeleton h-6 w-48 rounded-md" />
            <div className="skeleton h-28 w-full rounded-2xl" />
            <div className="skeleton h-28 w-full rounded-2xl" />
            <div className="skeleton h-12 w-40 rounded-lg" />
          </div>

          {/* Order rail */}
          <aside className="space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-card">
            <div className="flex gap-3">
              <div className="skeleton h-20 w-16 flex-none rounded-md" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-32 rounded-md" />
                <div className="skeleton h-3 w-24 rounded-md" />
              </div>
            </div>
            <div className="skeleton h-9 w-full rounded-lg" />
            <div className="space-y-2 border-t border-border/60 pt-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex justify-between">
                  <div className="skeleton h-3 w-20 rounded-md" />
                  <div className="skeleton h-3 w-12 rounded-md" />
                </div>
              ))}
              <div className="flex justify-between pt-2">
                <div className="skeleton h-5 w-16 rounded-md" />
                <div className="skeleton h-5 w-20 rounded-md" />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
