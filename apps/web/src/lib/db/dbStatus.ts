import { create } from 'zustand';

/**
 * "The database stopped answering, and here is why."
 *
 * Both cases are two tabs disagreeing about the schema version: either another
 * tab is upgrading and this connection had to close (`versionchange`), or this
 * tab wants to upgrade and an older one is holding the previous version open
 * (`blocked`). Either way every query goes quiet — and a quiet app is
 * indistinguishable from one that never finished loading, which is exactly how
 * this used to present (`main.tsx` only logged the failure to the console).
 *
 * Ported from my-diary (`src/lib/db/dbStatus.ts`).
 */
export type DbInterruption = 'versionchange' | 'blocked';

interface DbStatusState {
  interruption: DbInterruption | null;
  set: (reason: DbInterruption) => void;
  /** Test-only reset — the real app recovers by reloading the page. */
  reset: () => void;
}

export const useDbStatus = create<DbStatusState>((set) => ({
  interruption: null,
  // First reason wins: a second one is a consequence of the first and would
  // only rewrite the message under the user mid-read.
  set: (reason) => set((s) => (s.interruption ? s : { interruption: reason })),
  reset: () => set({ interruption: null }),
}));

/** Called from the Dexie lifecycle handlers in `schema.ts`. */
export function dbInterrupted(reason: DbInterruption): void {
  useDbStatus.getState().set(reason);
}
