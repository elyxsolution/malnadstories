'use client';

import { useRef, useState } from 'react';
import { InlineLoader } from '@/components/loading';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Star, Copy, Eye, EyeOff, Archive, Pencil, Download, Upload, X, Crown } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { CoverDesignFromConfig } from '@/app/(app)/albums/[id]/build/_cover-render';
import type { CoverConfig } from '@/lib/builder/cover';
import { coverCategoryLabel, coverStatusChip, coverStatusLabel } from '@/lib/cover-templates/model';
import {
  setCoverTemplateStatus,
  setCoverTemplateFeatured,
  setDefaultCoverTemplate,
  duplicateCoverTemplate,
  exportCoverTemplate,
  importCoverTemplate,
} from '@/lib/actions/admin/cover-templates';

export type AdminCoverTemplate = {
  id: string;
  name: string;
  category: string;
  status: string;
  featured: boolean;
  /** THE default applied to every new album (0052). At most one template is true. */
  isDefault: boolean;
  config: CoverConfig;
  updatedAt: string;
};

const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function CoverTemplatesList({
  templates,
  stickerUrls,
}: {
  templates: AdminCoverTemplate[];
  stickerUrls: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const stickerUrlFor = (id: string) => stickerUrls[id];

  // Import flow: parsed file → confirm modal (create new | overwrite existing).
  const importRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; data: unknown } | null>(null);
  const [overwriteId, setOverwriteId] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id);
    const res = await fn();
    setBusy(null);
    if (!res.ok && res.error) alert(res.error);
    router.refresh();
  };

  const doExport = async (id: string) => {
    setBusy(id);
    const res = await exportCoverTemplate({ id });
    setBusy(null);
    if (!res.ok) return alert(res.error);
    const blob = new Blob([res.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (f: File) => {
    setImportError(null);
    setOverwriteId('');
    try {
      const parsed = JSON.parse(await f.text()) as { name?: unknown };
      setPending({ name: typeof parsed.name === 'string' ? parsed.name : 'Imported template', data: parsed });
    } catch {
      alert('That file is not valid JSON.');
    }
  };

  const confirmImport = async () => {
    if (!pending) return;
    setImporting(true);
    setImportError(null);
    const res = await importCoverTemplate({ data: pending.data, ...(overwriteId ? { overwriteId } : {}) });
    setImporting(false);
    if (!res.ok) return setImportError(res.error);
    setPending(null);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* Toolbar (always visible, incl. when empty) */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">Export a template to back it up or share it; import a `.json` file to recreate or overwrite one.</p>
        <Button variant="outline" size="sm" onClick={() => importRef.current?.click()}>
          <Upload /> Import
        </Button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImportFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {templates.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No cover templates yet. Create one — or import a `.json` file — to give customers a designed starting point.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {templates.map((t) => {
            const active = t.status === 'active';
            return (
              <div key={t.id} className="overflow-hidden rounded-xl border bg-card">
                {/* WYSIWYG preview via the shared cover renderer */}
                <Link href={`/admin/cover-templates/${t.id}`} className="block">
                  <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
                    <CoverDesignFromConfig config={t.config} title="Your Title" imageUrl={null} stickerUrlFor={stickerUrlFor} />
                    {t.featured && (
                      <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-gold/90 px-1.5 py-0.5 text-[10px] font-semibold text-background">
                        <Star className="h-3 w-3" /> Featured
                      </span>
                    )}
                    {t.isDefault && (
                      <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-sm">
                        <Crown className="h-3 w-3" /> Default
                      </span>
                    )}
                  </div>
                </Link>

                <div className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium" title={t.name}>
                      {t.name}
                    </span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${coverStatusChip(t.status)}`}>
                      {coverStatusLabel(t.status)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {coverCategoryLabel(t.category)} · {fmtDate(t.updatedAt)}
                  </p>

                  <div className="flex flex-wrap items-center gap-1 pt-1">
                    <Link href={`/admin/cover-templates/${t.id}`} aria-label="Edit" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
                      <Pencil className="h-4 w-4" />
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={active ? 'Deactivate' : 'Activate'}
                      disabled={busy === t.id}
                      onClick={() => run(t.id, () => setCoverTemplateStatus({ id: t.id, status: active ? 'inactive' : 'active' }))}
                    >
                      {busy === t.id ? <InlineLoader /> : active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t.featured ? 'Unfeature' : 'Feature'}
                      disabled={busy === t.id}
                      onClick={() => run(t.id, () => setCoverTemplateFeatured({ id: t.id, featured: !t.featured }))}
                      className={t.featured ? 'text-gold' : ''}
                    >
                      <Star className="h-4 w-4" />
                    </Button>
                    {/* THE default for new albums (0052). Only an ACTIVE template may hold it —
                        the action rejects otherwise, so the control is disabled to match. */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t.isDefault ? 'Clear default cover' : 'Make default cover for new albums'}
                      title={
                        t.isDefault
                          ? 'Default for new albums — click to clear'
                          : active
                            ? 'Make this the default for new albums'
                            : 'Activate this template first'
                      }
                      disabled={busy === t.id || (!active && !t.isDefault)}
                      onClick={() => run(t.id, () => setDefaultCoverTemplate({ id: t.id, isDefault: !t.isDefault }))}
                      className={t.isDefault ? 'text-primary' : ''}
                    >
                      <Crown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Duplicate"
                      disabled={busy === t.id}
                      onClick={() => run(t.id, () => duplicateCoverTemplate({ id: t.id }))}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Export" disabled={busy === t.id} onClick={() => doExport(t.id)}>
                      <Download className="h-4 w-4" />
                    </Button>
                    {t.status !== 'archived' && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Archive"
                        disabled={busy === t.id}
                        onClick={() => run(t.id, () => setCoverTemplateStatus({ id: t.id, status: 'archived' }))}
                        className="text-amber-600"
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Import confirmation */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPending(null)}>
          <div className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold">Import “{pending.name}”</h2>
              <button type="button" onClick={() => setPending(null)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">Create a new template, or overwrite an existing one&rsquo;s design.</p>
            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={!overwriteId} onChange={() => setOverwriteId('')} /> Create as a new template
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={!!overwriteId} onChange={() => setOverwriteId(templates[0]?.id ?? '')} disabled={templates.length === 0} /> Overwrite
                <select
                  value={overwriteId}
                  onChange={(e) => setOverwriteId(e.target.value)}
                  disabled={!overwriteId}
                  className="h-8 flex-1 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
            </div>
            {importError && <p className="mt-2 text-sm text-destructive">{importError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPending(null)} disabled={importing}>Cancel</Button>
              <Button size="sm" onClick={confirmImport} disabled={importing}>
                {importing ? <InlineLoader /> : <Upload />} {overwriteId ? 'Overwrite' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
