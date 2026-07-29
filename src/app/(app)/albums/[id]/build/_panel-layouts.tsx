'use client';

import { Plus, Square, BookOpen, Star, History, Sparkles, Copy } from 'lucide-react';
import { LAYOUT_PRESETS, type LayoutPreset } from '@/lib/builder/elements';
import { LAYOUT_TEMPLATES, type LayoutTemplate } from '@/lib/builder/model';
import type { LayoutMemoryApi } from './_layout-memory';
import type { LayoutSuggestion } from './_layout-suggestions';

const ADD_LABEL: Record<LayoutTemplate, { label: string; Icon: typeof Square }> = {
  'single-pair': { label: 'Single page', Icon: Square },
  'double-spread': { label: 'Double page', Icon: BookOpen },
};

/** A tiny 3:2 schematic of a preset's geometry (base halves + overlay cells). */
function PresetPreview({ preset }: { preset: LayoutPreset }) {
  const isDouble = preset.base === 'double-spread';
  return (
    <div className="relative aspect-[3/2] w-full overflow-hidden rounded-md bg-secondary ring-1 ring-border">
      {isDouble ? (
        <div className="absolute inset-1 rounded-sm bg-studio/15" />
      ) : (
        <>
          <div className="absolute inset-y-1 left-1 right-1/2 mr-0.5 rounded-sm bg-studio/12" />
          <div className="absolute inset-y-1 left-1/2 right-1 ml-0.5 rounded-sm bg-studio/12" />
        </>
      )}
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
      {preset.overlays.map((o, i) => (
        <div
          key={i}
          className="absolute rounded-[2px] bg-studio/70 ring-1 ring-white/60"
          style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%` }}
        />
      ))}
    </div>
  );
}

/**
 * One preset tile. The star is a real toggle sitting inside a button, so it is rendered as a
 * sibling rather than a nested `<button>` (which is invalid HTML and breaks keyboard order) —
 * the tile is the click target, the star is absolutely positioned above it.
 */
function PresetTile({
  preset,
  disabled,
  starred,
  uses,
  onApply,
  onStar,
}: {
  preset: LayoutPreset;
  disabled: boolean;
  starred: boolean;
  uses: number;
  onApply: () => void;
  onStar: () => void;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        disabled={disabled}
        onClick={onApply}
        title={preset.hint}
        className="w-full rounded-xl border border-border bg-card p-2 text-left shadow-xs transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:border-studio-bright/50 hover:shadow-card active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40"
      >
        <PresetPreview preset={preset} />
        <span className="mt-1.5 flex items-baseline gap-1">
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium tracking-tight text-foreground">
            {preset.label}
          </span>
          {uses > 1 && <span className="flex-none text-[10px] tabular-nums text-muted-foreground/70">{uses}×</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={onStar}
        aria-label={starred ? `Remove ${preset.label} from favourites` : `Add ${preset.label} to favourites`}
        aria-pressed={starred}
        className={`absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md bg-background/85 shadow-sm ring-1 ring-border/70 backdrop-blur-sm transition-all duration-150 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright ${
          starred
            ? 'text-warning opacity-100'
            : 'text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100'
        }`}
      >
        <Star className={`h-3 w-3 ${starred ? 'fill-current' : ''}`} />
      </button>
    </div>
  );
}

function SectionTitle({ icon, children, note }: { icon: React.ReactNode; children: React.ReactNode; note?: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-1.5">
      <span className="text-muted-foreground [&_svg]:h-3 [&_svg]:w-3">{icon}</span>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{children}</p>
      {note && <span className="ml-auto text-[10.5px] text-muted-foreground/70">{note}</span>}
    </div>
  );
}

export default function LayoutsPanel({
  hasTarget,
  canAddTemplate,
  onAddBlock,
  onApplyPreset,
  memory,
  suggestions,
}: {
  hasTarget: boolean;
  canAddTemplate: (t: LayoutTemplate) => boolean;
  onAddBlock: (t: LayoutTemplate) => void;
  onApplyPreset: (preset: LayoutPreset) => void;
  /** Favourites + recency, remembered on this device across albums. */
  memory: LayoutMemoryApi;
  /** Metadata-driven recommendations for the photos currently in play. Never auto-applied. */
  suggestions: LayoutSuggestion[];
}) {
  const byKey = (k: string) => LAYOUT_PRESETS.find((p) => p.key === k);
  const favourites = memory.favourites.map(byKey).filter((p): p is LayoutPreset => !!p);
  const recent = memory.recent.map(byKey).filter((p): p is LayoutPreset => !!p);
  const duplicated = memory.recentlyDuplicated.map(byKey).filter((p): p is LayoutPreset => !!p);
  // "Frequent" only earns its own row when it says something the recent row doesn't.
  const frequent = memory.frequent
    .filter((k) => !memory.recent.slice(0, 3).includes(k))
    .map(byKey)
    .filter((p): p is LayoutPreset => !!p);

  const tile = (preset: LayoutPreset) => (
    <PresetTile
      key={preset.key}
      preset={preset}
      disabled={!hasTarget}
      starred={memory.isFavourite(preset.key)}
      uses={memory.usesOf(preset.key)}
      onApply={() => onApplyPreset(preset)}
      onStar={() => memory.toggleFavourite(preset.key)}
    />
  );

  return (
    <div className="ms-scroll flex-1 space-y-6 overflow-y-auto p-4">
      {/* "Build it for me" lives in the top toolbar as the single Build entry point — this panel is
          for hand-assembling spreads (add a spread + apply a layout). */}
      <section>
        <SectionTitle icon={<Plus />}>Add a spread</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {LAYOUT_TEMPLATES.map((t) => {
            const { label, Icon } = ADD_LABEL[t];
            const disabled = !canAddTemplate(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => onAddBlock(t)}
                disabled={disabled}
                className="group flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-3 text-left shadow-xs transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:border-studio-bright/50 hover:shadow-card active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40"
              >
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-studio/10 text-studio">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-[13px] font-medium leading-tight text-foreground">{label}</span>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Plus className="h-3 w-3" /> 2 pages
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/*
        SUGGESTIONS. Derived from the shapes of the photos actually waiting to be placed —
        no model, no service. Each one states its reasoning, because a recommendation you can't
        audit is just a mystery. Clicking applies it through the ordinary preset path.
      */}
      {hasTarget && suggestions.length > 0 && (
        <section>
          <SectionTitle icon={<Sparkles />} note="from your photos">
            Suggested for these photos
          </SectionTitle>
          <div className="space-y-1.5">
            {suggestions.map((s) => (
              <button
                key={s.preset.key}
                type="button"
                onClick={() => onApplyPreset(s.preset)}
                className="group flex w-full items-center gap-2.5 rounded-xl border border-border bg-card p-2 text-left shadow-xs transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:border-studio-bright/50 hover:shadow-card active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
              >
                <span className="w-[68px] flex-none">
                  <PresetPreview preset={s.preset} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium tracking-tight text-foreground">{s.preset.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{s.why}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {favourites.length > 0 && (
        <section>
          <SectionTitle icon={<Star />}>Your favourites</SectionTitle>
          <div className="grid grid-cols-2 gap-2.5">{favourites.map(tile)}</div>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <SectionTitle icon={<History />} note="on this device">
            Recently used
          </SectionTitle>
          <div className="grid grid-cols-2 gap-2.5">{recent.map(tile)}</div>
        </section>
      )}

      {frequent.length > 0 && (
        <section>
          <SectionTitle icon={<History />}>You use these most</SectionTitle>
          <div className="grid grid-cols-2 gap-2.5">{frequent.map(tile)}</div>
        </section>
      )}

      {duplicated.length > 0 && (
        <section>
          <SectionTitle icon={<Copy />}>Recently duplicated</SectionTitle>
          <div className="grid grid-cols-2 gap-2.5">{duplicated.map(tile)}</div>
        </section>
      )}

      <section>
        <SectionTitle icon={<Square />}>All layouts</SectionTitle>
        <p className="-mt-1 mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {hasTarget
            ? 'Applies to the spread you’re editing. Photos that don’t fit return to your tray.'
            : 'Add a spread first, then apply a layout.'}
        </p>
        <div className="grid grid-cols-2 gap-2.5">{LAYOUT_PRESETS.map(tile)}</div>
      </section>
    </div>
  );
}
