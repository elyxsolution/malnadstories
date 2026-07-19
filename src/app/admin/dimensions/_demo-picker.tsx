'use client';

import { useEffect, useState, useTransition } from 'react';
import { InlineLoader } from '@/components/loading';
import { useRouter } from 'next/navigation';
import { X, Search, BookOpen } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { listAlbumsForDemo, setProductDemoAlbum } from '@/lib/actions/admin/product-demo';

type Album = { id: string; title: string; size: number; pages: number };

/** Modal picker: choose an existing (content-bearing) album as the product's demo album. */
export default function DemoAlbumPicker({ productId, onClose }: { productId: string; onClose: () => void }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await listAlbumsForDemo({ search });
      if (!active) return;
      setLoading(false);
      if (res.ok) setAlbums(res.albums);
      else setError(res.error);
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [search]);

  const choose = (albumId: string) =>
    startTransition(async () => {
      const res = await setProductDemoAlbum({ productId, albumId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border bg-background shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Choose a demo album</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search albums by title…" className="pl-8" />
          </div>
        </div>
        {error && <p className="px-4 py-2 text-sm text-destructive">{error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <InlineLoader />
            </div>
          ) : albums.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No designed albums found.</p>
          ) : (
            <ul className="space-y-1">
              {albums.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => choose(a.id)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    <BookOpen className="h-4 w-4 flex-none text-muted-foreground" />
                    <span className="flex-1 truncate text-sm font-medium text-foreground">{a.title}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {a.size}p · {a.pages} spreads
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
