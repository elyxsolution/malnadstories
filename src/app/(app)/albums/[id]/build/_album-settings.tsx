'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  X,
  Settings2,
  ImagePlus,
  BookOpen,
  Sparkles,
  Images,
  Lock,
  ArrowRight,
  Check,
  Info,
  Pencil,
  ChevronRight,
} from 'lucide-react';
import { InlineLoader } from '@/components/loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { STUDIO_PRIMARY } from './_ui';
import { updateAlbumDetails } from '@/lib/actions/albums';

type Section = 'general' | 'format' | 'photos' | 'builder';

const SECTIONS: { key: Section; label: string; Icon: typeof Settings2; hint: string }[] = [
  { key: 'general', label: 'General', Icon: BookOpen, hint: 'Name & trip details' },
  { key: 'format', label: 'Format', Icon: Images, hint: 'Type, size & cover' },
  { key: 'photos', label: 'Photos', Icon: ImagePlus, hint: 'Upload & manage' },
  { key: 'builder', label: 'Creation Method', Icon: Sparkles, hint: 'How it’s built' },
];

/**
 * Album Settings — a revisitable "settings" hub for an album already open in the builder.
 *
 * This is NAVIGATION, not a second builder: every destructive capability routes back to the
 * ONE existing surface (the cover rail, the Photos rail, the Build-it-for-me picker) rather than
 * re-implementing it. The only thing edited here directly is the album's General metadata (name +
 * trip details) via the safe `updateAlbumDetails` action. Format's size/pages are READ-ONLY by
 * design (fixed at creation — changing them would invalidate layout/pricing/PDF), so a different
 * format means a new album (confirmed).
 */
