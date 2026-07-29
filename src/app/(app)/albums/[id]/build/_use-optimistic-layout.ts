'use client';

import { useCallback, useRef, useState } from 'react';
import { classify, type EnginePhoto } from '@/lib/builder/auto-layout';
import type { Block } from '@/lib/builder/model';
import type { Photo } from '@/lib/builder/photo';
import { orientedSize } from './_photo-state';

/**
 * OPTIMISTIC AUTO-LAYOUT RECONCILIATION.
 *
 * Auto-layout decides everything from ONE derived property: a photo's shape class
 * (`classify` → pano / landscape / portrait / square). With Phase 4's client metadata, that
 * class is knowable the instant a file is picked — so "Build it for me" no longer waits for the
 * worker.
 *
 * The obligation that creates is verification. This hook records the class used for every photo
 * a layout was built from, then compares against the authoritative class once the worker's
 * dimensions land:
 *
 *   • CLASSES MATCH (overwhelmingly the common case — both sources are oriented, so they agree
 *     unless a file was genuinely ambiguous) → nothing happens. The user never learns there was
 *     anything to check.
 *   • CLASSES DIFFER, layout untouched since it was generated → recompute silently. The user
 *     sees the layout settle into its correct form, having changed nothing themselves.
 *   • CLASSES DIFFER, user has edited since → DO NOT overwrite their work. Surface a quiet,
 *     dismissible offer to rebuild instead.
 *
 * That third branch is the important one. "Automatically recompute only if required" cannot mean
 * "silently discard edits the user made in the meantime" — a layout the user has touched is
 * theirs, and reconciliation is not a licence to throw it away.
 */

/** A photo projected for the engine, tagged with where its dimensions came from. */
export type LayoutInput = EnginePhoto & { dimensionSource: 'server' | 'client' };

/** Project the photos an auto-layout run may use — server dims preferred, client accepted. */
export function layoutInputs(photos: Photo[]): LayoutInput[] {
  const out: LayoutInput[] = [];
  for (const p of photos) {
    const size = orientedSize(p);
    if (!size) continue; // no reliable shape from either source — sit this round out
    out.push({
      id: p.id,
      width: size.width,
      height: size.height,
      takenAt: p.takenAt,
      dimensionSource: size.source,
    });
  }
  return out;
}

/** A stable fingerprint of a layout's photo placement — used to detect user edits. */
function signature(blocks: Block[]): string {
  return blocks
    .map((b) => `${b.template}:${b.photoIds.filter(Boolean).join(',')}|${b.overlays.map((o) => o.photoId ?? '').join(',')}`)
    .join(';');
}

type Snapshot = {
  /** Shape class per photo, as it was believed when the layout was generated. */
  classes: Map<string, string>;
  /** Photos whose class came from the browser rather than the worker. */
  optimisticIds: Set<string>;
  /** Placement fingerprint at generation time. */
  signature: string;
};

export function useOptimisticLayout() {
  const snapshotRef = useRef<Snapshot | null>(null);
  /** Set when verification found a real mismatch the user must decide about. */
  const [driftedCount, setDriftedCount] = useState(0);

  /** True while a layout on screen was built from at least one browser-measured photo. */
  const [isOptimistic, setIsOptimistic] = useState(false);

  /** Record what a newly-accepted layout was built from. Call when a proposal is applied. */
  const record = useCallback((blocks: Block[], inputs: LayoutInput[]) => {
    const classes = new Map<string, string>();
    const optimisticIds = new Set<string>();
    for (const input of inputs) {
      classes.set(input.id, classify(input));
      if (input.dimensionSource === 'client') optimisticIds.add(input.id);
    }
    snapshotRef.current = { classes, optimisticIds, signature: signature(blocks) };
    setIsOptimistic(optimisticIds.size > 0);
    setDriftedCount(0);
  }, []);

  /** Forget the snapshot — the layout is no longer one we are responsible for verifying. */
  const clear = useCallback(() => {
    snapshotRef.current = null;
    setIsOptimistic(false);
    setDriftedCount(0);
  }, []);

  /**
   * Verify the recorded layout against current (possibly now-authoritative) photo data.
   *
   * Returns what the caller should do. `remap` ids are photos whose shape turned out different;
   * `canAutoFix` is true only when the layout is still byte-identical to what we generated.
   */
  const verify = useCallback(
    (photos: Photo[], blocks: Block[]): { drifted: string[]; canAutoFix: boolean } => {
      const snap = snapshotRef.current;
      if (!snap || snap.optimisticIds.size === 0) return { drifted: [], canAutoFix: false };

      const drifted: string[] = [];
      for (const photo of photos) {
        // Only photos we GUESSED about, and only once the worker has spoken.
        if (!snap.optimisticIds.has(photo.id)) continue;
        if (!(photo.status === 'ready' && photo.width && photo.height)) continue;
        const authoritative = classify({ id: photo.id, width: photo.width, height: photo.height });
        const assumed = snap.classes.get(photo.id);
        if (assumed && assumed !== authoritative) drifted.push(photo.id);
        // Either way this photo is now settled — stop tracking it.
        snap.optimisticIds.delete(photo.id);
      }

      if (snap.optimisticIds.size === 0 && drifted.length === 0) {
        // Everything we guessed turned out right. Silently drop the optimistic marker.
        snapshotRef.current = null;
        setIsOptimistic(false);
      }
      if (drifted.length > 0) setDriftedCount((n) => n + drifted.length);

      return { drifted, canAutoFix: signature(blocks) === snap.signature };
    },
    [],
  );

  return { record, verify, clear, isOptimistic, driftedCount, setDriftedCount };
}
