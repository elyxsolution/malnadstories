import { db } from '@/db';
import { products } from '@/db/schema';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { Check } from 'lucide-react';
import PublicPage from '@/components/public-page';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Pricing — Malnad Stories' };

export default async function PricingPage() {
  let activeProducts = [];
  try {
    activeProducts = await db
      .select({
        id: products.id,
        name: products.name,
        pages: products.pages,
        basePrice: products.basePrice,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(products.pages);
  } catch (e) {
    console.warn('Database query failed. Using mock products catalog.', e);
    activeProducts = [
      { id: 'prod_1', name: 'Standard Chapter', pages: 24, basePrice: '3200' },
      { id: 'prod_2', name: 'Classic Journey', pages: 36, basePrice: '4200' },
      { id: 'prod_3', name: 'Heirloom Chronicle', pages: 48, basePrice: '5200' },
    ];
  }

  return (
    <PublicPage
      eyebrow="Products & Pricing"
      title="Albums made to last"
      intro="Timeless layflat books handcrafted with high-quality paper, premium binding, and shipping included."
      wide
    >
      {activeProducts.length === 0 ? (
        <p className="border border-dashed border-border bg-card/40 px-4 py-12 text-center text-sm text-muted-foreground">
          No active products available at the moment. Please contact support.
        </p>
      ) : (
        <div className="space-y-16">
          {/* Pricing cards grid */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {activeProducts.map((p) => {
              // Highlight the 36-page album as the recommended/featured choice
              const isFeatured = p.pages === 36;
              const formattedPrice = new Intl.NumberFormat('en-IN', {
                style: 'currency',
                currency: 'INR',
                maximumFractionDigits: 0,
              }).format(Number(p.basePrice));

              return (
                <div
                  key={p.id}
                  className={`flex flex-col border p-6 transition-all duration-300 ${
                    isFeatured
                      ? 'bg-primary text-primary-foreground border-transparent shadow-elevated'
                      : 'bg-card border-border text-foreground shadow-xs hover:shadow-card hover:-translate-y-0.5'
                  }`}
                >
                  <div className="mb-4">
                    {isFeatured && (
                      <span className="mb-2.5 inline-block text-[10px] font-semibold uppercase tracking-[0.16em] text-gold">
                        Most Popular
                      </span>
                    )}
                    <h3 className={`font-display text-2xl font-semibold leading-tight ${isFeatured ? 'text-primary-foreground' : 'text-primary'}`}>
                      {p.name}
                    </h3>
                    <p className={`mt-1 text-xs ${isFeatured ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                      {p.pages} Content Pages · Layflat Binding
                    </p>
                  </div>

                  <div className="my-6">
                    <span className="font-display text-4xl font-normal tracking-tight tabular-nums">
                      {formattedPrice}
                    </span>
                    <span className={`text-xs ml-1 ${isFeatured ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                      all taxes incl.
                    </span>
                  </div>

                  <ul className="space-y-3.5 text-sm mb-8 flex-1">
                    <li className="flex items-start gap-2.5">
                      <Check className={`h-4 w-4 shrink-0 mt-0.5 ${isFeatured ? 'text-gold' : 'text-primary'}`} />
                      <span>Up to {Math.round(p.pages * 2.2)} custom photos uploaded</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className={`h-4 w-4 shrink-0 mt-0.5 ${isFeatured ? 'text-gold' : 'text-primary'}`} />
                      <span>Layflat linen hardcover binding</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className={`h-4 w-4 shrink-0 mt-0.5 ${isFeatured ? 'text-gold' : 'text-primary'}`} />
                      <span>Archival uncoated warm-white paper</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className={`h-4 w-4 shrink-0 mt-0.5 ${isFeatured ? 'text-gold' : 'text-primary'}`} />
                      <span>Gold-foil spine lettering available</span>
                    </li>
                  </ul>

                  <Button
                    render={<Link href="/signup" />}
                    variant={isFeatured ? 'secondary' : 'default'}
                    className="w-full h-10 font-semibold"
                  >
                    Select {p.pages} Pages
                  </Button>
                </div>
              );
            })}
          </div>

          {/* Detailed Features comparison */}
          <div className="border border-border bg-card p-6 sm:p-8">
            <h3 className="font-display text-xl font-medium tracking-tight text-primary mb-6">
              Included in every Malnad Stories photobook
            </h3>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Archival Grade Materials</h4>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Our papers are certified to last over 100 years without fading or yellowing. We use heavy-weight 
                  uncoated paper to give your landscape shots a natural, premium matte texture.
                </p>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground">Hand-Sewn Layflat Binding</h4>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Unlike traditional booklets, layflat binding allows double-page panoramic photo spreads to open 
                  completely flat on a table, with no image lost in the middle seam gutter.
                </p>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground">Worker Image Hardening</h4>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Every uploaded photograph undergoes an automated image-hardening sweep on our background worker 
                  to strip tracking metadata, re-orient, sharpen, and ensure the highest print quality output.
                </p>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground">Courier Delivery in India</h4>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Every book order comes with standard courier shipping included, providing tracking details from the 
                  moment your book leaves the print press to when it arrives at your door.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </PublicPage>
  );
}
