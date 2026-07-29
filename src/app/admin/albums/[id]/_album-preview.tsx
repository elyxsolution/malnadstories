'use client';

import { useMemo } from 'react';
import Preview from '@/app/(app)/albums/[id]/build/_preview';
import type { Photo } from '@/lib/builder/photo';
import { type Block } from '@/lib/builder/model';

/** Client wrapper: builds the photo Map from arrays (RSC-serializable) and renders the
 *  same Preview the customer builder uses — so admin sees the album exactly as built. */
export default function AlbumPreview({
  photos,
  blocks,
  cover,
  stickerUrls = {},
}: {
  photos: Photo[];
  blocks: Block[];
  cover: { url: string; name: string } | null;
  stickerUrls?: Record<string, string>;
}) {
  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const stickerUrlFor = (id: string) => stickerUrls[id];
  return <Preview blocks={blocks} photoMap={photoMap} cover={cover} stickerUrlFor={stickerUrlFor} />;
}
