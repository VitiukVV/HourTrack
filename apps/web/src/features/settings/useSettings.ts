import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import type { Settings } from '@hourtrack/shared-types';

import { db, getSettings, updateSettings } from '@/lib/db';
import { useLiveRead, type LiveRead } from '@/lib/db/useLiveRead';
import { getSyncManager } from '@/features/sync/SyncManager';

/**
 * Hooks for the singleton Settings row (Dexie store `settings: 'key'`, literal
 * key `'current'`).
 *
 * Reads are live (spec 006): every consumer — ThemeManager, InterfaceSection,
 * useDefaultViewSync, AboutSection, the backup captions — re-renders when the
 * row changes, whoever wrote it (this mutation, a sync pull, a backup stamping
 * `lastBackupAt`).
 *
 * S29 (UR-29-4): the mutation also enqueues a `pushDataJson` op — the same
 * way `useCards` / `useEntries` do — so a preference change syncs to Drive on
 * its own, without waiting for the user to also edit a card or entry.
 * `SyncManager.enqueue` no-ops for anonymous users, so this is safe offline
 * and while signed out.
 */

export function useSettingsQuery(): LiveRead<Settings | null> {
  return useLiveRead('settings', () => getSettings(db));
}

export function useUpdateSettingsMutation(): UseMutationResult<Settings, Error, Partial<Settings>> {
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => updateSettings(db, patch),
    onSuccess: () => {
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
