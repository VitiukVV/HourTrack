import { useTranslation } from 'react-i18next';

import { SettingsSection } from './SettingsSection';

/**
 * About section. Displays the app version, defined at build time via Vite
 * `define` (falls back to `'dev'` when the constant is absent — e.g. Vitest
 * runs).
 */
declare const __APP_VERSION__: string | undefined;

export function AboutSection() {
  const { t } = useTranslation();
  const version =
    typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0 ? __APP_VERSION__ : 'dev';

  return (
    <SettingsSection title={t('settings.about.title')} testId="settings-about">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('settings.about.version')}</span>
        <span className="text-muted-foreground text-sm" data-testid="settings-about-version">
          {version}
        </span>
      </div>
    </SettingsSection>
  );
}
