import { useTranslation } from 'react-i18next';

export function ReportsPage() {
  const { t } = useTranslation();
  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">{t('nav.reports')}</h1>
      <p className="text-muted-foreground mt-2 text-sm" data-testid="page-marker">
        {t('pages.reports')}
      </p>
    </section>
  );
}
