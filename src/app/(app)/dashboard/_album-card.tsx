'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2, Loader2, X, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { deleteAlbum } from '@/lib/actions/albums';

export type AlbumCardData = { id: string; title: string; size: number; status: string };

export default function AlbumCard({ album }: { album: AlbumCardData }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConfirm = async () => {
    setDeleting(true);
    setError(null);
    const res = await deleteAlbum(album.id);
    if (res.ok) {
      router.refresh(); // re-render the server grid without this album
    } else {
      setError(res.error);
      setDeleting(false);
    }
  };

  return (
    <div className="group relative">
      <Link href={`/albums/${album.id}/build`} className="block">
        <Card className="h-full hover:ring-2 hover:ring-foreground/20 transition-shadow">
          <CardHeader>
            <CardTitle className="text-base">{album.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{album.size} pages</p>
            <p className="mt-1 text-xs capitalize text-muted-foreground">{album.status}</p>
          </CardContent>
        </Card>
      </Link>

      {/* Sibling of the Link (not a child), so clicking it never navigates. */}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Delete ${album.title}`}
        className="absolute right-2 top-2 rounded-md bg-background/80 p-1.5 text-destructive opacity-0 shadow-sm transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !deleting && setConfirming(false)}
        >
          <div className="w-full max-w-sm rounded-xl border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4 text-destructive" /> Delete “{album.title}”?
              </h2>
              <Button variant="ghost" size="icon-sm" onClick={() => setConfirming(false)} disabled={deleting} aria-label="Close">
                <X />
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              This permanently deletes the album, <strong>all uploaded photos</strong>, and the saved
              layout. This cannot be undone.
            </p>
            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={onConfirm} disabled={deleting}>
                {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
