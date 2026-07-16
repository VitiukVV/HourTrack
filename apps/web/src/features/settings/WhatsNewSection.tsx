import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useWhatsNewSeen } from '@/features/whats-new/useWhatsNewSeen';

import { SettingsSection } from './SettingsSection';

/**
 * S30 -- last section on the Settings page. Links to `/whats-new` and shows
 * a small "New" pill while there's a release the user hasn't opened the
 * page since (`useWhatsNewSeen`, localStorage-only -- see that hook's docs
 * for why this isn't a synced Settings field).
 */
export function WhatsNewSection() {
  const { t } = useTranslation();
  const { hasUnseen } = useWhatsNewSeen();

  return (
    <SettingsSection title={t('settings.whatsNew.title')} testId="settings-whats-new">
      <Button asChild variant="outline" className="w-full justify-between">
        <Link to="/whats-new" data-testid="settings-whats-new-link">
          <span>{t('settings.whatsNew.cta')}</span>
          {hasUnseen && (
            <span
              data-testid="settings-whats-new-badge"
              className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs font-medium"
            >
              {t('settings.whatsNew.badge')}
            </span>
          )}
        </Link>
      </Button>
    </SettingsSection>
  );
}
