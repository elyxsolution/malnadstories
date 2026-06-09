'use client';

import { useMemo } from 'react';
import Preview from '@/app/(app)/albums/[id]/build/_preview';
import { type Photo } from '@/app/(app)/albums/[id]/build/_uploader';
import { type Block } from '@/lib/builder/model';

/** Client wrapper: builds the photo Map from arrays (RSC-serializable) and renders the
 *  same Preview the customer builder uses — so admin sees the album exactly as built. */
export default function AlbumPreview({ photos, blocks }: { photos: Photo[]; blocks: Block[] }) {
  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  return <Preview blocks={blocks} photoMap={photoMap} />;
}
