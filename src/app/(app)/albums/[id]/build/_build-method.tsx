'use client';

import { Dices, LayoutTemplate, Sparkles, X, ImagePlus, Wand2, Shuffle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { STUDIO_PRIMARY } from './_ui';
import type { Blueprint } from '@/lib/builder/blueprint';
import type { CoverConfig } from '@/lib/builder/cover';

/** A matching active blueprint, with its config for client-side apply inside the builder. */
export type BuilderBlueprint = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  pageCount: number;
  slotCount: number;
  recommendedPhotos: number;
  featured: boolean;
  popular: boolean;
  pinned: boolean;
  isDefault: boolean;
  isNew: boolean;
  breakdown: { label: string; count: number }[];
  /** The design's own front cover (Phase 0) — how a blueprint is presented. */
  cover: CoverConfig | null;
  thumbUrl: string | null;
  blueprint: Blueprint;
};

/**
 * Builder "Build it for me" — the SAME three-option Blueprint workflow as the creation wizard (Full
 * Auto · Choose Blueprint · Custom). Presentational: it calls back into the builder, which applies
 * via the existing engine/apply path (api.replaceAll).
 */
export default function BuildMethod({
  albumSize,
  uploaded,
  unprocessed = 0,
  defaultTarget,
  blueprintCount,
  onFullAuto,
  onChoose,
  onFillEmpty,
  onReplaceAll,
  onRandomize,
  onUploadMore,
  onClose,
}: {
  albumSize: number;
  uploaded: number;
  /**
   * Photos still uploading/processing. Auto-layout groups photos by ORIENTATION, which comes
   * from the worker's sanitized master — so these can't take part yet and the dialog says so
   * rather than quietly leaving them out.
   */
  unprocessed?: number;
  defaultTarget: BuilderBlueprint | null;
  blueprintCount: number;
  onFullAuto: () => void;
  onChoose: () => void;
  onFillEmpty: () => void;
  onReplaceAll: () => void;
  onRandomize: () => void;
  onUploadMore: () => void;
  onClose: () => void;
}) {
  const capacity = defaultTarget?.slotCount ?? 0;
  const placed = defaultTarget ? Math.min(uploaded, capacity) : uploaded;
  const remaining = defaultTarget ? Math.max(0, capacity - uploaded) : 0;
  const unused = defaultTarget ? Math.max(0, uploaded - capacity) : 0;
  const insufficient = !!defaultTarget && uploaded < capacity;

  return (
    <div className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div className="animate-rise flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-background shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Build your album</p>
            <h2 className="font-display text-[1.4rem] font-semibold tracking-tight">How would you like to build?</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </header>

        {unprocessed > 0 && (
          <p className="border-b bg-secondary/40 px-6 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              {unprocessed} photo{unprocessed === 1 ? '' : 's'} still processing.
            </span>{' '}
            Automatic layouts arrange photos by shape, which we only know once processing finishes — so
            these won’t be placed yet. You can still add them to pages yourself, or build again later.
          </p>
        )}

        <div className="ms-scroll grid gap-4 overflow-y-auto p-6 md:grid-cols-3">
          {/* 1 · FULL AUTO */}
          <Card emoji="🎲" Icon={Dices} title="Full Auto" primary>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {defaultTarget
                ? `We’ll build your album from the “${defaultTarget.name}” blueprint and place your photos.`
                : 'We’ll arrange all your photos into a complete album automatically.'}
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-1.5 text-center">
              {[
                { k: 'Size', v: `${albumSize}` },
                { k: 'Capacity', v: defaultTarget ? `${capacity}` : '—' },
                { k: 'Uploaded', v: `${uploaded}` },
                { k: 'Placed', v: `${placed}` },
                { k: 'Empty', v: defaultTarget ? `${remaining}` : '—' },
                { k: 'Unused', v: `${unused}` },
              ].map((s) => (
                <div key={s.k} className="rounded-md bg-secondary/50 py-1.5">
                  <div className="text-[13px] font-semibold tabular-nums">{s.v}</div>
                  <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{s.k}</div>
                </div>
              ))}
            </dl>
            {insufficient ? (
              <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5">
                <p className="text-[12px] font-medium text-amber-700">Need {remaining} more photo{remaining === 1 ? '' : 's'} to fill every frame.</p>
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={onUploadMore} className="flex-1"><ImagePlus /> Upload more</Button>
                  <Button size="sm" onClick={onFullAuto} className={`flex-1 ${STUDIO_PRIMARY}`}>Generate anyway</Button>
                </div>
              </div>
            ) : (
              <Button onClick={onFullAuto} className={`mt-3 w-full ${STUDIO_PRIMARY}`}>
                <Wand2 /> Generate album
              </Button>
            )}
          </Card>

          {/* 2 · CHOOSE BLUEPRINT */}
          <Card emoji="📚" Icon={LayoutTemplate} title="Choose a Blueprint">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Browse designed album blueprints for {albumSize} pages, then place your photos into the one you like.
            </p>
            <div className="mt-3 rounded-lg bg-secondary/50 px-3 py-2 text-center">
              <div className="text-lg font-semibold tabular-nums">{blueprintCount}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Templates</div>
            </div>
            <Button variant="outline" onClick={onChoose} disabled={blueprintCount === 0} className="mt-3 w-full">
              {blueprintCount === 0 ? 'No templates for this size' : (<><LayoutTemplate /> Browse templates</>)}
            </Button>
          </Card>

          {/* 3 · CUSTOM */}
          <Card emoji="✨" Icon={Sparkles} title="Custom">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Keep designing your own layout. Fill photos your way — preview before anything changes.
            </p>
            <div className="mt-3 space-y-1.5">
              <Button variant="outline" onClick={onFillEmpty} className="w-full justify-start"><ImagePlus /> Fill empty frames</Button>
              <Button variant="outline" onClick={onReplaceAll} className="w-full justify-start"><Wand2 /> Replace all (auto-arrange)</Button>
              <Button variant="outline" onClick={onRandomize} className="w-full justify-start"><Shuffle /> Randomize again</Button>
            </div>
            <button type="button" onClick={onClose} className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-studio hover:underline">
              Keep designing manually <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ emoji, Icon, title, primary = false, children }: { emoji: string; Icon: typeof Dices; title: string; primary?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col rounded-2xl border p-4 ${primary ? 'border-studio/30 bg-studio-soft/40 ring-1 ring-studio/10' : 'bg-card'}`}>
      <div className="mb-2 flex items-center gap-2.5">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-studio/[0.08] text-lg ring-1 ring-studio/15" aria-hidden>{emoji}</span>
        <div className="flex items-center gap-1.5">
          <Icon className="h-4 w-4 text-studio" />
          <h3 className="font-display text-[17px] font-semibold tracking-tight">{title}</h3>
        </div>
      </div>
      {children}
    </div>
  );
}
