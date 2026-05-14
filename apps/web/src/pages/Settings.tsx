import { useTranslation } from 'react-i18next';

export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">{t('nav.settings')}</h1>
      <p className="text-muted-foreground mt-2 text-sm" data-testid="page-marker">
        {t('pages.settings')}
      </p>
    </section>
  );
}
