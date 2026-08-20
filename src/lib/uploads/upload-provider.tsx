'use client';

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { revokeLocalPreview } from '@/lib/builder/photo-url';
import { record } from '@/lib/perf/metrics';
import { UploadManager, type ConfirmedUpload, type DiscardedUpload, type ExtractedMetadata, type QueuedUpload } from './manager';

/**
 * THE UPLOAD PROVIDER — the owner of the one `UploadManager` an authenticated session has.
 *
 * WHY IT EXISTS. The manager used to be created inside `useUploadManager`, which meant its
 * lifetime was the lifetime of whichever page happened to be mounted — and its cleanup ran
 * `destroy()`, aborting every in-flight PUT. Navigating `/albums/new → /albums/[id]/build`
 * therefore threw away the queue mid-batch: the wizard's manager was destroyed and the builder
 * got a fresh, empty one. Uploads could not outlive the page that started them.
 *
 * Phase 0 established the fact this design rests on: `(app)/layout.tsx` is NOT remounted by that
 * navigation (same React instance across the transition). A manager owned here therefore survives
 * it, and the upload keeps running while the customer moves into the builder.
 *
 * OWNERSHIP, NOT IMPLEMENTATION. The engine is untouched. `manager.ts` has no React import and
 * keeps its queue, scheduler, concurrency control, blob/File lifecycle and network contract
 * exactly as they were; this file only decides WHO holds the instance and for HOW LONG.
 *
 * NOT A SINGLETON. The instance lives in a provider-scoped ref, not module scope, so it is
 * created per provider mount rather than per module evaluation — it never exists in the server
 * bundle, it is collected with the tree when the authenticated area unmounts, and tests can
 * mount independent providers.
 */

/**
 * The manager accepts its lifecycle callbacks ONCE, at construction — but the provider now
 * constructs it before any upload surface exists, so a surface cannot supply them that way.
 *
 * Rather than adding a setter to the framework-free engine, the provider owns the indirection:
 * it passes permanent fan-out closures at construction and keeps the live subscriber set here.
 * `manager.ts` is therefore completely unchanged.
 *
 * A SET rather than a single slot because the wizard and the builder are both briefly mounted
 * during a route transition — exactly the moment this phase is about. Each subscriber keeps its
 * own photo list, so delivering to both is correct (when they are the same album), and each
 * deregisters on unmount so no unmounted closure is retained.
 */
type UploadHandlers = {
  onQueued?: (info: QueuedUpload) => void;
  /**
   * Returns TRUE only if this surface actually took ownership of `info.localUrl` — i.e. it held
   * an optimistic photo under `tempPhotoId` and stored the blob on it. See ADOPTION below; the
   * return value is the entire ownership handshake.
   */
  onConfirmed?: (info: ConfirmedUpload) => boolean | void;
  onDiscarded?: (info: DiscardedUpload) => void;
  onMetadata?: (info: ExtractedMetadata) => void;
};

/** One mounted upload surface: the album it speaks for, and the callbacks it wants. */
type Subscriber = { albumId: string | null; handlers: UploadHandlers };

type UploadContextValue = {
  manager: UploadManager;
  /**
   * Subscribe an album-SCOPED surface to lifecycle callbacks. Returns an unsubscribe.
   *
   * `albumId` is the isolation boundary: this subscriber is delivered events for that album and
   * nothing else. A `null` album (the wizard before its album exists) receives nothing, which is
   * correct — there is no album for a photo to belong to yet.
   */
  registerHandlers: (albumId: string | null, handlers: UploadHandlers) => () => void;
};

