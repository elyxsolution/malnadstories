'use client';

import { LayoutTemplate, X } from 'lucide-react';
import { Sprig } from '@/components/brand';
import type { ActiveTemplate } from '@/lib/templates/catalog';
import { categoryLabel, TEMPLATE_CATEGORIES, type TemplateGeometry } from '@/lib/templates/model';

/**
 * Builder Layout panel (Phase 9E) — applies an ACTIVE layout preset to the focused spread.
 * Presets are curated geometry only ({ base, overlays }); applying one produces an ordinary
 * Block via the builder's existing patchBlock, so saveLayout / preview / PDF are unchanged.
 * Placed photos are preserved where possible and never lost.
 */
export default function LayoutPanel({
  templates,
  onApply,
  onClose,
  hasTarget,
}: {
  templates: ActiveTemplate[];
  onApply: (geometry: TemplateGeometry) => void;
  onClose: () => void;
  hasTarget: boolean;
}) {
  const byCat = TEMPLATE_CATEGORIES.map((c) => ({
    category: c,
    items: templates.filter((t) => t.category === c),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-foreground/30 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <aside className="animate-rise fixed inset-y-0 right-0 z-[56] flex w-[380px] max-w-[92vw] flex-col bg-background shadow-elevated">
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/[0.07] text-primary ring-1 ring-primary/15">
              <LayoutTemplate className="h-[18px] w-[18px]" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">Layouts</p>
              <h2 className="font-display text-[1.5rem] font-normal leading-tight text-primary">Pick a layout.</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="border-b bg-secondary/30 px-6 py-3 text-[13px] leading-relaxed text-muted-foreground">
          {hasTarget
            ? 'Applies to the spread you’re viewing. Your placed photos are kept where they fit; the rest return to your tray. Nothing saves until you press Save.'
            : 'Add a spread first, then pick a layout to apply to it.'}
        </p>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {templates.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
              No layouts are available yet.
            </p>
          ) : (
            byCat.map((g) => (
              <div key={g.category}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {categoryLabel(g.category)}
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  {g.items.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onApply(t.geometry)}
                      disabled={!hasTarget}
                      title={t.name}
                      className="group rounded-xl border bg-card p-2 text-left transition-colors hover:border-primary disabled:pointer-events-none disabled:opacity-40"
                    >
                      <MiniPreview geometry={t.geometry} />
                      <p className="mt-1.5 truncate text-[12px] font-medium text-foreground">{t.name}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <p className="flex items-center gap-2 border-t px-6 py-3.5 font-display text-[13px] italic text-muted-foreground">
          <Sprig className="h-3.5 w-3.5 not-italic text-gold" /> Curated layouts — the final say is always yours.
        </p>
      </aside>
    </>
  );
}

/** Tiny geometry preview matching the builder's 3:2 open-pair canvas (base + overlay rects). */
function MiniPreview({ geometry }: { geometry: TemplateGeometry }) {
  const isDouble = geometry.base === 'double-spread';
  return (
    <div className="relative aspect-[3/2] w-full overflow-hidden rounded-md border bg-muted/40">
      {isDouble ? (
        <div className="absolute inset-1 rounded-sm border border-dashed border-foreground/25 bg-background/60" />
      ) : (
        <div className="absolute inset-1 grid grid-cols-2 gap-1">
          <div className="rounded-sm border border-dashed border-foreground/25 bg-background/60" />
          <div className="rounded-sm border border-dashed border-foreground/25 bg-background/60" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/15" />
      {geometry.overlays.map((o, i) => (
        <div
          key={i}
          className="absolute rounded-sm border border-primary/70 bg-primary/10"
          style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%` }}
        />
      ))}
    </div>
  );
}
