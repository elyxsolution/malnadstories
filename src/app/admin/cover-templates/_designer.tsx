'use client';

import { useCallback, useMemo, useState } from 'react';
import { InlineLoader } from '@/components/loading';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Save, ArrowLeft, Type as TypeIcon, Sticker as StickerIcon, Palette, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import CoverCanvas from '@/app/(app)/albums/[id]/build/_cover-canvas';
import { useCover } from '@/app/(app)/albums/[id]/build/_use-cover';
import TextPanel from '@/app/(app)/albums/[id]/build/_panel-text';
import StickersPanel from '@/app/(app)/albums/[id]/build/_panel-stickers';
import BackgroundsPanel from '@/app/(app)/albums/[id]/build/_panel-backgrounds';
import QrPanel from '@/app/(app)/albums/[id]/build/_panel-qr';
import { TextInspector, StickerInspector, QrInspector } from '@/app/(app)/albums/[id]/build/_element-inspectors';
import { isPermanentRole, roleLabel } from '@/lib/builder/cover-objects';
import { normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';
import type { StickerCategory } from '@/lib/stickers';
import {
  COVER_TEMPLATE_CATEGORIES,
  coverCategoryLabel,
  type CoverTemplateCategory,
} from '@/lib/cover-templates/model';
import { saveCoverTemplate } from '@/lib/actions/admin/cover-templates';

/**
 * Admin cover-template DESIGNER — the SAME editor customers use, driving a local `CoverConfig`
 * that is saved as a template (0040) instead of onto an album.
 *
 * ── WHAT COVER EDITOR 2.0 CHANGED HERE ─────────────────────────────────────────────────────
 *
 * This file used to carry a verbatim copy of the builder's ~20 cover handlers (`writeSide`,
 * `patchCoverText`, `duplicateCoverSticker`, …), described in its own comment as "mirroring
 * _builder.tsx". Two copies of the same logic are two things to keep in step. Both are now the
 * one `useCover` hook, so an admin template is composed with exactly the machinery a customer
 * cover is — the object model, the metadata roles, undo/redo and the shared movement engine.
 *
 * A template carries no album photos, so the photo sources are empty; admins compose with
 * backgrounds, text, stickers and QR. There is no `DimensionsProvider` here on purpose: the
 * context's own fallback is the house 3:4 cover page, which is what a template is authored
 * against — it is applied to albums of every product size.
 */
type RailTab = 'text' | 'stickers' | 'backgrounds' | 'qr';
const RAIL: { key: RailTab; label: string; Icon: typeof TypeIcon }[] = [
  { key: 'text', label: 'Text', Icon: TypeIcon },
  { key: 'stickers', label: 'Stickers', Icon: StickerIcon },
  { key: 'backgrounds', label: 'Background', Icon: Palette },
  { key: 'qr', label: 'QR', Icon: QrCode },
];

/** Templates are authored against the house 3:4 cover page. */
const TEMPLATE_PAGE_ASPECT = 3 / 4;
const SAMPLE_TITLE = 'Your Title';

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
  const [railTab, setRailTab] = useState<RailTab>('text');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialConfig = useMemo(() => normalizeCoverConfig(initial.config), [initial.config]);

  /**
   * The same cover-canvas state the builder uses. Nothing is persisted until Save, so `onChange`
   * is a no-op — the hook still owns the config, the history and the metadata binding, and this
   * component simply reads `cover.config` when the admin clicks Save.
   */
  const noop = useCallback(() => {}, []);
  const cover = useCover({
    initialConfig,
    title: SAMPLE_TITLE,
    pageAspect: TEMPLATE_PAGE_ASPECT,
    onChange: noop,
    onTitleChange: noop,
  });

  // Sticker id → presigned url, from the active catalog (for canvas + preview rendering).
  const stickerUrl = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of stickerCatalog) for (const s of c.stickers) m.set(s.id, s.url);
    return m;
  }, [stickerCatalog]);
  const stickerUrlFor = (id: string) => stickerUrl.get(id);

  const key = `cover:${cover.side}`;
  const sel = cover.selection;
  const selText = sel.kind === 'text' ? cover.elements.texts.find((t) => t.id === sel.id) ?? null : null;
  const selSticker = sel.kind === 'sticker' ? cover.elements.stickers.find((s) => s.id === sel.id) ?? null : null;
  const selQr = sel.kind === 'qr' ? cover.elements.qrs.find((q) => q.id === sel.id) ?? null : null;

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
      config: cover.config,
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
            {railTab === 'text' && <TextPanel hasTarget onAdd={cover.addText} />}
            {railTab === 'stickers' && (
              <StickersPanel catalog={stickerCatalog} hasTarget={cover.side !== 'spine'} onAdd={cover.addSticker} />
            )}
            {railTab === 'backgrounds' && (
              <BackgroundsPanel
                current={cover.background}
                hasTarget={cover.side !== 'spine'}
                onApply={(bg) => cover.setBackground(bg)}
                onApplyAll={(bg) => cover.setBackground(bg)}
              />
            )}
            {railTab === 'qr' && <QrPanel hasTarget={cover.side !== 'spine'} onAdd={cover.addQr} />}
          </div>
        </aside>

        {/* Center — the SAME interactive cover spread customers use */}
        <main className="flex min-w-0 flex-1 flex-col bg-muted/30">
          <CoverCanvas cover={cover} frontImageUrl={null} backImageUrl={null} size={36} stickerUrlFor={stickerUrlFor} />
        </main>

        {/* Right — element inspector. An ADMIN affordance: this tool has no floating toolbar (no
            anchor plumbing, no album), so the inspectors stay docked. The permanent sidebar that
            was removed is the CUSTOMER builder's cover panel, not this. */}
        <aside className="ms-scroll w-72 flex-none overflow-y-auto border-l bg-card">
          {selText ? (
            <>
              <TextInspector
                el={selText}
                onChange={(patch) => cover.patchText(key, selText.id, patch)}
                onDelete={
                  isPermanentRole(selText.role)
                    ? undefined
                    : () => {
                        cover.removeText(key, selText.id);
                        cover.setSelection({ kind: 'none' });
                      }
                }
              />
              {roleLabel(selText.role) && (
                <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                  This is the <strong className="font-medium text-foreground">{roleLabel(selText.role)}</strong> object —
                  its words come from each customer&rsquo;s album metadata. Position and styling are yours.
                </p>
              )}
            </>
          ) : selSticker ? (
            <StickerInspector
              el={selSticker}
              onChange={(patch) => cover.patchSticker(key, selSticker.id, patch)}
              onDelete={() => {
                cover.removeSticker(key, selSticker.id);
                cover.setSelection({ kind: 'none' });
              }}
              onDuplicate={() => cover.duplicateSticker(key, selSticker.id)}
              onForward={() => cover.moveLayer({ kind: 'sticker', blockKey: key, id: selSticker.id }, 'forward')}
              onBackward={() => cover.moveLayer({ kind: 'sticker', blockKey: key, id: selSticker.id }, 'backward')}
            />
          ) : selQr ? (
            <QrInspector
              el={selQr}
              onChange={(patch) => cover.patchQr(key, selQr.id, patch)}
              onDelete={() => {
                cover.removeQr(key, selQr.id);
                cover.setSelection({ kind: 'none' });
              }}
            />
          ) : (
            <div className="space-y-2 p-4 text-sm text-muted-foreground">
              <p>
                Select an object on the cover to edit it, or use the panels on the left to add text, stickers, a
                background, or a QR code.
              </p>
              <p>
                The title, subtitle, author and spine are objects too — move and restyle them freely. Their words are
                placeholders here; each customer&rsquo;s album metadata fills them when the template is applied.
              </p>
              {sel.kind === 'background' && <p>Editing the {cover.sideLabel.toLowerCase()} background.</p>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
