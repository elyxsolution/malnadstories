import Image from 'next/image';
import { Star } from 'lucide-react';
import PublicPage from '@/components/public-page';
import { listPublished } from '@/lib/cms/public';

export const metadata = { title: 'Stories — Malnad Stories' };

// Phase 10D: ISR/CDN backstop; admin CMS busts the `cms-public` tag on change.
export const revalidate = 300;

/**
 * Public legacy-stories showcase. Only PUBLISHED legacy_story rows (RLS + listPublished),
 * featured first. Pure CMS content — NOT linked to any real customer album.
 */
export default async function StoriesPage() {
  const stories = await listPublished('legacy_story');

  return (
    <PublicPage
      eyebrow="Inspiration"
      title="Stories worth keeping"
      intro="A look at the kinds of albums travellers have made with us."
    >
      {stories.length === 0 ? (
        <p className="border border-dashed border-border bg-card/40 px-4 py-12 text-center text-sm text-muted-foreground">
          No stories published yet.
        </p>
      ) : (
        <div className="space-y-8">
          {stories.map((s) => {
            const subtitle = typeof s.metadata.subtitle === 'string' ? s.metadata.subtitle : null;
            const featured = Boolean(s.metadata.featured);
            return (
              <article key={s.id} className="overflow-hidden border border-border bg-card">
                {s.coverImage && (
                  <div className="relative aspect-[16/9] w-full bg-muted">
                    {/* CMS-provided remote URL; unoptimized to avoid next/image domain config. */}
                    <Image
                      src={s.coverImage}
                      alt={s.title}
                      fill
                      unoptimized
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, 768px"
                    />
                  </div>
                )}
                <div className="p-6">
                  {featured && (
                    <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-medium text-gold">
                      <Star className="h-3 w-3 fill-gold" /> Featured
                    </span>
                  )}
                  <h2 className="font-display text-2xl font-medium tracking-tight text-primary">{s.title}</h2>
                  {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
                  {s.content && (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{s.content}</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </PublicPage>
  );
}
