'use client';

import { useEffect, useMemo, useState } from 'react';
import { MousePointerClick, Ruler, Sparkles, Wand2, X } from 'lucide-react';
import { MalnadLoader, useRotatingMessage, LOADING_MESSAGES } from '@/components/loading';
import Flipbook from '../[id]/build/_flipbook';
import { DimensionsProvider } from '../[id]/build/_dimensions';
import { photoCap } from '@/lib/builder/model';
import type { Photo } from '@/lib/builder/photo';
import ProductGallery from './_product-gallery';
import { getProductPreview, type ProductPreviewResult } from '@/lib/actions/product-preview';


/**
 * Full-screen product preview (Phase B redesign). Renders the product's DEMO ALBUM through the
 * REAL Flipbook (same pipeline as the builder + PDF) beside a product info panel, with a persistent
 * "Start Designing" CTA. Falls back to the gallery lightbox when no demo album exists. No duplicate
 * rendering logic — the Flipbook is the single source of truth for how an album is displayed.
 */
export default function ProductPreview({
  productId,
  onStartDesigning,
  onClose,
}: {
  productId: string;
  onStartDesigning: () => void;
  onClose: () => void;
}) {
  const [result, setResult] = useState<ProductPreviewResult | null>(null);

  useEffect(() => {
    let active = true;
    getProductPreview({ productId }).then((r) => active && setResult(r));
    return () => {
      active = false;
    };
  }, [productId]);

  if (!result) return <Loading onClose={onClose} />;
  if (!result.ok) {
    // Silent fail → just close (the card still selects on click).
    onClose();
    return null;
  }

  const { product, preview } = result;
  const infoPanel = <InfoPanel product={product} onStart={onStartDesigning} />;
  const cta = <StartButton onClick={onStartDesigning} />;

  if (preview.kind === 'flipbook') {
    return <FlipbookPreview preview={preview} infoPanel={infoPanel} cta={cta} onClose={onClose} />;
  }

  if (preview.kind === 'gallery') {
    // Existing lightbox + a persistent Start Designing button (kept above the gallery).
    return (
      <>
        <ProductGallery images={preview.images} title={product.name} onClose={onClose} />
        <div className="pointer-events-none fixed bottom-6 left-0 z-[110] flex w-full justify-center">
          <div className="pointer-events-auto">{cta}</div>
        </div>
      </>
    );
  }

  // Empty → info-only modal with the CTA.
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgb(10_15_12/0.88)] p-4 backdrop-blur-md" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[rgb(16_24_18/0.9)] p-6 text-white" onClick={(e) => e.stopPropagation()}>
        <CloseBtn onClose={onClose} />
        <PanelBody product={product} />
        <div className="mt-6">{cta}</div>
      </div>
    </div>
  );
}

function FlipbookPreview({
  preview,
  infoPanel,
  cta,
  onClose,
}: {
  preview: Extract<ProductPreviewResult & { ok: true }, { ok: true }>['preview'] & { kind: 'flipbook' };
  infoPanel: React.ReactNode;
  cta: React.ReactNode;
  onClose: () => void;
}) {
  const photoMap = useMemo(
    () =>
      new Map<string, Photo>(
        preview.photos.map((p) => [
          p.id,
          { id: p.id, url: p.url, thumbUrl: p.url, filename: '', edit: p.edit, status: 'ready' as const, takenAt: null },
        ]),
      ),
    [preview.photos],
  );
  const stickerUrlFor = useMemo(() => (id: string) => preview.stickerUrls[id], [preview.stickerUrls]);

  return (
    <DimensionsProvider dimensions={preview.dimensions}>
      <Flipbook
        blocks={preview.blocks}
        photoMap={photoMap}
        stickerUrlFor={stickerUrlFor}
        cover={{
          imageUrl: preview.cover.imageUrl,
          backImageUrl: preview.cover.backImageUrl,
          config: preview.cover.config,
          title: preview.cover.title,
          name: preview.title,
          size: preview.size,
        }}
        onClose={onClose}
        infoPanel={infoPanel}
        primaryAction={cta}
      />
      <FirstTimeHint />
    </DimensionsProvider>
  );
}

