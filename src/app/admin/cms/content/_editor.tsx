'use client';

import { useState } from 'react';
import { InlineLoader } from '@/components/loading';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Save, CheckCircle2, Archive, Copy, Undo2, ArrowLeft } from 'lucide-react';
import { saveContent, setContentStatus, duplicateContent } from '@/lib/actions/admin/cms';
import BlueprintPickerField, { type PickableBlueprint } from './_blueprint-picker-field';
import {
  CONTENT_TYPES,
  TYPE_CONFIG,
  typeConfig,
  typeLabel,
  statusLabel,
  statusChip,
  slugify,
  type ContentType,
} from '@/lib/cms/model';

/** Scalars, plus the ordered id list an entity-reference field stores (Phase 1). */
type MetaValue = string | number | boolean | string[];

export type EditorInitial = {
  id: string | null;
  type: ContentType;
  status: string; // 'new' for an unsaved item
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage: string;
  metadata: Record<string, MetaValue>;
};

/**
 * Type-aware content editor. Fields are driven by TYPE_CONFIG (lib/cms/model). All writes
 * go through the requireCmsCapability-gated server actions; the editor never mutates the DB
 * directly. Save persists content (status unchanged); Publish/Archive/Move-to-draft change
 * status; Duplicate clones as a fresh draft.
 */
