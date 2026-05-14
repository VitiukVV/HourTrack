import { useTranslation } from 'react-i18next';

import { useSettingsQuery } from '@/features/settings/useSettings';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date';

import { getSyncManager } from './SyncManager';
import { useSyncStatus } from './useSyncStatus';

/**
 * Compact header indicator for the SyncManager status.
 *
 * Visual:
 *   - 'idle'    -> small solid green dot (no spinner)
 *   - 'syncing' -> animated yellow spinner
 *   - 'error'   -> small solid red dot
 *   - 'offline' -> small solid gray dot
 *
 * Title attribute carries the localized status string + `lastSyncAt` for
 * hover tooltip. Click triggers `flushNow()` to retry — useful when the
 * last attempt errored.
 */
export function SyncIndicator() {
  const { t } = useTranslation();
  const { status, lastError } = useSyncStatus();
  const settingsQuery = useSettingsQuery();

  const lastSyncAt = settingsQuery.data?.lastSyncAt ?? null;
  const lastSyncLabel = lastSyncAt
    ? t('sync.lastSync', { date: formatDate(lastSyncAt) })
    : t('sync.lastSyncNever');

  const statusLabel = (() => {
    switch (status) {
      case 'syncing':
        return t('sync.status.syncing');
      case 'error':
        return t('sync.status.error');
      case 'offline':
        return t('sync.status.offline');
      default:
        return t('sync.status.synced');
    }
  })();

  const tooltip = [statusLabel, lastSyncLabel, lastError].filter(Boolean).join(' • ');

  const handleClick = () => {
    void getSyncManager().flushNow();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={tooltip}
      aria-label={statusLabel}
      data-testid="sync-indicator"
      data-status={status}
      className="hover:bg-accent inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors"
    >
      {status === 'syncing' ? (
        <span
          aria-hidden="true"
          className="border-muted-foreground border-t-foreground inline-block h-3 w-3 animate-spin rounded-full border-2"
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-2.5 w-2.5 rounded-full',
            status === 'idle' && 'bg-emerald-500',
            status === 'error' && 'bg-red-500',
            status === 'offline' && 'bg-muted-foreground',
          )}
        />
      )}
    </button>
  );
}
