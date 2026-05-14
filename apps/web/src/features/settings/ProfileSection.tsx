import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { SettingsSection } from './SettingsSection';

/**
 * Profile section placeholder for S08. Real Google profile (avatar + email
 * + Logout) lands in S09 once GIS PKCE is wired. We render the section here
 * so the Settings page layout is final from day one — users see the full
 * vertical stack of sections even on the local MVP.
 */
export function ProfileSection() {
  const { t } = useTranslation();
  return (
    <SettingsSection
      title={t('settings.profile.title')}
      testId="settings-profile"
      subtitle={t('settings.profile.subtitle')}
    >
      <p className="text-sm" data-testid="settings-profile-status">
        {t('settings.profile.notLoggedIn')}
      </p>
      <div>
        <Button type="button" variant="outline" size="sm" disabled>
          {t('settings.profile.signInComingSoon')}
        </Button>
      </div>
    </SettingsSection>
  );
}
