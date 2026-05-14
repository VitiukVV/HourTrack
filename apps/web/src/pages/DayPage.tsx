import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function DayPage() {
  const { t } = useTranslation();
  const { date } = useParams<{ date: string }>();
  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">{t('pages.day')}</h1>
      <p className="text-muted-foreground mt-2 text-sm" data-testid="page-marker">
        {t('pages.day')}
        {date ? ` -- ${date}` : ''}
      </p>
    </section>
  );
}
