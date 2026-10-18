import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

export interface BackupErrorBannerProps {
  /** Last error message — banner renders only when truthy. */
  error: string | null;
  /** Retry callback invoked when the user clicks the Retry button. */
  onRetry: () => void;
  /** Disable the retry button while a retry is in flight. */
  busy?: boolean;
}

/**
 * Inline error banner shown above the backup controls when the last backup
 * attempt failed (quota exceeded, network, etc.). Includes a Retry button
 * that the parent wires to the same handler used by "Create backup now".
 *
 * Stateless on purpose: the parent (`BackupSection`) is the source of truth
 * for the last error so the banner can also clear itself when a retry
 * succeeds.
 */
export function BackupErrorBanner({ error, onRetry, busy }: BackupErrorBannerProps) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <div
      role="alert"
      data-testid="backup-error-banner"
      className="border-destructive/50 bg-destructive/10 text-destructive flex items-start justify-between gap-3 rounded-md border p-3 text-sm"
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{t('backup.backupError')}</span>
        <span className="opacity-80">{error}</span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onRetry}
        disabled={busy}
        data-testid="backup-error-banner-retry"
      >
        {t('backup.retry')}
      </Button>
    </div>
  );
}
