import Link from 'next/link';
import { Check, Ruler } from 'lucide-react';
import PublicPage from '@/components/public-page';
import { Button } from '@/components/ui/button';
import { listActiveProducts, type ProductOption } from '@/lib/products/catalog';

export const metadata = { title: 'Pricing — Malnad Stories' };
export const revalidate = 300; // catalog is cached + tag-busted on admin edits

const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

export default async function PricingPage() {
  let products: ProductOption[] = [];
  try {
    products = await listActiveProducts();
  } catch (e) {
    console.warn('Album product catalog unavailable on pricing page.', e);
  }

  return (
    <PublicPage
      eyebrow="Products & Pricing"
      title="Albums made to last"
      intro="Choose a physical album, then the page count. Timeless layflat books, handcrafted with archival paper — shipping included."
      wide
    >
      {products.length === 0 ? (
        <p className="border border-dashed border-border bg-card/40 px-4 py-12 text-center text-sm text-muted-foreground">
          Our albums are being updated. Please check back shortly or contact support.
        </p>
      ) : (
        <div className="space-y-16">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>

          {/* Included in every album */}
          <div className="border border-border bg-card p-6 sm:p-8">
            <h3 className="mb-6 font-display text-xl font-medium tracking-tight text-primary">Included in every Malnad Stories photobook</h3>
            <div className="grid gap-6 sm:grid-cols-2">
              <Feature title="Archival Grade Materials" body="Papers certified to last over 100 years without fading — heavy-weight uncoated stock for a natural, premium matte texture." />
              <Feature title="Hand-Sewn Layflat Binding" body="Double-page panoramic spreads open completely flat, with no image lost in the middle seam." />
              <Feature title="Image Hardening" body="Every photo is auto-processed — metadata stripped, re-oriented, sharpened — for the highest print quality." />
              <Feature title="Courier Delivery in India" body="Standard tracked courier shipping is included on every book, from press to your door." />
            </div>
          </div>
        </div>
      )}
    </PublicPage>
  );
}

function ProductCard({ product: p }: { product: ProductOption }) {
  const featured = p.isDefault;
  return (
    <div
      className={`flex flex-col overflow-hidden border transition-all duration-300 ${
        featured ? 'border-transparent bg-primary text-primary-foreground shadow-elevated' : 'border-border bg-card text-foreground shadow-xs hover:-translate-y-0.5 hover:shadow-card'
      }`}
    >
      {/* Cover preview */}
      {p.coverPreviewUrl && (
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.coverPreviewUrl} alt={p.name} className="h-full w-full object-cover" />
          {featured && (
            <span className="absolute left-3 top-3 rounded-full bg-gold px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary shadow-sm">
              Most popular
            </span>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col p-6">
        <h3 className={`font-display text-2xl font-semibold leading-tight ${featured ? 'text-primary-foreground' : 'text-primary'}`}>{p.name}</h3>
        <p className={`mt-1 inline-flex items-center gap-1.5 text-xs tabular-nums ${featured ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
          <Ruler className="h-3.5 w-3.5" /> {p.widthCm} × {p.heightCm} cm · Layflat binding
        </p>

        {p.description && <p className={`mt-3 text-sm leading-relaxed ${featured ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{p.description}</p>}

        <div className="my-6">
          <span className={`text-xs ${featured ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>From </span>
          <span className="font-display text-4xl font-normal tracking-tight tabular-nums">{p.startingPrice != null ? inr(p.startingPrice) : '—'}</span>
          <span className={`ml-1 text-xs ${featured ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>all taxes incl.</span>
        </div>

        {/* Supported page counts */}
        <div className="mb-6">
          <p className={`mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] ${featured ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>Available page counts</p>
          <div className="flex flex-wrap gap-1.5">
            {p.pageCounts.map((pc) => (
              <span
                key={pc}
                className={`rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${featured ? 'bg-primary-foreground/15 text-primary-foreground' : 'border border-border text-foreground'}`}
              >
                {pc} pages
              </span>
            ))}
          </div>
        </div>

        <ul className="mb-8 flex-1 space-y-3 text-sm">
          <Bullet featured={featured}>Layflat linen hardcover binding</Bullet>
          <Bullet featured={featured}>Archival uncoated warm-white paper</Bullet>
          <Bullet featured={featured}>Interactive preview before you design</Bullet>
        </ul>

        <Button render={<Link href="/signup" />} variant={featured ? 'secondary' : 'default'} className="h-10 w-full font-semibold">
          Create this album
        </Button>
      </div>
    </div>
  );
}

function Bullet({ featured, children }: { featured: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <Check className={`mt-0.5 h-4 w-4 shrink-0 ${featured ? 'text-gold' : 'text-primary'}`} />
      <span>{children}</span>
    </li>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
