'use client';

import { useMemo, useState } from 'react';
import { InlineLoader } from '@/components/loading';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Save, ArrowLeft, Type as TypeIcon, Sticker as StickerIcon, Palette, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import CoverCanvas, { COVER_NO_SELECTION, type CoverSelection, type CoverSide } from '@/app/(app)/albums/[id]/build/_cover-canvas';
import CoverPanel from '@/app/(app)/albums/[id]/build/_panel-cover';
import TextPanel from '@/app/(app)/albums/[id]/build/_panel-text';
import StickersPanel from '@/app/(app)/albums/[id]/build/_panel-stickers';
import BackgroundsPanel from '@/app/(app)/albums/[id]/build/_panel-backgrounds';
import QrPanel from '@/app/(app)/albums/[id]/build/_panel-qr';
import { TextInspector, StickerInspector, QrInspector, SpineInspector } from '@/app/(app)/albums/[id]/build/_element-inspectors';
import type { Photo } from '@/lib/builder/photo';
import { makeText, makeQr, makeSticker } from '@/lib/builder/elements';
import { cryptoId, type Background, type QrElement, type StickerElement, type TextElement, type TextVariant } from '@/lib/builder/model';
import { normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';
import type { StickerCategory } from '@/lib/stickers';
import {
  COVER_TEMPLATE_CATEGORIES,
  coverCategoryLabel,
  type CoverTemplateCategory,
} from '@/lib/cover-templates/model';
import { saveCoverTemplate } from '@/lib/actions/admin/cover-templates';

/**
 * Admin cover-template DESIGNER. Reuses the EXACT customer cover editor components — `CoverCanvas`
 * (interactive spread), `CoverPanel` (image/title/typography), the add-element panels, and the
 * element inspectors — so this is NOT a second editor: it is the same editor, driving a local
 * CoverConfig that is saved as a template (0040). A template carries no album photos, so the
 * photo/artwork sources are empty here; admins compose with backgrounds + text + stickers + QR.
 * The element-op handlers mirror _builder.tsx's cover handlers verbatim (over local state).
 */
type RailTab = 'cover' | 'text' | 'stickers' | 'backgrounds' | 'qr';
const RAIL: { key: RailTab; label: string; Icon: typeof TypeIcon }[] = [
  { key: 'cover', label: 'Cover', Icon: Palette },
  { key: 'text', label: 'Text', Icon: TypeIcon },
  { key: 'stickers', label: 'Stickers', Icon: StickerIcon },
  { key: 'backgrounds', label: 'Background', Icon: Palette },
  { key: 'qr', label: 'QR', Icon: QrCode },
];

const nudge = <T extends { x: number; y: number }>(el: T): T => ({ ...el, x: Math.min(1, el.x + 0.03), y: Math.min(1, el.y + 0.03) });
const reorderArr = <T extends { id: string }>(arr: T[], id: string, dir: -1 | 1): T[] | null => {
  const next = [...arr];
  const i = next.findIndex((e) => e.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= next.length) return null;
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

export default function CoverTemplateDesigner({
  initial,
  stickerCatalog,
}: {
  initial: {
    id: string | null;
    name: string;
    category: CoverTemplateCategory;
    featured: boolean;
    popular: boolean;
    pinned: boolean;
    config: CoverConfig;
  };
  stickerCatalog: StickerCategory[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<CoverTemplateCategory>(initial.category);
  const [featured, setFeatured] = useState(initial.featured);
  const [popular, setPopular] = useState(initial.popular);
  const [pinned, setPinned] = useState(initial.pinned);
  const [config, setConfig] = useState<CoverConfig>(() => normalizeCoverConfig(initial.config));
  const [sampleTitle, setSampleTitle] = useState('Your Title');
  const [selection, setSelection] = useState<CoverSelection>(COVER_NO_SELECTION);
  const [activeSide, setActiveSide] = useState<CoverSide>('front');
  const [railTab, setRailTab] = useState<RailTab>('cover');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sticker id → presigned url, from the active catalog (for canvas + preview rendering).
  const stickerUrl = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of stickerCatalog) for (const s of c.stickers) m.set(s.id, s.url);
    return m;
  }, [stickerCatalog]);
  const stickerUrlFor = (id: string) => stickerUrl.get(id);

  // Templates carry no customer photos — the photo/artwork sources are intentionally empty.
  const photos: Photo[] = [];
  const photoMap = useMemo(() => new Map<string, Photo>(), []);

  // ── local cover mutation (no persistence until Save) ─────────────────────────
  const updateCover = (patch: { title?: string; config?: Partial<CoverConfig> }) => {
    if (patch.title !== undefined) setSampleTitle(patch.title); // title is per-album; preview only here
    if (patch.config) setConfig((c) => ({ ...c, ...patch.config }));
  };

  type SideArrays = { texts: TextElement[]; stickers: StickerElement[]; qrs: QrElement[] };
  const sideArrays = (side: CoverSide): SideArrays =>
    side === 'front'
      ? { texts: config.texts, stickers: config.stickers, qrs: config.qrs }
      : { texts: config.back.texts, stickers: config.back.stickers, qrs: config.back.qrs };
  const writeSide = (side: CoverSide, patch: Partial<SideArrays>) =>
    side === 'front'
      ? setConfig((c) => ({ ...c, ...patch }))
      : setConfig((c) => ({ ...c, back: { ...c.back, ...patch } }));

  // Text
  const addCoverText = (variant: TextVariant) => {
    const el = makeText(variant);
    writeSide(activeSide, { texts: [...sideArrays(activeSide).texts, el] });
    setSelection({ kind: 'text', side: activeSide, id: el.id });
  };
  const patchCoverText = (side: CoverSide, id: string, patch: Partial<TextElement>) =>
    writeSide(side, { texts: sideArrays(side).texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const removeCoverText = (side: CoverSide, id: string) =>
    writeSide(side, { texts: sideArrays(side).texts.filter((t) => t.id !== id) });
  const duplicateCoverText = (side: CoverSide, id: string) => {
    const src = sideArrays(side).texts.find((t) => t.id === id);
    if (!src) return;
    const clone = nudge<TextElement>({ ...src, id: cryptoId() });
    writeSide(side, { texts: [...sideArrays(side).texts, clone] });
    setSelection({ kind: 'text', side, id: clone.id });
  };
  const reorderCoverText = (side: CoverSide, id: string, dir: -1 | 1) => {
    const next = reorderArr(sideArrays(side).texts, id, dir);
    if (next) writeSide(side, { texts: next });
  };

  // Stickers (3:4 cover → square default)
  const addCoverSticker = (stickerId: string) => {
    const el = makeSticker(stickerId, 3 / 4);
    writeSide(activeSide, { stickers: [...sideArrays(activeSide).stickers, el] });
    setSelection({ kind: 'sticker', side: activeSide, id: el.id });
  };
  const patchCoverSticker = (side: CoverSide, id: string, patch: Partial<StickerElement>) =>
    writeSide(side, { stickers: sideArrays(side).stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const removeCoverSticker = (side: CoverSide, id: string) =>
    writeSide(side, { stickers: sideArrays(side).stickers.filter((s) => s.id !== id) });
  const duplicateCoverSticker = (side: CoverSide, id: string) => {
    const src = sideArrays(side).stickers.find((s) => s.id === id);
    if (!src) return;
    const clone = nudge<StickerElement>({ ...src, id: cryptoId() });
    writeSide(side, { stickers: [...sideArrays(side).stickers, clone] });
    setSelection({ kind: 'sticker', side, id: clone.id });
  };
  const reorderCoverSticker = (side: CoverSide, id: string, dir: -1 | 1) => {
    const next = reorderArr(sideArrays(side).stickers, id, dir);
    if (next) writeSide(side, { stickers: next });
  };

  // QR (square on the 3:4 cover page)
  const addCoverQr = (data: string) => {
    const el = makeQr(data, { h: Math.min(1, 0.14 * (3 / 4)) });
    writeSide(activeSide, { qrs: [...sideArrays(activeSide).qrs, el] });
    setSelection({ kind: 'qr', side: activeSide, id: el.id });
  };
  const patchCoverQr = (side: CoverSide, id: string, patch: Partial<QrElement>) =>
    writeSide(side, { qrs: sideArrays(side).qrs.map((q) => (q.id === id ? { ...q, ...patch } : q)) });
  const removeCoverQr = (side: CoverSide, id: string) =>
    writeSide(side, { qrs: sideArrays(side).qrs.filter((q) => q.id !== id) });
  const duplicateCoverQr = (side: CoverSide, id: string) => {
    const src = sideArrays(side).qrs.find((q) => q.id === id);
    if (!src) return;
    const clone = nudge<QrElement>({ ...src, id: cryptoId() });
    writeSide(side, { qrs: [...sideArrays(side).qrs, clone] });
    setSelection({ kind: 'qr', side, id: clone.id });
  };
  const reorderCoverQr = (side: CoverSide, id: string, dir: -1 | 1) => {
    const next = reorderArr(sideArrays(side).qrs, id, dir);
    if (next) writeSide(side, { qrs: next });
  };

  const applyCoverBackground = (side: CoverSide, bg: Background | null) =>
    side === 'front'
      ? setConfig((c) => (bg ? { ...c, background: bg, photoId: null } : { ...c, background: null }))
      : setConfig((c) => ({ ...c, back: { ...c.back, background: bg, photoId: bg ? null : c.back.photoId } }));

  // Selected element (for the inspector).
  const selSide: CoverSide | null =
    selection.kind === 'text' || selection.kind === 'sticker' || selection.kind === 'qr' ? selection.side : null;
  const selText = selection.kind === 'text' ? sideArrays(selection.side).texts.find((t) => t.id === selection.id) ?? null : null;
  const selSticker = selection.kind === 'sticker' ? sideArrays(selection.side).stickers.find((s) => s.id === selection.id) ?? null : null;
  const selQr = selection.kind === 'qr' ? sideArrays(selection.side).qrs.find((q) => q.id === selection.id) ?? null : null;

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError('Give the template a name.');
    setSaving(true);
    const res = await saveCoverTemplate({
      id: initial.id ?? undefined,
      name: name.trim(),
      category,
      featured,
      popular,
      pinned,
      config,
    });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    if (!initial.id) router.replace(`/admin/cover-templates/${res.id}`);
    else router.refresh();
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-2.5">
        <Link href="/admin/cover-templates" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Templates
        </Link>
        <div className="mx-1 h-5 w-px bg-border" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" maxLength={120} className="h-9 w-56" />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as CoverTemplateCategory)}
          className="h-9 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {COVER_TEMPLATE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {coverCategoryLabel(c)}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} /> Featured
        </label>
        <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={popular} onChange={(e) => setPopular(e.target.checked)} /> Popular
        </label>
        <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pinned
        </label>
        <div className="ml-auto flex items-center gap-3">
          {error && <span className="text-sm text-destructive">{error}</span>}
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <InlineLoader /> : <Save />} Save template
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left rail — add-element panels (reused verbatim) */}
        <aside className="flex w-72 flex-none flex-col border-r bg-card">
          <div className="flex gap-1 border-b p-2">
            {RAIL.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setRailTab(t.key)}
                className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors ${
                  railTab === t.key ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'
                }`}
              >
                <t.Icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </div>
          <div className="ms-scroll min-h-0 flex-1 overflow-y-auto p-3">
            {railTab === 'cover' && (
              <CoverPanel
                title={sampleTitle}
                coverId={null}
                config={config}
                covers={[]}
                photos={photos}
                photoMap={photoMap}
                activeSide={activeSide}
                onActiveSide={setActiveSide}
                onUpdate={updateCover}
                onEditImage={() => {}}
                showPreview={false}
              />
            )}
            {railTab === 'text' && <TextPanel hasTarget onAdd={addCoverText} />}
            {railTab === 'stickers' && <StickersPanel catalog={stickerCatalog} hasTarget onAdd={addCoverSticker} />}
            {railTab === 'backgrounds' && (
              <BackgroundsPanel
                current={activeSide === 'front' ? config.background : config.back.background}
                hasTarget
                onApply={(bg) => applyCoverBackground(activeSide, bg)}
                onApplyAll={(bg) => applyCoverBackground(activeSide, bg)}
              />
            )}
            {railTab === 'qr' && <QrPanel hasTarget onAdd={addCoverQr} />}
          </div>
        </aside>

        {/* Center — the SAME interactive cover spread customers use */}
        <main className="min-w-0 flex-1 bg-muted/30">
          <CoverCanvas
            title={sampleTitle}
            config={config}
            frontImageUrl={null}
            backImageUrl={null}
            size={36}
            stickerUrlFor={stickerUrlFor}
            selection={selection}
            onSelect={setSelection}
            activeSide={activeSide}
            onActiveSide={setActiveSide}
            onChangeText={patchCoverText}
            onReorderText={reorderCoverText}
            onDeleteText={removeCoverText}
            onDuplicateText={duplicateCoverText}
            onChangeSticker={patchCoverSticker}
            onReorderSticker={reorderCoverSticker}
            onDeleteSticker={removeCoverSticker}
            onDuplicateSticker={duplicateCoverSticker}
            onChangeQr={patchCoverQr}
            onReorderQr={reorderCoverQr}
            onDeleteQr={removeCoverQr}
            onDuplicateQr={duplicateCoverQr}
          />
        </main>

        {/* Right — element inspector (else the spine editor / hint) */}
        <aside className="ms-scroll w-72 flex-none overflow-y-auto border-l bg-card">
          {selText && selSide ? (
            <TextInspector
              el={selText}
              onChange={(patch) => patchCoverText(selSide, selText.id, patch)}
              onDelete={() => {
                removeCoverText(selSide, selText.id);
                setSelection(COVER_NO_SELECTION);
              }}
            />
          ) : selSticker && selSide ? (
            <StickerInspector
              el={selSticker}
              onChange={(patch) => patchCoverSticker(selSide, selSticker.id, patch)}
              onDelete={() => {
                removeCoverSticker(selSide, selSticker.id);
                setSelection(COVER_NO_SELECTION);
              }}
              onDuplicate={() => duplicateCoverSticker(selSide, selSticker.id)}
              onForward={() => reorderCoverSticker(selSide, selSticker.id, 1)}
              onBackward={() => reorderCoverSticker(selSide, selSticker.id, -1)}
            />
          ) : selQr && selSide ? (
            <QrInspector
              el={selQr}
              onChange={(patch) => patchCoverQr(selSide, selQr.id, patch)}
              onDelete={() => {
                removeCoverQr(selSide, selQr.id);
                setSelection(COVER_NO_SELECTION);
              }}
            />
          ) : selection.kind === 'spine' ? (
            <SpineInspector
              spineTitle={config.spineTitle}
              spineColor={config.spineColor}
              fallbackTitle={sampleTitle}
              onChange={(patch) => setConfig((c) => ({ ...c, ...patch }))}
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              Select an element on the cover to edit it, or use the panels on the left to add text, stickers, a background,
              or a QR code. The title shown is a placeholder — each customer&rsquo;s album title fills it automatically.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