export default function CmsEditor({
  initial,
  blueprintOptions = [],
  blueprintStickerUrls = {},
}: {
  initial: EditorInitial;
  /** Active designs offered by any `blueprints` metadata field on this type. */
  blueprintOptions?: PickableBlueprint[];
  blueprintStickerUrls?: Record<string, string>;
}) {
  const router = useRouter();
  const isNew = initial.id === null;

  const [type, setType] = useState<ContentType>(initial.type);
  const [title, setTitle] = useState(initial.title);
  const [slug, setSlug] = useState(initial.slug);
  const [excerpt, setExcerpt] = useState(initial.excerpt);
  const [content, setContent] = useState(initial.content);
  const [coverImage, setCoverImage] = useState(initial.coverImage);
  const [metadata, setMetadata] = useState<Record<string, MetaValue>>(initial.metadata);

  const [status, setStatus] = useState(initial.status);
  const [id, setId] = useState(initial.id);
  const [busy, setBusy] = useState<null | string>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const cfg = typeConfig(type);

  const setMeta = (key: string, value: MetaValue) => setMetadata((m) => ({ ...m, [key]: value }));

  const payload = () => ({
    id: id ?? undefined,
    type,
    title,
    slug: slug.trim() || undefined,
    excerpt: cfg.showExcerpt ? excerpt : undefined,
    content,
    coverImage: cfg.showCover ? coverImage : undefined,
    // Only send metadata keys this type defines (avoids stale keys lingering).
    metadata: Object.fromEntries(cfg.metaFields.map((f) => [f.key, metadata[f.key]]).filter(([, v]) => v !== undefined && v !== '')),
  });

  // Persist content, then optionally apply a status transition.
  const run = async (key: string, target: 'published' | 'archived' | 'draft' | null) => {
    setBusy(key);
    setMsg(null);
    const res = await saveContent(payload());
    if (!res.ok) {
      setBusy(null);
      setMsg({ kind: 'err', text: res.error });
      return;
    }
    const newId = res.id;
    if (target) {
      const sres = await setContentStatus({ id: newId, status: target });
      if (!sres.ok) {
        setBusy(null);
        setMsg({ kind: 'err', text: sres.error });
        return;
      }
      setStatus(target);
    }
    setBusy(null);
    if (isNew || newId !== id) {
      setId(newId);
      router.replace(`/admin/cms/content/${newId}`);
    }
    router.refresh();
    setMsg({ kind: 'ok', text: target ? `Saved & ${statusLabel(target).toLowerCase()}.` : 'Saved.' });
  };

  const duplicate = async () => {
    if (!id) return;
    setBusy('duplicate');
    setMsg(null);
    const res = await duplicateContent({ id });
    setBusy(null);
    if (res.ok) router.push(`/admin/cms/content/${res.id}`);
    else setMsg({ kind: 'err', text: res.error });
  };

  const titleMissing = title.trim().length === 0;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/admin/cms/content" className="inline-flex items-center gap-1 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Content
        </Link>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{isNew ? 'New content' : title || 'Edit content'}</h1>
        {!isNew && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(status)}`}>
            {statusLabel(status)}
          </span>
        )}
      </div>

      <div className="space-y-5">
        {/* Type — fixed once created (changing type would orphan metadata) */}
        <Field label="Type">
          {isNew ? (
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ContentType)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
            >
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm">{typeLabel(type)}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">{TYPE_CONFIG[type].blurb}</p>
        </Field>

        <Field label={cfg.titleLabel}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
          />
        </Field>

        <Field label="Slug" hint="Lowercase letters, numbers and dashes. Leave blank to derive from the title.">
          <div className="flex items-center gap-2">
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={title ? slugify(title) : 'auto-generated'}
              className="h-9 w-full rounded-md border bg-background px-3 font-mono text-sm outline-none focus:border-ring"
            />
            <button
              type="button"
              onClick={() => setSlug(slugify(title))}
              disabled={titleMissing}
              className="h-9 flex-none rounded-md border px-2.5 text-xs hover:bg-muted disabled:opacity-50"
            >
              From title
            </button>
          </div>
        </Field>

        {cfg.showExcerpt && (
          <Field label="Excerpt" hint="Short summary (optional).">
            <textarea
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
            />
          </Field>
        )}

        <Field label={cfg.contentLabel} hint="Markdown / plain text.">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            maxLength={20000}
            className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
        </Field>

        {cfg.showCover && (
          <Field label="Cover image URL" hint="Paste a hosted image URL (no upload here).">
            <input
              value={coverImage}
              onChange={(e) => setCoverImage(e.target.value)}
              placeholder="https://…"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
            />
          </Field>
        )}

        {/* Per-type metadata fields */}
        {cfg.metaFields.map((f) => (
          <Field key={f.key} label={f.label}>
            {f.kind === 'blueprints' ? (
              /* Entity references (Phase 1) — the editor picks real covers, never ids. Branching
                 on the FIELD KIND, not on the content type, so any type declaring this field gets
                 the same picker for free. */
              <BlueprintPickerField
                value={metadata[f.key]}
                options={blueprintOptions}
                stickerUrls={blueprintStickerUrls}
                onChange={(ids) => setMeta(f.key, ids)}
              />
            ) : f.kind === 'boolean' ? (
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(metadata[f.key])}
                  onChange={(e) => setMeta(f.key, e.target.checked)}
                />
                <span className="text-muted-foreground">Enabled</span>
              </label>
            ) : f.kind === 'number' ? (
              <input
                type="number"
                value={metadata[f.key] === undefined ? '' : String(metadata[f.key])}
                min={f.min}
                max={f.max}
                onChange={(e) => setMeta(f.key, e.target.value === '' ? '' : Number(e.target.value))}
                className="h-9 w-32 rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
              />
            ) : (
              <input
                value={metadata[f.key] === undefined ? '' : String(metadata[f.key])}
                placeholder={f.placeholder}
                maxLength={2000}
                onChange={(e) => setMeta(f.key, e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
              />
            )}
          </Field>
        ))}
      </div>

      {/* Actions */}
      <div className="mt-7 flex flex-wrap items-center gap-2 border-t pt-5">
        <button
          type="button"
          onClick={() => run('save', null)}
          disabled={busy !== null || titleMissing}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {busy === 'save' ? <InlineLoader /> : <Save className="h-4 w-4" />} Save draft
        </button>

        {status !== 'published' && (
          <button
            type="button"
            onClick={() => run('publish', 'published')}
            disabled={busy !== null || titleMissing}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === 'publish' ? <InlineLoader /> : <CheckCircle2 className="h-4 w-4" />} Publish
          </button>
        )}

        {status === 'published' && (
          <button
            type="button"
            onClick={() => run('draft', 'draft')}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {busy === 'draft' ? <InlineLoader /> : <Undo2 className="h-4 w-4" />} Move to draft
          </button>
        )}

        {!isNew && status !== 'archived' && (
          <button
            type="button"
            onClick={() => run('archive', 'archived')}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-amber-600 hover:bg-amber-500/10 disabled:opacity-50"
          >
            {busy === 'archive' ? <InlineLoader /> : <Archive className="h-4 w-4" />} Archive
          </button>
        )}

        {!isNew && status === 'archived' && (
          <button
            type="button"
            onClick={() => run('restore', 'draft')}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {busy === 'restore' ? <InlineLoader /> : <Undo2 className="h-4 w-4" />} Restore to draft
          </button>
        )}

        {!isNew && (
          <button
            type="button"
            onClick={duplicate}
            disabled={busy !== null}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {busy === 'duplicate' ? <InlineLoader /> : <Copy className="h-4 w-4" />} Duplicate
          </button>
        )}
      </div>

      {msg && (
        <p className={`mt-3 text-sm ${msg.kind === 'ok' ? 'text-success' : 'text-destructive'}`}>{msg.text}</p>
      )}
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
