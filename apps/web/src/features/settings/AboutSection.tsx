import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/authContext';

import { SettingsSection } from './SettingsSection';

/**
 * About section. Displays the app version (defined at build time via Vite
 * `define`) and the granted Google scopes once the user is signed in (S09).
 *
 * Scope-to-label mapping is kept here so the user sees a friendly description
 * rather than the raw URL. If S10 / S12 add new scopes, extend the map
 * accordingly.
 */
declare const __APP_VERSION__: string | undefined;

const SCOPE_LABEL_KEYS: Record<string, string> = {
  openid: 'settings.about.scopeLabels.openid',
  email: 'settings.about.scopeLabels.email',
  profile: 'settings.about.scopeLabels.profile',
  'https://www.googleapis.com/auth/calendar.app.created':
    'settings.about.scopeLabels.calendarAppCreated',
  'https://www.googleapis.com/auth/drive.appdata': 'settings.about.scopeLabels.driveAppdata',
};

export function AboutSection() {
  const { t } = useTranslation();
  const { tokens } = useAuth();
  const version =
    typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0 ? __APP_VERSION__ : 'dev';

  const grantedScopes: string[] = tokens?.scope
    ? tokens.scope.split(/\s+/).filter((s) => s.length > 0)
    : [];

  return (
    <SettingsSection title={t('settings.about.title')} testId="settings-about">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('settings.about.version')}</span>
        <span className="text-muted-foreground text-sm" data-testid="settings-about-version">
          {version}
        </span>
      </div>
      <div className="flex flex-col gap-1.5" data-testid="settings-about-scopes">
        <span className="text-sm font-medium">{t('settings.about.scopes')}</span>
        {grantedScopes.length === 0 ? (
          <span className="text-muted-foreground text-sm">
            {t('settings.about.scopesNotSignedIn')}
          </span>
        ) : (
          <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
            {grantedScopes.map((scope) => {
              const labelKey = SCOPE_LABEL_KEYS[scope];
              const label = labelKey ? t(labelKey) : scope;
              return (
                <li key={scope} data-testid={`scope-${scope}`}>
                  <span className="font-mono text-xs">{scope}</span>
                  <span className="mx-1 text-xs">--</span>
                  <span>{label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SettingsSection>
  );
}
