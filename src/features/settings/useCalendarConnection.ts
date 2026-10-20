import { useAuth } from '@/features/auth/authContext';
import { SCOPE_CALENDAR_APP_CREATED } from '@/lib/google/config';

import { useSettingsQuery } from './useSettings';

export interface CalendarConnection {
  isAuthed: boolean;
  hasCalendarScope: boolean;
  calendarId: string | null;
  /** Signed in, Calendar scope granted and the HourTrack calendar exists. */
  isConnected: boolean;
}

/** Google Calendar link state, shared by the Calendar and Notifications sections. */
export function useCalendarConnection(): CalendarConnection {
  const { status, tokens } = useAuth();
  const settingsQuery = useSettingsQuery();

  const hasCalendarScope = (tokens?.scope ?? '').split(' ').includes(SCOPE_CALENDAR_APP_CREATED);
  const calendarId = settingsQuery.data?.hourtrackCalendarId ?? null;
  const isAuthed = status === 'authed';
  return {
    isAuthed,
    hasCalendarScope,
    calendarId,
    isConnected: isAuthed && hasCalendarScope && calendarId != null,
  };
}
