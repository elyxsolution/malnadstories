'use client';

import { Plus, Square, BookOpen } from 'lucide-react';
import { LAYOUT_PRESETS, type LayoutPreset } from '@/lib/builder/elements';
import { LAYOUT_TEMPLATES, type LayoutTemplate } from '@/lib/builder/model';

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

export default function LayoutsPanel({
  hasTarget,
  canAddTemplate,
  onAddBlock,
  onApplyPreset,
}: {
  hasTarget: boolean;
  canAddTemplate: (t: LayoutTemplate) => boolean;
  onAddBlock: (t: LayoutTemplate) => void;
  onApplyPreset: (preset: LayoutPreset) => void;
}) {
  return (
    <div className="ms-scroll flex-1 space-y-6 overflow-y-auto p-4">
      {/* "Build it for me" lives in the top toolbar as the single Build entry point — this panel is
          for hand-assembling spreads (add a spread + apply a layout). */}
      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Add a spread</p>
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
                className="group flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-3 text-left shadow-xs transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:border-studio-bright/50 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40"
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

      <section>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Apply a layout</p>
        <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {hasTarget
            ? 'Applies to the spread you’re editing. Photos that don’t fit return to your tray.'
            : 'Add a spread first, then apply a layout.'}
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {LAYOUT_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              disabled={!hasTarget}
              onClick={() => onApplyPreset(preset)}
              title={preset.hint}
              className="group rounded-xl border border-border bg-card p-2 text-left shadow-xs transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:border-studio-bright/50 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40"
            >
              <PresetPreview preset={preset} />
              <span className="mt-1.5 block truncate text-[12px] font-medium tracking-tight text-foreground">{preset.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
