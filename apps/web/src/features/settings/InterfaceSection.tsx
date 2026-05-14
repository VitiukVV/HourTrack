import { useTranslation } from 'react-i18next';

import type { CalendarView, Theme } from '@hourtrack/shared-types';

import { LanguageSwitcher } from '@/components/LanguageSwitcher';

import { SettingsSection } from './SettingsSection';
import { ToggleGroup, type ToggleOption } from './ToggleGroup';
import { useSettingsQuery, useUpdateSettingsMutation } from './useSettings';

/**
 * Interface section: three controls — Language (delegated to the existing
 * `LanguageSwitcher`), Theme (`system|light|dark`), and Default calendar view
 * (`month|week`).
 *
 * Theme and Default-view changes write directly to `Settings.theme` and
 * `Settings.defaultView` via `useUpdateSettingsMutation`. The Theme change
 * propagates through `ThemeManager` (mounted at App root), which toggles
 * the `dark` class on `<html>`. The Default-view change is consumed by
 * `useDefaultViewSync` on the next tab session.
 *
 * Render is gated on the settings query resolving; while loading we render
 * the controls in a disabled state so layout doesn't jump.
 */
export function InterfaceSection() {
  const { t } = useTranslation();
  const settingsQuery = useSettingsQuery();
  const update = useUpdateSettingsMutation();

  const theme: Theme = settingsQuery.data?.theme ?? 'system';
  const defaultView: CalendarView = settingsQuery.data?.defaultView ?? 'month';
  const ready = settingsQuery.isSuccess;

  const themeOptions: ToggleOption<Theme>[] = [
    { value: 'system', label: t('settings.interface.themeSystem') },
    { value: 'light', label: t('settings.interface.themeLight') },
    { value: 'dark', label: t('settings.interface.themeDark') },
  ];

  const viewOptions: ToggleOption<CalendarView>[] = [
    { value: 'month', label: t('settings.interface.viewMonth') },
    { value: 'week', label: t('settings.interface.viewWeek') },
  ];

  const handleThemeChange = (next: Theme) => {
    void update.mutateAsync({ theme: next });
  };

  const handleViewChange = (next: CalendarView) => {
    void update.mutateAsync({ defaultView: next });
  };

  return (
    <SettingsSection
      title={t('settings.interface.title')}
      testId="settings-interface"
      subtitle={t('settings.interface.subtitle')}
    >
      <div className="flex flex-col gap-2" data-testid="settings-interface-language">
        <span className="text-sm font-medium">{t('settings.interface.language')}</span>
        <LanguageSwitcher />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t('settings.interface.theme')}</span>
        {/* The toggle group itself carries the data-testid so tests can scope */}
        {/* button queries to it without colliding with the section wrapper. */}
        <ToggleGroup<Theme>
          value={theme}
          options={themeOptions}
          onChange={handleThemeChange}
          ariaLabel={t('settings.interface.theme')}
          testId="settings-interface-theme"
        />
        {!ready && <span className="text-muted-foreground text-xs">{t('common.loading')}</span>}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t('settings.interface.defaultView')}</span>
        <ToggleGroup<CalendarView>
          value={defaultView}
          options={viewOptions}
          onChange={handleViewChange}
          ariaLabel={t('settings.interface.defaultView')}
          testId="settings-interface-default-view"
        />
      </div>
    </SettingsSection>
  );
}
