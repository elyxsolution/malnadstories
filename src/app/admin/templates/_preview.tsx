import type { TemplateGeometry } from '@/lib/templates/model';

/**
 * Read-only geometry preview — a 3:2 open-pair box matching the builder's canvas. Shows the
 * base split (single-pair = two halves, double-spread = one span) + the overlay slot rects.
 * Pure presentation (no photos, no hooks) so it renders in both the server list and the
 * client editor. This is the SAME geometry the builder consumes — what you see is what prints.
 */
export default function TemplatePreview({ geometry, className = '' }: { geometry: TemplateGeometry; className?: string }) {
  const isDouble = geometry.base === 'double-spread';
  return (
    <div className={`relative aspect-[3/2] w-full overflow-hidden rounded-md border bg-muted/40 ${className}`}>
      {/* Base slots */}
      {isDouble ? (
        <div className="absolute inset-1 grid place-items-center rounded-sm border border-dashed border-foreground/25 bg-background/60 text-[10px] text-muted-foreground">
          Spread image
        </div>
      ) : (
        <div className="absolute inset-1 grid grid-cols-2 gap-1">
          <div className="grid place-items-center rounded-sm border border-dashed border-foreground/25 bg-background/60 text-[10px] text-muted-foreground">
            Left
          </div>
          <div className="grid place-items-center rounded-sm border border-dashed border-foreground/25 bg-background/60 text-[10px] text-muted-foreground">
            Right
          </div>
        </div>
      )}

      {/* Centre gutter */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/15" />

      {/* Overlay slots */}
      {geometry.overlays.map((o, i) => (
        <div
          key={i}
          className="absolute grid place-items-center rounded-sm border-2 border-primary/70 bg-primary/10 text-[9px] font-medium text-primary"
          style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%` }}
        >
          {i + 1}
        </div>
      ))}
    </div>
  );
}
