import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { useNotificationStatus } from '@/features/notifications/useNotificationStatus';

import { SettingsSection } from './SettingsSection';
import { useCalendarConnection } from './useCalendarConnection';

/**
 * Settings → Notifications (spec 013). Per-device: the OS permission and the
 * on/off switch both live on this phone. The limit note is always shown —
 * the app can only notify while it is alive, so the closed-app case belongs
 * to the Google Calendar popup (FR-010).
 */
export function NotificationsSection() {
  const { t } = useTranslation();
  const { status, enable, disable, sendTest } = useNotificationStatus();
  const { isConnected: calendarConnected } = useCalendarConnection();

  return (
    <SettingsSection
      title={t('settings.notifications.title')}
      testId="settings-notifications"
      subtitle={t('settings.notifications.subtitle')}
    >
      <p className="text-muted-foreground text-sm" data-testid="settings-notifications-status">
        {t(`settings.notifications.status.${status}`)}
      </p>

      {status === 'blocked' && (
        <p className="text-sm" data-testid="settings-notifications-blocked-hint">
          {t('settings.notifications.blockedHint')}
        </p>
      )}

      {status === 'off' && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void enable()}
            data-testid="settings-notifications-enable"
          >
            {t('settings.notifications.enable')}
          </Button>
        </div>
      )}

      {status === 'on' && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void sendTest()}
            data-testid="settings-notifications-test"
          >
            {t('settings.notifications.test')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={disable}
            data-testid="settings-notifications-disable"
          >
            {t('settings.notifications.disable')}
          </Button>
        </div>
      )}

      <p className="text-muted-foreground text-xs" data-testid="settings-notifications-limit">
        {t(
          calendarConnected
            ? 'settings.notifications.limitCalendar'
            : 'settings.notifications.limitNoCalendar',
        )}
      </p>
    </SettingsSection>
  );
}
