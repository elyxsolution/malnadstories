import PublicPage from '@/components/public-page';
import { listPublished } from '@/lib/cms/public';

export const metadata = { title: 'FAQ — Malnad Stories' };

/** Public FAQ page. RLS + listPublished return only PUBLISHED faq rows. Grouped by category. */
export default async function FaqPage() {
  const faqs = await listPublished('faq');

  // Group by metadata.category (uncategorised last).
  const groups = new Map<string, typeof faqs>();
  for (const f of faqs) {
    const cat = (typeof f.metadata.category === 'string' && f.metadata.category.trim()) || 'General';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(f);
  }
  const ordered = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <PublicPage
      eyebrow="Help"
      title="Frequently asked questions"
      intro="Everything you need to know about creating, ordering, and receiving your album."
    >
      {faqs.length === 0 ? (
        <p className="border border-dashed border-border bg-card/40 px-4 py-12 text-center text-sm text-muted-foreground">
          No questions published yet. Check back soon.
        </p>
      ) : (
        <div className="space-y-10">
          {ordered.map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-4 font-display text-xl font-medium tracking-tight text-primary">{category}</h2>
              <dl className="divide-y divide-border border-y border-border">
                {items.map((f) => (
                  <div key={f.id} className="py-5">
                    <dt className="font-display text-lg leading-snug text-foreground">{f.title}</dt>
                    {f.content && (
                      <dd className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                        {f.content}
                      </dd>
                    )}
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </PublicPage>
  );
}
