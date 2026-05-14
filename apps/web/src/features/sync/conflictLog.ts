import type { ConflictRecord } from './lwwMerge';

/**
 * Lightweight in-memory log of LWW conflict resolutions, kept for dev-mode
 * debugging (no UI surface in v1). The log is process-local — wiping it
 * happens automatically on page reload.
 *
 * Why not Dexie: the conflict log is informational and ephemeral. Persisting
 * it would add another store to migrate; a memory ring is plenty for the
 * "what just happened?" use case.
 */

const MAX_ENTRIES = 200;

export interface ConflictLogEntry extends ConflictRecord {
  loggedAt: string;
}

const entries: ConflictLogEntry[] = [];
const listeners = new Set<(snapshot: ConflictLogEntry[]) => void>();

function emit(): void {
  for (const l of listeners) {
    try {
      l([...entries]);
    } catch {
      // Listeners must not throw — swallow.
    }
  }
}

export function recordConflicts(conflicts: ConflictRecord[]): void {
  if (conflicts.length === 0) return;
  const now = new Date().toISOString();
  for (const c of conflicts) {
    entries.push({ ...c, loggedAt: now });
  }
  // Trim front-of-list when we exceed the ring size.
  while (entries.length > MAX_ENTRIES) {
    entries.shift();
  }
  emit();
}

export function getConflictLog(): ConflictLogEntry[] {
  return [...entries];
}

/** Subscribe to log changes. Returns the unsubscribe function. */
export function subscribeConflictLog(listener: (snapshot: ConflictLogEntry[]) => void): () => void {
  listeners.add(listener);
  // Fire immediately with the current snapshot so consumers don't need a
  // separate initial read.
  listener([...entries]);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only — clear the ring. */
export function _resetConflictLog(): void {
  entries.length = 0;
  emit();
}
