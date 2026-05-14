import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { SettingsSection } from './SettingsSection';

/**
 * Google Calendar section placeholder for S08. Real Calendar wiring lands in
 * S12 (create/update/cascade-delete + bulk PATCH + re-sync). We render the
 * section as a disabled scaffold so the Settings layout is final from day
 * one.
 */
export function CalendarSection() {
  const { t } = useTranslation();
  return (
    <SettingsSection
      title={t('settings.calendar.title')}
      testId="settings-calendar"
      subtitle={t('settings.calendar.subtitle')}
    >
      <p className="text-muted-foreground text-sm" data-testid="settings-calendar-status">
        {t('settings.calendar.notConnected')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          title={t('settings.calendar.signInRequired')}
        >
          {t('settings.calendar.resync')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          title={t('settings.calendar.signInRequired')}
        >
          {t('settings.calendar.disconnect')}
        </Button>
      </div>
    </SettingsSection>
  );
}
