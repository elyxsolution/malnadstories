import { requireAdmin } from '@/lib/auth/require-admin';
import { listAllCovers } from '@/lib/admin/covers';
import CoversManager from './_covers-manager';

/**
 * Admin cover-template catalogue. Gated by requireAdmin() (belt to the layout gate).
 * Admins upload/activate/delete covers; customers select one (never edit it) in the
 * builder, and it becomes physical page 1 of the printed photobook.
 */
export default async function AdminCoversPage() {
  await requireAdmin();
  const covers = await listAllCovers();

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-1 text-xl font-bold">Cover designs</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Manage the cover templates customers can choose. Each becomes the cover (page 1) of their photobook.
      </p>
      <CoversManager covers={covers} />
    </div>
  );
}