/**
 * One-time coaching hint the FIRST time any preview is opened — begins on the closed cover, so we
 * nudge the customer to leaf through. Persisted in localStorage so it never repeats.
 */
function FirstTimeHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem('ms_preview_hint_seen')) return;
    } catch {
      /* private mode — just show it */
    }
    setShow(true);
    const dismiss = () => {
      setShow(false);
      try {
        localStorage.setItem('ms_preview_hint_seen', '1');
      } catch {
        /* ignore */
      }
    };
    const t = setTimeout(dismiss, 4500);
    window.addEventListener('keydown', dismiss, { once: true });
    window.addEventListener('pointerdown', dismiss, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('pointerdown', dismiss);
    };
  }, []);

  if (!show) return null;
  return (
    <div className="animate-fade-in pointer-events-none fixed left-1/2 top-24 z-[105] -translate-x-1/2 lg:left-[calc(50%-160px)]">
      <div className="flex items-center gap-2 rounded-full border border-white/15 bg-[rgb(12_18_14/0.85)] px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-md">
        <MousePointerClick className="h-4 w-4" /> Drag to flip pages
        <span className="hidden text-white/50 sm:inline">· or use ← →</span>
      </div>
    </div>
  );
}

// ── Info panel (shared) ───────────────────────────────────────────────────────
type ProductMeta = (ProductPreviewResult & { ok: true })['product'];

function InfoPanel({ product, onStart }: { product: ProductMeta; onStart: () => void }) {
  return (
    <div className="flex h-full flex-col p-6 text-white">
      <PanelBody product={product} />
      <div className="mt-auto pt-6">
        <StartButton onClick={onStart} full />
      </div>
    </div>
  );
}

function PanelBody({ product }: { product: ProductMeta }) {
  const maxPages = product.pageCounts.length ? Math.max(...product.pageCounts) : 0;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">Album</p>
        <h2 className="font-display text-2xl font-semibold tracking-tight">{product.name}</h2>
      </div>
      <p className="inline-flex items-center gap-1.5 text-sm tabular-nums text-white/70">
        <Ruler className="h-4 w-4" /> {product.widthCm} × {product.heightCm} cm
      </p>
      {product.description && <p className="text-sm leading-relaxed text-white/70">{product.description}</p>}

      {/* No price. This lightbox is part of onboarding, which creates an album rather than
          selling one — pricing belongs to checkout. */}
      <dl className="grid grid-cols-2 gap-3 border-y border-white/10 py-4 text-sm">
        <div>
          <dt className="text-white/50">Page counts</dt>
          <dd className="font-semibold tabular-nums">{product.pageCounts.join(' · ') || '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Photo capacity</dt>
          <dd className="font-semibold tabular-nums">{maxPages ? `up to ${photoCap(maxPages)}` : '—'}</dd>
        </div>
      </dl>

      {product.bestFor.length > 0 && (
        <div>
          <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
            <Sparkles className="h-3.5 w-3.5" /> Best for
          </p>
          <div className="flex flex-wrap gap-1.5">
            {product.bestFor.map((tag) => (
              <span key={tag} className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/85">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StartButton({ onClick, full }: { onClick: () => void; full?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[rgb(16_24_18)] shadow-lg transition-transform hover:scale-[1.02] active:scale-95 ${
        full ? 'w-full' : ''
      }`}
    >
      <Wand2 className="h-4 w-4" /> Start Designing
    </button>
  );
}

function CloseBtn({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
      <X className="h-5 w-5" />
    </button>
  );
}

function Loading({ onClose }: { onClose: () => void }) {
  // Rotating, brand sample-preview copy for the (longer) preview build — no fake percentages.
  const label = useRotatingMessage(LOADING_MESSAGES.samplePreview);
  return (
    <div className="mal-overlay fixed inset-0 z-[100] flex items-center justify-center bg-[rgb(10_15_12/0.88)] backdrop-blur-md" onClick={onClose}>
      <MalnadLoader size={128} label={label} className="[&_p]:text-white/80" />
    </div>
  );
}
