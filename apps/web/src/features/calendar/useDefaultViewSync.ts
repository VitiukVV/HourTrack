import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import { db, getSettings } from '@/lib/db';

import { CALENDAR_VIEW_STORAGE_KEY, useCalendarView } from './calendarStore';

/**
 * One-shot synchronization between persisted `Settings.defaultView` and the
 * in-memory `useCalendarView.mode`. Runs once per app load (per tab session):
 * if the session-scoped store has NOT yet been touched by the user, we adopt
 * the value persisted to Settings so the calendar opens in the user's chosen
 * default. Subsequent in-tab navigation preserves the user's runtime toggles
 * (the sessionStorage layer takes over).
 *
 * "Has the user touched the store yet?" → we treat the existence of a
 * sessionStorage key as "yes". The key only appears after the first state
 * write via the persist middleware, so a fresh tab has no key and we sync
 * from Settings.
 */
export function useDefaultViewSync() {
  const syncedRef = useRef(false);
  const setMode = useCalendarView((s) => s.setMode);

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => getSettings(db),
  });

  useEffect(() => {
    if (syncedRef.current) return;
    if (!settingsQuery.data) return;
    // Only adopt the default if the user hasn't interacted with the view yet
    // in this tab session. The persist middleware writes the key on first
    // store mutation; until then, the slot is empty.
    const hasSessionOverride =
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(CALENDAR_VIEW_STORAGE_KEY) !== null;
    if (!hasSessionOverride) {
      setMode(settingsQuery.data.defaultView);
    }
    syncedRef.current = true;
  }, [settingsQuery.data, setMode]);
}