const UploadContext = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  /**
   * The live subscriber set, and the one manager.
   *
   * Both are refs created on first render. StrictMode double-renders this component in
   * development; the `=== null` guard means the second render reuses the first instance, so
   * there is exactly ONE manager, one queue and one scheduler either way.
   *
   * A ref rather than `useState(() => …)` because nothing about the manager belongs in the
   * render cycle: consumers subscribe through `useSyncExternalStore`, so its identity never
   * needs to trigger a re-render.
   */
  const subsRef = useRef<Set<Subscriber> | null>(null);
  if (subsRef.current === null) subsRef.current = new Set();
  const subs = subsRef.current;

  const managerRef = useRef<UploadManager | null>(null);
  if (managerRef.current === null) {
    /**
     * THE ALBUM ISOLATION BOUNDARY — the single place an upload event is matched to a surface.
     *
     * Every callback payload carries a `taskId`, and every `UploadTask` carries the `albumId`
     * it was enqueued with, so the event's album is looked up from the ENGINE'S OWN task record
     * rather than trusted from the payload or guessed from the current route. That matters
     * because only `QueuedUpload` carries `albumId` directly; deriving it uniformly means
     * confirm / metadata / discard are scoped by exactly the same rule as queue, with no
     * per-event special cases and no change to the manager's event definitions.
     *
     * Ordering makes the lookup safe: the manager patches its task list BEFORE invoking each of
     * these callbacks (enqueue appends before `onQueued`; `run` patches to `processing` before
     * `onConfirmed`; `cancel` patches to `cancelled` before `onDiscarded`; `measure` reads a live
     * task before `onMetadata`), so the task is always present when we resolve it.
     *
     * FAIL CLOSED. An unresolvable album delivers to nobody. Silence is recoverable; leaking one
     * album's photo into another album's layout is not.
     */
    const albumOfTask = (taskId: string): string | null =>
      managerRef.current?.getSnapshot().find((t) => t.id === taskId)?.albumId ?? null;

    const fanOut = <K extends keyof UploadHandlers>(key: K) =>
      (info: Parameters<NonNullable<UploadHandlers[K]>>[0]) => {
        const album = albumOfTask(info.taskId);
        if (album === null) return;
        // Snapshot first: a handler may unmount its host and mutate the set mid-iteration.
        for (const sub of Array.from(subs)) {
          if (sub.albumId !== album) continue;
          try {
            (sub.handlers[key] as ((arg: typeof info) => void) | undefined)?.(info);
          } catch {
            // One misbehaving surface must never break the scheduler — same contract as
            // the manager's own event emitter.
          }
        }
      };
    /**
     * ADOPTION — the ownership handshake for a confirmed preview.
     *
     * At confirm the manager hands the blob URL out and clears its OWN reference, so from that
     * instant the URL has no owner unless a surface takes it. Mere subscription is not proof of
     * that: a builder mounted after `onQueued` is subscribed and album-matched, yet holds no
     * photo under `tempPhotoId`, so its `.map` matches nothing and the URL is silently dropped.
     * That is exactly how 7 of 10 previews were left live and unreachable.
     *
     * So a surface must SAY it adopted, by returning true — which it can only do honestly if it
     * actually stored the blob on a photo it holds.
     *
     * EXACTLY ONE OWNER. The event still reaches every same-album subscriber (they all need the
     * id remap), but only the first that can adopt is offered the URL; everyone after it is
     * handed `localUrl: null`. Two surfaces can therefore never both believe they own the blob,
     * which would let the first one's cleanup revoke a URL the second is still displaying.
     *
     * NOBODY ADOPTED ⇒ REVOKE HERE. The provider owns the manager, and this is the boundary the
     * URL crosses, so releasing it here keeps `manager.ts` untouched while still guaranteeing the
     * contract: a confirmed preview is either adopted by exactly one consumer, or revoked.
     */
    const confirmedFanOut = (info: ConfirmedUpload) => {
      const album = albumOfTask(info.taskId);
      if (album === null) {
        // Fail closed, but never silently: an unattributable preview still has to be released.
        revokeLocalPreview(info.localUrl);
        return;
      }
      let claimed = false;
      for (const sub of Array.from(subs)) {
        if (sub.albumId !== album) continue; // cross-album adoption is impossible by construction
        try {
          const offer = claimed ? { ...info, localUrl: null } : info;
          if (sub.handlers.onConfirmed?.(offer) === true && !claimed) claimed = true;
        } catch {
          // A throwing surface must not strand the URL — `claimed` stays false, so it is revoked.
        }
      }
      if (!claimed) revokeLocalPreview(info.localUrl);
    };

    managerRef.current = new UploadManager({
      onQueued: fanOut('onQueued'),
      onConfirmed: confirmedFanOut,
      onDiscarded: fanOut('onDiscarded'),
      onMetadata: fanOut('onMetadata'),
    });
  }
  const manager = managerRef.current;

  /**
   * THE SESSION BOUNDARY — the one place the manager may legitimately be torn down.
   *
   * `activate()` re-arms the manager's `destroyed` flag; it creates nothing, starts nothing and
   * registers no listener, so running it again is a no-op.
   *
   * `destroy()` belongs HERE and nowhere else. A consumer unmounting is a page change, and
   * destroying there is exactly the bug this phase removed. This provider unmounts only when the
   * authenticated `(app)` tree does — signing out (`signOut` redirects to `/`, outside the group)
   * or otherwise leaving the app scope. That genuinely ends the upload session, and continuing to
   * push a signed-out user's files to R2 would be wrong, so the aborts and preview revocations
   * are correct at that moment.
   *
   * STRICTMODE. React's development mount→unmount→mount runs this cleanup once on first mount.
   * That is safe by timing, not by luck: the provider is above every upload surface, so at its
   * first mount no file has been picked, nothing is queued and no XHR exists — `destroy()` has
   * nothing to tear down, and `activate()` re-arms the flag on the immediate remount. (Verified
   * in dev: uploads started after that cycle run normally and survive navigation.)
   *
   * It does NOT weaken the navigation guarantee: Phase 0 established that `(app)/layout.tsx`
   * survives /albums/new → /albums/[id]/build, so this cleanup cannot fire on that transition.
   */
  useEffect(() => {
    manager.activate();
    return () => manager.destroy();
  }, [manager]);

  /**
   * UNLOAD PROTECTION (Phase 6) — warn before the DOCUMENT goes away with uploads still running.
   *
   * WHY HERE. The manager is session-scoped and lives above every upload surface, so the guard
   * follows the uploads across /albums/new → /albums/[id]/build exactly as the uploads themselves
   * do. Putting it in a page would mean the wizard — the surface where bulk uploading actually
   * happens, and which had no guard at all — kept losing queues silently.
   *
   * WHAT COUNTS. `inFlight` = queued + uploading: work that exists ONLY in this tab. `processing`
   * is deliberately excluded — those photos already have server rows and survive a reload, so
   * warning about them would be false. A task waiting out a retry backoff stays `queued`, so it
   * is correctly covered.
   *
   * SCOPE. `beforeunload` does not fire on SPA navigation, so route changes are unaffected by
   * construction. The builder's own dirty-layout guard is a separate listener answering a
   * separate question; both may be attached, and the browser still shows one dialog.
   *
   * The listener is ATTACHED ONLY WHILE NEEDED rather than always-on-and-conditional, so an idle
   * session leaves no handler on the page (and cannot suppress the bfcache for no reason).
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let attached = false;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      record('upload.unload.warned', 1);
      event.preventDefault();
      // Legacy spelling — still required by some browsers to actually show the prompt.
      event.returnValue = '';
    };

    const sync = () => {
      const needed = manager.getStats().inFlight > 0;
      if (needed === attached) return;
      if (needed) window.addEventListener('beforeunload', onBeforeUnload);
      else window.removeEventListener('beforeunload', onBeforeUnload);
      attached = needed;
    };

    sync();
    // The manager emits on every real transition, which is exactly when `inFlight` can change.
    const unsubscribe = manager.subscribe(sync);
    return () => {
      unsubscribe();
      if (attached) window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [manager]);

  const value = useMemo<UploadContextValue>(
    () => ({
      manager,
      registerHandlers: (albumId: string | null, handlers: UploadHandlers) => {
        // A fresh record per registration, so two surfaces on the same album are distinct
        // subscribers and unsubscribing one never removes the other.
        const sub: Subscriber = { albumId, handlers };
        subs.add(sub);
        return () => {
          subs.delete(sub);
        };
      },
    }),
    [manager, subs],
  );

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

/**
 * The session's upload context. Throws when used outside the provider — a missing provider is a
 * wiring mistake that would otherwise degrade silently into "uploads don't persist", which is
 * exactly the bug this phase removes.
 */
export function useUploadContext(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (ctx === null) {
    throw new Error('useUploadManager must be used inside <UploadProvider> (mounted in (app)/layout.tsx).');
  }
  return ctx;
}