export default function AlbumSettings({
  albumId,
  title,
  destination,
  travelDates,
  description,
  productName,
  pageCount,
  coverLabel,
  photoCount,
  lastSavedAt,
  dirty,
  validation,
  onClose,
  onTitleSaved,
  onEditCover,
  onOpenPhotos,
  onOpenBuildMethods,
}: {
  albumId: string;
  title: string;
  destination: string | null;
  travelDates: string | null;
  description: string | null;
  productName: string | null;
  pageCount: number;
  coverLabel: string;
  photoCount: number;
  lastSavedAt: number | null;
  dirty: boolean;
  /** Live central-validation summary (score 0–100 + print readiness). Null = not computed. */
  validation: { score: number; printReady: boolean } | null;
  onClose: () => void;
  /** Reflect a saved title back into the builder (toolbar + cover) without a reload. */
  onTitleSaved: (title: string) => void;
  onEditCover: () => void;
  onOpenPhotos: () => void;
  onOpenBuildMethods: () => void;
}) {
  const [section, setSection] = useState<Section>('general');

  // General (Begin) — local draft; persisted via updateAlbumDetails.
  const [name, setName] = useState(title);
  const [dest, setDest] = useState(destination ?? '');
  const [dates, setDates] = useState(travelDates ?? '');
  const [notes, setNotes] = useState(description ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);
  const [err, setErr] = useState<string | null>(null);

  const [newAlbumConfirm, setNewAlbumConfirm] = useState(false);

  const generalDirty =
    name.trim() !== title.trim() ||
    dest.trim() !== (destination ?? '') ||
    dates.trim() !== (travelDates ?? '') ||
    notes.trim() !== (description ?? '');

  const saveGeneral = async () => {
    if (!name.trim()) {
      setErr('Album name is required.');
      return;
    }
    setSaving(true);
    setErr(null);
    setSaved(false);
    const res = await updateAlbumDetails({
      albumId,
      title: name.trim(),
      destination: dest.trim() || undefined,
      travelDates: dates.trim() || undefined,
      description: notes.trim() || undefined,
    });
    setSaving(false);
    if (res.ok) {
      onTitleSaved(name.trim());
      setSaved(true);
      // Tracked so it can be cancelled on unmount — closing the dialog before the confirmation
      // fades otherwise leaves a timer that sets state on an unmounted component.
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2200);
    } else {
      setErr(res.error);
    }
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[110] flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Album settings"
    >
      <div
        className="animate-scale-in flex h-[min(640px,90vh)] w-full max-w-3xl overflow-hidden rounded-2xl border bg-background shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        {/* LEFT — section nav + summary */}
        <aside className="hidden w-60 flex-none flex-col border-r bg-muted/30 sm:flex">
          <div className="flex items-center gap-2 border-b px-4 py-3.5">
            <Settings2 className="h-4 w-4 text-studio" />
            <span className="font-display text-[15px] font-semibold tracking-tight">Album Settings</span>
          </div>
          {/* Summary — live, with contextual jumps to the relevant section. */}
          <div className="border-b px-4 py-3.5">
            <button
              type="button"
              onClick={() => setSection('general')}
              className="group flex w-full items-baseline justify-between gap-2 text-left"
              title="Edit name"
            >
              <span className="truncate font-display text-sm font-semibold text-foreground">{title || 'Untitled album'}</span>
              <Pencil className="h-3 w-3 flex-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
            {destination && <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{destination}</p>}
            <dl className="mt-2.5 space-y-1 text-[12px] text-muted-foreground">
              <SummaryRow label="Type" value={productName ?? 'Standard'} onJump={() => setSection('format')} />
              <SummaryRow label="Pages" value={`${pageCount}`} onJump={() => setSection('format')} />
              <SummaryRow label="Photos" value={`${photoCount}`} onJump={() => setSection('photos')} />
              <SummaryRow label="Cover" value={coverLabel} onJump={() => setSection('format')} />
              <SummaryRow label="Saved" value={dirty ? 'Unsaved' : relTime(lastSavedAt)} />
            </dl>
            {validation && (
              <div
                className={`mt-2.5 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium ${
                  validation.printReady ? 'bg-studio/[0.1] text-studio' : 'bg-warning/10 text-warning'
                }`}
              >
                {validation.printReady ? <Check className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
                {validation.printReady ? 'Print ready' : 'Needs attention'}
                <span className="ml-auto tabular-nums opacity-80">{validation.score}%</span>
              </div>
            )}
          </div>
          <nav className="flex-1 p-2">
            {SECTIONS.map((s) => {
              const active = section === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSection(s.key)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                    active ? 'bg-studio/[0.1] text-studio' : 'text-foreground hover:bg-secondary'
                  }`}
                >
                  <s.Icon className={`h-4 w-4 flex-none ${active ? 'text-studio' : 'text-muted-foreground'}`} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-tight">{s.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{s.hint}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* RIGHT — section content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b px-5 py-3.5">
            {/* Mobile section switcher */}
            <div className="flex items-center gap-1 sm:hidden">
              {SECTIONS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSection(s.key)}
                  className={`rounded-md px-2 py-1 text-[12px] font-medium ${section === s.key ? 'bg-studio/[0.1] text-studio' : 'text-muted-foreground'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <h2 className="hidden font-display text-base font-semibold tracking-tight sm:block">
              {SECTIONS.find((s) => s.key === section)?.label}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {section === 'general' && (
              <div className="space-y-5">
                <SectionIntro>The name and trip details shown on your cover, dashboard and orders. Safe to change anytime.</SectionIntro>
                <div className="space-y-2">
                  <Label htmlFor="s-name" className="text-[12px] font-medium">Album name</Label>
                  <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Name your story…" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="s-dest" className="text-[12px] font-medium">Destination · optional</Label>
                    <Input id="s-dest" value={dest} onChange={(e) => setDest(e.target.value)} maxLength={120} placeholder="Where did you go?" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="s-dates" className="text-[12px] font-medium">Trip dates · optional</Label>
                    <Input id="s-dates" value={dates} onChange={(e) => setDates(e.target.value)} maxLength={60} placeholder="e.g. Mar 2026" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="s-notes" className="text-[12px] font-medium">A few words · optional</Label>
                  <textarea
                    id="s-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="What made this trip worth keeping?"
                    className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </div>
                {err && <p className="text-[13px] text-destructive">{err}</p>}
                <div className="flex items-center gap-3">
                  <Button onClick={saveGeneral} disabled={saving || !generalDirty} className={STUDIO_PRIMARY} size="sm">
                    {saving ? <InlineLoader /> : saved ? <Check className="h-4 w-4" /> : null}
                    {saved ? 'Saved' : 'Save changes'}
                  </Button>
                  {generalDirty && !saving && !saved && <span className="text-[12px] text-muted-foreground">Unsaved changes</span>}
                </div>
              </div>
            )}

            {section === 'format' && (
              <div className="space-y-5">
                <SectionIntro>Your album’s physical format — set when the album was created.</SectionIntro>
                <dl className="overflow-hidden rounded-xl border">
                  <FormatRow label="Album type" value={productName ?? 'Standard'} fixed />
                  <FormatRow label="Pages" value={`${pageCount} pages`} fixed />
                  <FormatRow label="Cover" value={coverLabel} action={
                    <Button variant="outline" size="sm" onClick={() => { onEditCover(); onClose(); }}>
                      Edit cover <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  } />
                </dl>
                <div className="rounded-xl border border-dashed bg-muted/30 p-4">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                    <Info className="h-4 w-4 text-muted-foreground" /> Need a different size or page count?
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    Album type, size and page count set the printing specifications, so they’re fixed once an album is
                    created. To use a different format, start a new album — this one stays saved in your dashboard.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setNewAlbumConfirm(true)}>
                    Create a new album
                  </Button>
                </div>
              </div>
            )}

            {section === 'photos' && (
              <div className="space-y-5">
                <SectionIntro>Add, remove and organise the photos in your library.</SectionIntro>
                <div className="rounded-xl border bg-card p-5 text-center">
                  <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-studio/[0.08] text-studio ring-1 ring-studio/15">
                    <Images className="h-5 w-5" />
                  </span>
                  <p className="mt-3 font-display text-lg font-semibold tracking-tight">
                    {photoCount} photo{photoCount === 1 ? '' : 's'} in this album
                  </p>
                  <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
                    Upload more, remove, or drag photos onto pages from the Photos panel in the builder — nothing changes
                    about how uploads work.
                  </p>
                  <Button className={`mt-4 ${STUDIO_PRIMARY}`} size="sm" onClick={() => { onOpenPhotos(); onClose(); }}>
                    <ImagePlus /> Open Photos panel
                  </Button>
                </div>
              </div>
            )}

            {section === 'builder' && (
              <div className="space-y-5">
                <SectionIntro>Change how your pages are built. Your photos and cover are always kept.</SectionIntro>
                <div className="rounded-xl border bg-card p-5">
                  <p className="font-display text-base font-semibold tracking-tight">Auto Create or choose a template</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    Re-run automatic layout or pick a template blueprint. You’ll choose whether to fill empty frames or
                    replace the whole layout — so your work is only replaced if you confirm it.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => { onOpenBuildMethods(); onClose(); }}>
                    <Sparkles /> Open build options
                  </Button>
                </div>
                <div className="rounded-xl border bg-card p-5">
                  <p className="font-display text-base font-semibold tracking-tight">Design my own</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    Keep full manual control. You’re already in the builder — just close settings and keep designing.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={onClose}>
                    Back to the builder
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create-new-album confirmation (Format) */}
      {newAlbumConfirm && (
        <div className="animate-fade-in fixed inset-0 z-[120] flex items-center justify-center bg-foreground/50 p-4" onClick={(e) => { e.stopPropagation(); setNewAlbumConfirm(false); }}>
          <div className="animate-scale-in w-full max-w-sm rounded-2xl border bg-background p-6 shadow-elevated" onClick={(e) => e.stopPropagation()}>
            <span className="grid h-10 w-10 place-items-center rounded-full bg-studio/[0.08] text-studio ring-1 ring-studio/15">
              <Lock className="h-5 w-5" />
            </span>
            <h3 className="mt-3 font-display text-lg font-semibold tracking-tight">Start a new album?</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              This album stays exactly as it is, saved in your dashboard. You’ll begin a fresh album where you can pick a
              different type, size and page count.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" size="sm" onClick={() => setNewAlbumConfirm(false)}>Cancel</Button>
              <Button size="sm" className={STUDIO_PRIMARY} render={<Link href="/albums/new" />}>
                New album <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, onJump }: { label: string; value: string; onJump?: () => void }) {
  const inner = (
    <>
      <dt className="truncate">{label}</dt>
      <dd className="flex flex-none items-center gap-1 font-medium text-foreground">
        {value}
        {onJump && <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100" />}
      </dd>
    </>
  );
  if (!onJump) return <div className="flex items-center justify-between gap-2">{inner}</div>;
  return (
    <button type="button" onClick={onJump} className="group/row flex w-full items-center justify-between gap-2 text-left transition-colors hover:text-foreground">
      {inner}
    </button>
  );
}

function SectionIntro({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-muted-foreground">{children}</p>;
}

function FormatRow({ label, value, fixed, action }: { label: string; value: string; fixed?: boolean; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b bg-card px-4 py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-[12px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium text-foreground">{value}</p>
      </div>
      {action ?? (fixed && (
        <span className="inline-flex flex-none items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          <Lock className="h-3 w-3" /> Fixed
        </span>
      ))}
    </div>
  );
}

function relTime(ts: number | null): string {
  if (!ts) return 'Saved';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}
