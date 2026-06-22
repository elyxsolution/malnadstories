import { Star, Quote } from 'lucide-react';
import PublicPage from '@/components/public-page';
import { listPublished } from '@/lib/cms/public';

export const metadata = { title: 'Testimonials — Malnad Stories' };

// Phase 10D: ISR/CDN backstop; admin CMS busts the `cms-public` tag on change.
export const revalidate = 300;

/** Public testimonials page. Only PUBLISHED testimonial rows (RLS + listPublished). */
export default async function TestimonialsPage() {
  const items = await listPublished('testimonial');

  return (
    <PublicPage
      eyebrow="Loved by travellers"
      title="What our customers say"
      intro="Real words from people who turned their journeys into albums worth keeping."
    >
      {items.length === 0 ? (
        <p className="border border-dashed border-border bg-card/40 px-4 py-12 text-center text-sm text-muted-foreground">
          No testimonials published yet.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((t) => {
            const rating = typeof t.metadata.rating === 'number' ? Math.max(0, Math.min(5, t.metadata.rating)) : 0;
            const location = typeof t.metadata.location === 'string' ? t.metadata.location : null;
            return (
              <figure key={t.id} className="flex flex-col border border-border bg-card p-5">
                <Quote className="h-5 w-5 text-gold" aria-hidden />
                {rating > 0 && (
                  <div className="mt-3 flex gap-0.5" aria-label={`${rating} out of 5`}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-4 w-4 ${i < rating ? 'fill-gold text-gold' : 'text-muted-foreground/30'}`}
                      />
                    ))}
                  </div>
                )}
                {t.content && (
                  <blockquote className="mt-3 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {t.content}
                  </blockquote>
                )}
                <figcaption className="mt-4 text-sm">
                  <span className="font-display text-base text-primary">{t.title}</span>
                  {location && <span className="block text-xs text-muted-foreground">{location}</span>}
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </PublicPage>
  );
}
