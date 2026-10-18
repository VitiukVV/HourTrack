import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { usePwaUpdate } from '@/features/pwa/usePwaUpdate';

import { SettingsSection } from './SettingsSection';

/**
 * About section. Displays the app version, defined at build time via Vite
 * `define` (falls back to `'dev'` when the constant is absent — e.g. Vitest
 * runs).
 *
 * It also carries the second, non-dismissible half of the service-worker
 * update prompt: `updatePrompt.ts` shows a toast when a new build is waiting,
 * but a toast is a one-shot — swipe it away and the installed PWA keeps
 * running the old build until every tab is closed. This row stays for as long
 * as the update is actually waiting.
 */
declare const __APP_VERSION__: string | undefined;

export function AboutSection() {
  const { t } = useTranslation();
  const waiting = usePwaUpdate((s) => s.waiting);
  const apply = usePwaUpdate((s) => s.apply);
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

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('settings.about.updateTitle')}</span>
        <span className="text-muted-foreground text-sm" data-testid="settings-about-update-status">
          {waiting ? t('settings.about.updateAvailable') : t('settings.about.upToDate')}
        </span>
        {waiting && (
          <Button
            type="button"
            size="sm"
            className="w-fit"
            onClick={apply}
            data-testid="settings-about-update-apply"
          >
            {t('settings.about.updateApply')}
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}
