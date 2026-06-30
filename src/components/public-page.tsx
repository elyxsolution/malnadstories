import PublicHeader from '@/components/public-header';
import PublicFooter from '@/components/public-footer';

/**
 * Shared chrome for the public (anon-readable) marketing + CMS pages — FAQ, testimonials,
 * stories, pricing, contact, destinations. Editorial masthead between the shared header and
 * footer. Presentation only; no auth, no data.
 */
export default function PublicPage({
  eyebrow,
  title,
  intro,
  wide,
  children,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  /** Wider content column for grid-heavy pages (pricing, destinations). */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="brand-surface flex min-h-screen flex-col font-ui">
      <PublicHeader />

      <main className="flex-1">
        {/* Masthead */}
        <div className="border-b border-border/60">
          <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 lg:py-20">
            <div className="max-w-3xl">
              {eyebrow && (
                <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.2em] text-gold">
                  {eyebrow}
                </p>
              )}
              <h1 className="text-balance font-display text-4xl font-normal leading-[1.02] tracking-tight text-primary sm:text-5xl">
                {title}
              </h1>
              {intro && (
                <p className="mt-5 max-w-2xl text-pretty text-lg font-light leading-relaxed text-muted-foreground">
                  {intro}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="mx-auto px-5 py-12 sm:px-8 lg:py-16" style={{ maxWidth: wide ? '72rem' : '56rem' }}>
          {children}
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
