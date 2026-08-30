import { useTranslation } from 'react-i18next';
import { DatabaseZap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DbInterruption } from '@/lib/db/dbStatus';

/**
 * "Two tabs, two schema versions."
 *
 * Nothing is lost here and nothing is broken — one connection had to close so
 * the other could upgrade, or this one is waiting for an older tab to let go.
 * Both are fixed by reloading, and both used to look exactly like an app that
 * never finished starting.
 *
 * Ported from my-diary (`src/app/DbInterruptedScreen.tsx`).
 */
export function DbInterruptedScreen({ reason }: { reason: DbInterruption }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-testid="db-interrupted-screen"
      className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <div className="bg-muted text-muted-foreground flex h-16 w-16 items-center justify-center rounded-2xl">
        <DatabaseZap className="h-7 w-7" />
      </div>
      <h1 className="text-lg font-semibold">{t('db.interrupted.title')}</h1>
      <p className="text-muted-foreground max-w-xs text-sm">{t(`db.interrupted.${reason}`)}</p>
      <Button
        className="min-w-40"
        onClick={() => window.location.reload()}
        data-testid="db-interrupted-reload"
      >
        {t('db.interrupted.reload')}
      </Button>
    </div>
  );
}
