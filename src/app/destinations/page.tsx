import Link from 'next/link';
import Image from 'next/image';
import PublicPage from '@/components/public-page';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Destinations — Malnad Stories' };

const DESTINATIONS = [
  {
    slug: 'chikmagalur',
    name: 'Chikmagalur',
    sub: 'The Land of Coffee & Peaks',
    desc: 'Mist-wrapped hills, endless coffee estates, and the highest peaks in Karnataka. A perfect backdrop for misty, forest-green memories.',
    image: 'https://images.unsplash.com/photo-1590766940554-634a7ed41450?q=80&w=800&auto=format&fit=crop',
    quote: '“The smell of wet earth and cardamom followed us up the mountain roads.”',
  },
  {
    slug: 'sakleshpur',
    name: 'Sakleshpur',
    sub: 'Valleys & Green Slopes',
    desc: 'Breathtaking valleys, historic railway bridges, and cardamom-scented paths. A quiet sanctuary for unhurried storytelling.',
    image: 'https://images.unsplash.com/photo-1616843413587-9e3a37f7bbd8?q=80&w=800&auto=format&fit=crop',
    quote: '“We found a clearing by the stream where the forest seemed to hold its breath.”',
  },
  {
    slug: 'coorg',
    name: 'Coorg (Kodagu)',
    sub: 'The Misty Scotland of India',
    desc: 'Cascading waterfalls, orange groves, and spice plantations. Rich histories and vibrant green landscapes fit for premium prints.',
    image: 'https://images.unsplash.com/photo-1588598126701-44755a5b51b3?q=80&w=800&auto=format&fit=crop',
    quote: '“The morning mist didn’t clear until noon, leaving everything damp and green.”',
  },
  {
    slug: 'kemmangundi',
    name: 'Kemmangundi',
    sub: 'Royal Retreats & Waterfalls',
    desc: 'Dense forests, ornamental gardens, and cascades. A royal hillside escape capturing the wild nature of the Western Ghats.',
    image: 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?q=80&w=800&auto=format&fit=crop',
    quote: '“The red dirt paths carved through the green slopes like ancient seams.”',
  },
];

export default function DestinationsPage() {
  return (
    <PublicPage
      eyebrow="Explore Malnad"
      title="Journeys worth preserving"
      intro="Our physical photobooks are designed to honor the unique colors, mists, and coffee trails of the Western Ghats."
      wide
    >
      <div className="space-y-16">
        <div className="grid gap-8 sm:grid-cols-2">
          {DESTINATIONS.map((d) => (
            <article key={d.slug} className="group flex flex-col overflow-hidden border border-border bg-card shadow-xs transition-shadow hover:shadow-card">
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
                <Image
                  src={d.image}
                  alt={d.name}
                  fill
                  unoptimized
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>

              <div className="flex flex-1 flex-col justify-between p-6">
                <div>
                  <h2 className="mb-1 select-none font-handwritten text-4xl leading-none tracking-wide text-gold">
                    {d.name}
                  </h2>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {d.sub}
                  </p>
                  <p className="mb-6 text-sm font-light leading-relaxed text-muted-foreground">{d.desc}</p>
                </div>

                <div className="mt-auto border-t border-border/60 pt-4">
                  <blockquote className="text-pretty font-handwritten text-xl italic text-primary/70">
                    {d.quote}
                  </blockquote>
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* Storytelling Footer Call to Action */}
        <div className="mx-auto max-w-xl space-y-4 border border-border bg-secondary p-8 text-center">
          <h3 className="font-display text-2xl font-medium text-primary">
            Ready to tell your story?
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground font-light">
            Start compiling your photographs, organize them by destination chapters, and let our custom studio lay 
            them out beautifully on paper.
          </p>
          <div className="pt-2">
            <Button render={<Link href="/signup" />} className="font-semibold px-8 h-10">
              Start Your Album
            </Button>
          </div>
        </div>
      </div>
    </PublicPage>
  );
}
