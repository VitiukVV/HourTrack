/**
 * S29 — tiny synchronous event bus for "a Drive snapshot was just applied to
 * the local Dexie state" (bootstrap merge or a 412 pull-merge). Mirrors the
 * `conflictLog` subscriber pattern.
 *
 * Why an emitter instead of threading `queryClient` into the sync layer:
 * `bootstrap` / `SyncManager` live below the React tree and must not import
 * the app-wide `queryClient`. Instead they emit here after `applySnapshot`,
 * and a hook mounted next to the `QueryClientProvider` subscribes and
 * invalidates the affected caches (`['entries']`, `['cards']`, `['settings']`,
 * `['payments']`, `['reminders']`). Without this, data pulled from Drive
 * never reached the UI until a manual reload (S29 Blocker #2 / UR-29-2).
 *
 * The bus carries no payload — subscribers invalidate the fixed set of
 * synced query keys. It is process-local and reset on reload.
 */

type SnapshotAppliedListener = () => void;

const listeners = new Set<SnapshotAppliedListener>();

/** Fire all subscribers. Emitted AFTER a successful `applySnapshot` merge. */
export function emitSnapshotApplied(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A subscriber throwing must not poison siblings or the sync flow.
    }
  }
}

/** Subscribe to snapshot-applied events. Returns the unsubscribe function. */
export function subscribeSnapshotApplied(listener: SnapshotAppliedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only — drop all subscribers. */
export function _resetSnapshotAppliedForTesting(): void {
  listeners.clear();
}
