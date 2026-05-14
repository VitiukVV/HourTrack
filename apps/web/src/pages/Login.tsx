import { useTranslation } from 'react-i18next';

export function LoginPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="border-border bg-card text-card-foreground w-full max-w-sm rounded-lg border p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">{t('app.title')}</h1>
        <p className="text-muted-foreground text-sm" data-testid="page-marker">
          {t('pages.login')}
        </p>
      </div>
    </div>
  );
}
