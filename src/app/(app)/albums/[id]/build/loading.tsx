/**
 * Builder route skeleton (Phase: premium loading). Mirrors the studio's 3-column shell —
 * left rail + photo sidebar, centre canvas with a floating spread, right inspector, and the
 * bottom timeline — so opening an album reserves the final layout with a calm shimmer
 * instead of a blank flash or a bare spinner. CSS-only `.skeleton` shimmer; no client JS.
 */
export default function BuilderLoading() {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[hsl(150_12%_97%)]" aria-busy="true" aria-label="Opening your album">
      {/* Header */}
      <div className="flex h-14 flex-none items-center gap-3 border-b border-border/70 bg-card px-4">
        <div className="skeleton h-7 w-7 rounded-lg" />
        <div className="skeleton h-4 w-40 rounded-md" />
        <div className="ml-auto skeleton h-7 w-24 rounded-lg" />
      </div>

      {/* Toolbar */}
      <div className="flex h-14 flex-none items-center gap-2 border-b border-border/70 bg-card/60 px-4">
        <div className="skeleton h-4 w-32 rounded-md" />
        <div className="ml-auto flex items-center gap-2">
          <div className="skeleton h-8 w-20 rounded-lg" />
          <div className="skeleton h-8 w-24 rounded-lg" />
          <div className="skeleton h-8 w-24 rounded-lg" />
          <div className="skeleton h-8 w-24 rounded-lg" />
        </div>
      </div>

      {/* 3 columns */}
      <div className="flex min-h-0 flex-1">
        {/* Left rail + sidebar */}
        <div className="flex flex-none border-r border-border/70 bg-card">
          <div className="flex w-[68px] flex-col items-center gap-2 border-r border-border/70 py-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-12 w-12 rounded-xl" />
            ))}
          </div>
          <div className="hidden w-[284px] flex-col gap-3 p-4 lg:flex">
            <div className="skeleton h-9 w-full rounded-xl" />
            <div className="skeleton h-24 w-full rounded-xl" />
            <div className="grid grid-cols-2 gap-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton aspect-square w-full rounded-xl" />
              ))}
            </div>
          </div>
        </div>

        {/* Centre canvas */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 flex-none items-center justify-between border-b border-border/60 px-4">
            <div className="skeleton h-5 w-40 rounded-md" />
            <div className="skeleton h-7 w-32 rounded-lg" />
          </div>
          <div className="flex flex-1 items-center justify-center p-6 lg:p-10">
            <div className="skeleton aspect-[3/2] w-full max-w-[1000px] rounded-[14px]" />
          </div>
        </div>

        {/* Right inspector */}
        <div className="hidden w-[300px] flex-none flex-col gap-3 border-l border-border/70 bg-card p-4 md:flex">
          <div className="skeleton h-8 w-36 rounded-lg" />
          <div className="skeleton h-9 w-full rounded-lg" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-6 w-full rounded-md" />
          ))}
        </div>
      </div>

      {/* Bottom timeline */}
      <div className="flex h-16 flex-none items-center gap-3 border-t border-border/70 bg-card px-4">
        <div className="skeleton h-8 w-16 rounded-md" />
        <div className="flex flex-1 gap-2 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-16 flex-none rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}
