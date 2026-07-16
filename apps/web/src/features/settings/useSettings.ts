import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { Settings } from '@hourtrack/shared-types';

import { db, getSettings, updateSettings } from '@/lib/db';
import { getSyncManager } from '@/features/sync/SyncManager';

/**
 * TanStack Query hooks for the singleton Settings row.
 *
 * Query key: `['settings']`. There is only ever one Settings row (Dexie store
 * `settings: 'key'` with literal key `'current'` — see `queries.ts:initDB`),
 * so we don't parameterize the key.
 *
 * The S04 `useDefaultViewSync` hook predates this file and uses the same
 * `['settings']` key directly — leaving both shapes intact preserves cache
 * compatibility; this hook merely adds a typed surface on top.
 *
 * Mutation invalidates the `['settings']` key so consumers (`ThemeManager`,
 * `InterfaceSection`, etc.) re-render with the new value automatically.
 *
 * S29 (UR-29-4): the mutation also enqueues a `pushDataJson` op — the same
 * way `useCards` / `useEntries` do — so a preference change syncs to Drive on
 * its own, without waiting for the user to also edit a card or entry.
 * `SyncManager.enqueue` no-ops for anonymous users, so this is safe offline
 * and while signed out.
 */

const SETTINGS_KEY = ['settings'] as const;

export function useSettingsQuery(): UseQueryResult<Settings | null> {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => getSettings(db),
    // S23 Task 27 — Settings is a singleton row that only changes via the
    // explicit `useUpdateSettingsMutation` in this same file (which writes
    // through `setQueryData` and invalidates the key, forcing a refresh).
    // Without `staleTime: Infinity`, every component that mounts the hook
    // (ThemeManager, InterfaceSection, useDefaultViewSync, AboutSection,
    // several settings subsections) refetches after the 30s default — for
    // a row that never changes silently. The mutation's invalidate still
    // pulls a fresh read whenever a setting actually changes.
    staleTime: Infinity,
  });
}

export function useUpdateSettingsMutation(): UseMutationResult<Settings, Error, Partial<Settings>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => updateSettings(db, patch),
    onSuccess: (next) => {
      // Optimistically update the cache so consumers don't flicker through a
      // brief loading state on every toggle. TanStack still refetches in the
      // background via the invalidate below.
      qc.setQueryData(SETTINGS_KEY, next);
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY });
      // S29 — push the settings change to Drive. `pushDataJson` rebuilds the
      // whole snapshot from Dexie, so the just-written row is captured; no
      // per-field payload needed.
      void getSyncManager()
        .enqueue({ op: 'pushDataJson' })
        .catch((err: unknown) => {
          console.warn('[useSettings] settings sync enqueue failed:', err);
        });
    },
  });
}
