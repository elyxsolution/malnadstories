import Link from 'next/link';
import { Plus } from 'lucide-react';
import { db } from '@/db';
import { coverDesignTemplates } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { listActiveStickers } from '@/lib/stickers';
import { normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';
import { builderFontVars } from '@/lib/fonts';
import CoverTemplatesList, { type AdminCoverTemplate } from './_list';

export const dynamic = 'force-dynamic';

/**
 * Admin cover-design template catalog. Reads cross-user via Drizzle (superuser). Previews render
 * the stored CoverConfig with the SAME renderer the builder/PDF use, so the thumbnail is WYSIWYG.
 */
export default async function CoverTemplatesPage() {
  const [rows, stickerCatalog] = await Promise.all([
    db
      .select({
        id: coverDesignTemplates.id,
        name: coverDesignTemplates.name,
        category: coverDesignTemplates.category,
        status: coverDesignTemplates.status,
        featured: coverDesignTemplates.featured,
        sort: coverDesignTemplates.sort,
        config: coverDesignTemplates.config,
        updatedAt: coverDesignTemplates.updatedAt,
      })
      .from(coverDesignTemplates)
      .orderBy(desc(coverDesignTemplates.featured), coverDesignTemplates.sort, desc(coverDesignTemplates.updatedAt)),
    listActiveStickers(),
  ]);

  const stickerUrls: Record<string, string> = {};
  for (const c of stickerCatalog) for (const s of c.stickers) stickerUrls[s.id] = s.url;

  const templates: AdminCoverTemplate[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    status: r.status,
    featured: r.featured,
    config: normalizeCoverConfig(r.config as Parameters<typeof normalizeCoverConfig>[0]) as CoverConfig,
    updatedAt: r.updatedAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Cover templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Full cover designs built in the same editor customers use. Customers pick one as a fully-editable starting
            point. (For legacy uploaded-image covers, see{' '}
            <Link href="/admin/covers" className="underline">
              Cover artwork
            </Link>
            .)
          </p>
        </div>
        <Link
          href="/admin/cover-templates/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New template
        </Link>
      </div>

      <div className={builderFontVars}>
        <CoverTemplatesList templates={templates} stickerUrls={stickerUrls} />
      </div>
    </div>
  );
}
