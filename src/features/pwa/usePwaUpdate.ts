import { create } from 'zustand';

interface PwaUpdateState {
  /** A new build finished installing and is waiting to take over. */
  waiting: boolean;
  /** Activates the waiting build and reloads. No-op until one is waiting. */
  apply: () => void;
  markWaiting: (apply: () => void) => void;
}

/**
 * Whether a new build is waiting, so something other than a toast can say so.
 *
 * `registerType: 'prompt'` means the new service worker installs but does not
 * take over until it is told to. If the only invitation to tell it is a toast,
 * dismissing that toast leaves the update sitting there until every tab of the
 * app is closed — which, for an installed PWA, can be never. Settings →
 * "About" reads this store and offers the update for as long as one is
 * actually available.
 *
 * Ported from my-diary (`src/features/pwa/usePwaUpdate.ts`).
 */
export const usePwaUpdate = create<PwaUpdateState>((set) => ({
  waiting: false,
  apply: () => {},
  markWaiting: (apply) => set({ waiting: true, apply }),
}));
