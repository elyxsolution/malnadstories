import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { validateGeometry, normalizeGeometry, type TemplateCategory, type TemplateGeometry } from './model';

/**
 * Active layout-template catalog for the builder + auto-layout. Read via the service role
 * (the active catalog is a global, non-user-owned list, like the covers/album_pdfs loaders).
 * Only ACTIVE rows whose geometry STILL validates are returned, so an unselectable or
 * malformed template can never reach the builder/renderer — PDF parity by construction.
 */
export type ActiveTemplate = {
  id: string;
  name: string;
  category: TemplateCategory;
  geometry: TemplateGeometry;
};

export async function listActiveTemplates(): Promise<ActiveTemplate[]> {
  const svc = createServiceClient();
  const { data } = await svc
    .from('layout_templates')
    .select('id, name, category, geometry')
    .eq('status', 'active')
    .order('category', { ascending: true })
    .order('updated_at', { ascending: false });

  const rows = (data ?? []) as { id: string; name: string; category: string; geometry: unknown }[];
  const out: ActiveTemplate[] = [];
  for (const r of rows) {
    // Defense in depth: skip any active row that no longer validates.
    if (!validateGeometry(r.geometry).ok) continue;
    out.push({
      id: r.id,
      name: r.name,
      category: r.category as TemplateCategory,
      geometry: normalizeGeometry(r.geometry),
    });
  }
  return out;
}
