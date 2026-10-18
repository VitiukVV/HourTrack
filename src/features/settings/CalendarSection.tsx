import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useAuth } from '@/features/auth/authContext';
import { ResyncModal } from '@/features/calendar-sync/ResyncModal';
import { enqueueSync } from '@/features/sync/enqueueSync';
import { SCOPE_CALENDAR_APP_CREATED } from '@/lib/google/config';
import { db, disconnectCalendar } from '@/lib/db';

import { SettingsSection } from './SettingsSection';
import { useSettingsQuery } from './useSettings';

/**
 * Google Calendar section in Settings. Replaces the S08 stub now that S12
 * lands the real CRUD + cascade-delete + bulk PATCH wiring.
 *
 * Branches by auth + scope state:
 *   - anonymous          -> "Sign in with Google" hint (matches other sections)
 *   - authed, no scope   -> re-consent message
 *   - authed, with scope -> connected status, Re-sync All, Disconnect
 *
 * Disconnect intentionally does NOT delete remote events — per locked
 * decision the cascade is one-way (app -> Calendar). Users who want to wipe
 * the HourTrack calendar do so directly in Google Calendar.
 */
export function CalendarSection() {
  const { t } = useTranslation();
  const { status, tokens } = useAuth();
  const settingsQuery = useSettingsQuery();

  const [resyncOpen, setResyncOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const grantedScopes = tokens?.scope ?? '';
  const hasCalendarScope = grantedScopes.split(' ').includes(SCOPE_CALENDAR_APP_CREATED);
  const calendarId = settingsQuery.data?.hourtrackCalendarId ?? null;
  const isAuthed = status === 'authed';
  const isConnected = isAuthed && hasCalendarScope && calendarId != null;

  const disconnectMutation = useMutation({
    // One transaction (spec 007): clear the calendar id (no new ops against
    // the orphaned calendar) AND reset every entry's sync fields (a later
    // reconnect re-syncs from scratch) — or neither. Remote events are NOT
    // deleted — that's the locked safety decision.
    mutationFn: () => disconnectCalendar(db),
    onSuccess: () => {
      toast.success(t('googleCalendar.disconnected'));
      // The cleared calendar id is a settings change: push it to Drive.
      enqueueSync({ op: 'pushDataJson' }, 'CalendarSection');
    },
    onError: (err) => {
      console.error('[CalendarSection] disconnect failed:', err);
      toast.error(t('googleCalendar.disconnectFailed'));
    },
  });

  // Status copy — three branches.
  let statusCopy: string;
  if (!isAuthed) {
    statusCopy = t('googleCalendar.signInRequired');
  } else if (!hasCalendarScope) {
    statusCopy = t('googleCalendar.reconsentRequired');
  } else if (!calendarId) {
    statusCopy = t('googleCalendar.notConnected');
  } else {
    statusCopy = t('googleCalendar.connected', { calendarName: t('googleCalendar.calendarName') });
  }

  return (
    <SettingsSection
      title={t('settings.calendar.title')}
      testId="settings-calendar"
      subtitle={t('settings.calendar.subtitle')}
    >
      <p className="text-muted-foreground text-sm" data-testid="settings-calendar-status">
        {statusCopy}
      </p>

      {isConnected && (
        <p className="text-xs">
          <a
            href={`https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(
              calendarId,
            )}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-2 hover:underline"
            data-testid="settings-calendar-open-link"
          >
            {t('googleCalendar.openInGoogle')}
          </a>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!isAuthed || !hasCalendarScope}
          onClick={() => setResyncOpen(true)}
          data-testid="settings-calendar-resync"
        >
          {t('googleCalendar.resyncAll')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!isConnected || disconnectMutation.isPending}
          onClick={() => setDisconnectOpen(true)}
          data-testid="settings-calendar-disconnect"
        >
          {t('googleCalendar.disconnect')}
        </Button>
      </div>

      <ResyncModal open={resyncOpen} onOpenChange={setResyncOpen} mode="only-errored" />

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={t('googleCalendar.disconnect')}
        body={t('googleCalendar.disconnectConfirm')}
        confirmLabel={t('googleCalendar.disconnectConfirmCta')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => disconnectMutation.mutate()}
      />
    </SettingsSection>
  );
}
