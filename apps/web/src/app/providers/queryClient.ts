import { QueryClient } from '@tanstack/react-query';

/**
 * App-wide TanStack Query client. Defaults tuned for HourTrack's data shape:
 * the Dexie queries are local-only and effectively free, so we keep
 * `staleTime` very short and let mutations invalidate the relevant keys.
 *
 * `gcTime` is 5 minutes — long enough that flipping between Calendar /
 * Reports / Settings keeps caches warm, short enough that a forgotten tab
 * doesn't hold an unbounded snapshot.
 *
 * Tests construct their own `QueryClient` per case (see
 * `features/cards/useCards.test.tsx`); this singleton is only used at
 * runtime.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Dexie is local; let invalidations drive refetch.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
