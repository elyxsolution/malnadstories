'use client';

import { useMemo, useState } from 'react';
import { InlineLoader } from '@/components/loading';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Save, CheckCircle2, PauseCircle, Archive, Copy, Plus, Trash2, ArrowLeft } from 'lucide-react';
import { saveTemplate, setTemplateStatus, duplicateTemplate } from '@/lib/actions/admin/templates';
import {
  TEMPLATE_CATEGORIES,
  CATEGORY_PRESET,
  categoryLabel,
  statusLabel,
  statusChip,
  validateGeometry,
  type TemplateCategory,
  type TemplateBase,
  type TemplateGeometry,
} from '@/lib/templates/model';
import { LAYOUT_TEMPLATES, TEMPLATE_LABEL, MAX_OVERLAYS_PER_BLOCK } from '@/lib/builder/model';
import TemplatePreview from './_preview';

export type TemplateEditorInitial = {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  category: TemplateCategory;
  status: string; // 'new' for unsaved
  geometry: TemplateGeometry;
  previewImage: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Template editor. The geometry is edited as a base primitive + numeric overlay rects (0–1),
 * with a live preview that matches the builder canvas. Activation is blocked unless
 * validateGeometry passes (the server re-checks). All writes go through the gated actions.
 */
export default function TemplateEditor({ initial }: { initial: TemplateEditorInitial }) {
  const router = useRouter();
  const isNew = initial.id === null;

  const [id, setId] = useState(initial.id);
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [description, setDescription] = useState(initial.description);
  const [category, setCategory] = useState<TemplateCategory>(initial.category);
  const [status, setStatus] = useState(initial.status);
  const [base, setBase] = useState<TemplateBase>(initial.geometry.base);
  const [overlays, setOverlays] = useState(initial.geometry.overlays);
  const [previewImage, setPreviewImage] = useState(initial.previewImage);

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const geometry: TemplateGeometry = useMemo(() => ({ base, overlays }), [base, overlays]);
  const validation = useMemo(() => validateGeometry(geometry), [geometry]);

  const setOverlay = (i: number, patch: Partial<{ x: number; y: number; w: number; h: number }>) =>
    setOverlays((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const addOverlay = () =>
    setOverlays((prev) =>
      prev.length >= MAX_OVERLAYS_PER_BLOCK ? prev : [...prev, { x: 0.1, y: 0.1, w: 0.25, h: 0.3 }],
    );
  const removeOverlay = (i: number) => setOverlays((prev) => prev.filter((_, idx) => idx !== i));
  const applyPreset = () => {
    const p = CATEGORY_PRESET[category];
    setBase(p.base);
    setOverlays(p.overlays);
  };

  const payload = () => ({
    id: id ?? undefined,
    name,
    slug: slug.trim() || undefined,
    description: description.trim() || undefined,
    category,
    geometry,
    previewImage: previewImage.trim() || undefined,
  });

  const save = async (): Promise<string | null> => {
    const res = await saveTemplate(payload());
    if (!res.ok) {
      setMsg({ kind: 'err', text: res.error });
      return null;
    }
    if (isNew || res.id !== id) {
      setId(res.id);
      router.replace(`/admin/templates/${res.id}`);
    }
    return res.id;
  };

  const onSave = async () => {
    setBusy('save');
    setMsg(null);
    const newId = await save();
    setBusy(null);
    if (newId) {
      router.refresh();
      setMsg({ kind: 'ok', text: 'Saved.' });
    }
  };

  const onStatus = async (target: 'active' | 'inactive' | 'archived') => {
    setBusy(target);
    setMsg(null);
    const savedId = await save(); // persist current edits first
    if (!savedId) {
      setBusy(null);
      return;
    }
    const res = await setTemplateStatus({ id: savedId, status: target });
    setBusy(null);
    if (res.ok) {
      setStatus(target);
      router.refresh();
      setMsg({ kind: 'ok', text: `Saved & ${statusLabel(target).toLowerCase()}.` });
    } else {
      setMsg({ kind: 'err', text: res.error });
    }
  };

  const onDuplicate = async () => {
    if (!id) return;
    setBusy('dup');
    const res = await duplicateTemplate({ id });
    setBusy(null);
    if (res.ok) router.push(`/admin/templates/${res.id}`);
    else setMsg({ kind: 'err', text: res.error });
  };

  const nameMissing = name.trim().length === 0;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/admin/templates" className="inline-flex items-center gap-1 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Templates
        </Link>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{isNew ? 'New template' : name || 'Edit template'}</h1>
        {!isNew && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(status)}`}>{statusLabel(status)}</span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Form */}
        <div className="space-y-5">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
            />
          </Field>

          <Field label="Slug" hint="Lowercase letters, numbers and dashes. Blank = derive from name.">
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="auto-generated"
              className="h-9 w-full rounded-md border bg-background px-3 font-mono text-sm outline-none focus:border-ring"
            />
          </Field>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
            />
          </Field>

          <Field label="Category">
            <div className="flex items-center gap-2">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as TemplateCategory)}
                className="h-9 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
              >
                {TEMPLATE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={applyPreset}
                className="h-9 flex-none rounded-md border px-2.5 text-xs hover:bg-muted"
                title="Reset geometry to this category's preset"
              >
                Use preset
              </button>
            </div>
          </Field>

          <Field label="Base layout" hint="The renderer primitive this preset maps onto.">
            <div className="flex gap-2">
              {LAYOUT_TEMPLATES.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBase(b)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    base === b ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'
                  }`}
                >
                  {TEMPLATE_LABEL[b]}
                </button>
              ))}
            </div>
          </Field>

          {/* Overlay slots */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium">Overlay slots ({overlays.length})</label>
              <button
                type="button"
                onClick={addOverlay}
                disabled={overlays.length >= MAX_OVERLAYS_PER_BLOCK}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" /> Add slot
              </button>
            </div>
            {overlays.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                No overlay slots — just the base layout.
              </p>
            ) : (
              <div className="space-y-2">
                {overlays.map((o, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-md border bg-card p-2">
                    <span className="grid h-6 w-6 flex-none place-items-center rounded bg-primary/10 text-xs font-medium text-primary">
                      {i + 1}
                    </span>
                    {(['x', 'y', 'w', 'h'] as const).map((k) => (
                      <label key={k} className="flex items-center gap-1 text-xs text-muted-foreground">
                        {k}
                        <input
                          type="number"
                          step={0.01}
                          min={0}
                          max={1}
                          value={o[k]}
                          onChange={(e) => setOverlay(i, { [k]: round2(Number(e.target.value)) })}
                          className="h-8 w-16 rounded border bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
                        />
                      </label>
                    ))}
                    <button
                      type="button"
                      onClick={() => removeOverlay(i)}
                      className="ml-auto grid h-8 w-8 flex-none place-items-center rounded-md text-destructive hover:bg-destructive/10"
                      aria-label="Remove slot"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Field label="Preview image URL" hint="Optional override thumbnail (the live preview is computed).">
            <input
              value={previewImage}
              onChange={(e) => setPreviewImage(e.target.value)}
              placeholder="https://…"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
            />
          </Field>
        </div>

        {/* Live preview + validation */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Preview</p>
          <TemplatePreview geometry={geometry} />
          {validation.ok ? (
            <p className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">
              Geometry is valid — this template can be activated.
            </p>
          ) : (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <p className="font-medium">Geometry not renderer-safe:</p>
              <ul className="mt-1 list-inside list-disc">
                {validation.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-7 flex flex-wrap items-center gap-2 border-t pt-5">
        <button
          type="button"
          onClick={onSave}
          disabled={busy !== null || nameMissing || !validation.ok}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {busy === 'save' ? <InlineLoader /> : <Save className="h-4 w-4" />} Save
        </button>

        {status !== 'active' && (
          <button
            type="button"
            onClick={() => onStatus('active')}
            disabled={busy !== null || nameMissing || !validation.ok}
            title={!validation.ok ? 'Fix geometry before activating' : undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === 'active' ? <InlineLoader /> : <CheckCircle2 className="h-4 w-4" />} Activate
          </button>
        )}

        {status === 'active' && (
          <button
            type="button"
            onClick={() => onStatus('inactive')}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {busy === 'inactive' ? <InlineLoader /> : <PauseCircle className="h-4 w-4" />} Deactivate
          </button>
        )}

        {!isNew && status !== 'archived' && (
          <button
            type="button"
            onClick={() => onStatus('archived')}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-amber-600 hover:bg-amber-500/10 disabled:opacity-50"
          >
            {busy === 'archived' ? <InlineLoader /> : <Archive className="h-4 w-4" />} Archive
          </button>
        )}

        {!isNew && (
          <button
            type="button"
            onClick={onDuplicate}
            disabled={busy !== null}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {busy === 'dup' ? <InlineLoader /> : <Copy className="h-4 w-4" />} Duplicate
          </button>
        )}
      </div>

      {msg && <p className={`mt-3 text-sm ${msg.kind === 'ok' ? 'text-success' : 'text-destructive'}`}>{msg.text}</p>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
