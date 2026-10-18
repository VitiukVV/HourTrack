import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * sessionStorage key for the persisted active-card-id slice. Exported so tests
 * can introspect/clear it without re-hardcoding the literal.
 */
export const ACTIVE_CARD_STORAGE_KEY = 'hourtrack:active-card' as const;

/**
 * Tracks which Card is currently "active" — meaning subsequent calendar-day
 * clicks should create/delete entries for that card (S05 / S06 will hook this
 * up).
 *
 * Persistence is intentionally `sessionStorage`, NOT `localStorage`: per
 * PROJECT_PLAN.md and the v3 plan interpretation, opening a new browser tab
 * should start with no card active, but in-tab navigation (`/` → `/reports` →
 * back) must preserve it. sessionStorage gives us exactly that behaviour.
 *
 * Surface (intentionally minimal — referenced by S05 day-click flow):
 *   - `activeCardId`        — `string | null`
 *   - `setActiveCardId(id)` — set the active card
 *   - `clearActive()`       — clear (equivalent to `setActiveCardId(null)`)
 *   - `toggleActive(id)`    — set if different, clear if same (UI helper)
 */
export interface ActiveCardState {
  activeCardId: string | null;
  setActiveCardId: (id: string | null) => void;
  clearActive: () => void;
  toggleActive: (id: string) => void;
}

export const useActiveCardStore = create<ActiveCardState>()(
  persist(
    (set, get) => ({
      activeCardId: null,
      setActiveCardId: (id) => set({ activeCardId: id }),
      clearActive: () => set({ activeCardId: null }),
      toggleActive: (id) => {
        const current = get().activeCardId;
        set({ activeCardId: current === id ? null : id });
      },
    }),
    {
      name: ACTIVE_CARD_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      // Only persist the id; the actions are derived from the store factory.
      partialize: (state) => ({ activeCardId: state.activeCardId }),
    },
  ),
);
