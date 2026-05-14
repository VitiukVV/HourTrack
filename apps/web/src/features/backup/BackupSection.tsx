import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { useSettingsQuery, useUpdateSettingsMutation } from '@/features/settings/useSettings';
import { useAuth } from '@/features/auth/authContext';
import { formatDate } from '@/lib/date';
import { db } from '@/lib/db';
import { SCOPE_DRIVE_APPDATA } from '@/lib/google/config';

import { BackupErrorBanner } from './BackupErrorBanner';
import { RestoreModal } from './RestoreModal';
import { createBackup, type BackupFile } from './backupService';
import { exportAllEntriesAsCsv } from './exportAllCsv';
import { useBackupsList, useInvalidateBackupsList } from './useBackupsList';

/**
 * Backup section — replaces `DataSection`'s S08 stub.
 *
 * Composition:
 * - Status caption: `Last backup: {DD.MM.YYYY HH:mm}` resolved from
 *   `Settings.lastBackupAt`. Pulls the time component from the ISO string.
 *   (S08 followup: replace raw ISO render with formatted date + time.)
 * - "Create backup now" button — calls `createBackup` directly.
 * - Auto-backup toggle + interval input (1..30 days, default 3).
 * - Snapshot list — expandable area listing every file in `backups/`,
 *   newest-first. Each row has a Restore button.
 * - "Export CSV (all data)" — wired to `exportAllEntriesAsCsv`.
 * - Error banner — surfaces the last backup failure with a Retry button.
 *
 * Auth gating:
 * - Requires `useAuth().status === 'authed'` AND
 *   `tokens.scope.includes(SCOPE_DRIVE_APPDATA)` for every Drive operation.
 *   When not authed, the section shrinks to a "Sign in to enable" caption +
 *   the still-working CSV export.
 */
export function BackupSection() {
  const { t } = useTranslation();
  const { status, tokens } = useAuth();
  const accessToken = tokens?.accessToken ?? null;
  const grantedScopes = tokens?.scope ?? null;
  const hasDriveScope =
    grantedScopes != null && grantedScopes.split(' ').includes(SCOPE_DRIVE_APPDATA);

  const settingsQuery = useSettingsQuery();
  const updateSettings = useUpdateSettingsMutation();
  const backupsListQuery = useBackupsList();
  const invalidateBackups = useInvalidateBackupsList();

  const [busy, setBusy] = useState(false);
  const [lastBackupError, setLastBackupError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupFile | null>(null);

  const settings = settingsQuery.data;
  const lastBackupAt = settings?.lastBackupAt ?? null;
  const autoBackupEnabled = settings?.autoBackupEnabled ?? true;
  const autoBackupIntervalDays = settings?.autoBackupIntervalDays ?? 3;
  const canRestore = lastBackupAt != null;

  const lastBackupLabel = (() => {
    if (!lastBackupAt) return t('backup.noBackups');
    const dt = new Date(lastBackupAt);
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return t('backup.lastBackup', { date: `${formatDate(dt)} ${hh}:${mm}` });
  })();

  const requireDriveAuth = (): { accessToken: string } | null => {
    if (status !== 'authed' || !accessToken || !hasDriveScope) {
      toast.error(t('backup.signInRequired'));
      return null;
    }
    return { accessToken };
  };

  const handleCreateBackup = async () => {
    const auth = requireDriveAuth();
    if (!auth) return;
    setBusy(true);
    setLastBackupError(null);
    try {
      await createBackup({
        accessToken: auth.accessToken,
        database: db,
      });
      toast.success(t('backup.backupSuccess'));
      invalidateBackups();
      // Re-read Settings so the lastBackupAt caption refreshes.
      void settingsQuery.refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[BackupSection] createBackup failed:', msg);
      setLastBackupError(msg);
      toast.error(t('backup.backupError'));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleAutoBackup = (next: boolean) => {
    updateSettings.mutate({ autoBackupEnabled: next });
  };

  const handleIntervalChange = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(30, Math.max(1, parsed));
    updateSettings.mutate({ autoBackupIntervalDays: clamped });
  };

  const handleExportCsv = async () => {
    try {
      const { entryCount } = await exportAllEntriesAsCsv(db);
      if (entryCount === 0) {
        toast.message(t('backup.exportEmpty'));
        return;
      }
      toast.success(t('backup.exportSuccess'));
    } catch (err) {
      console.error('[BackupSection] export csv failed:', err);
      toast.error(t('backup.exportFailed'));
    }
  };

  const handleOpenRestore = (file: BackupFile) => {
    setRestoreTarget(file);
  };

  const handleRestoreComplete = () => {
    // Full reload so every in-memory cache + zustand store re-hydrates from
    // the restored Dexie state. NO partial invalidation — restore is meant
    // to be a hard reset.
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <SettingsSection
      title={t('settings.data.title')}
      testId="settings-data"
      subtitle={t('settings.data.subtitle')}
    >
      <BackupErrorBanner
        error={lastBackupError}
        onRetry={() => void handleCreateBackup()}
        busy={busy}
      />

      <div className="flex flex-col gap-1.5" data-testid="settings-data-backup-status">
        <span className="text-sm font-medium">{t('settings.data.backupStatus')}</span>
        <span className="text-muted-foreground text-sm">{lastBackupLabel}</span>
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void handleCreateBackup()}
            disabled={busy || status !== 'authed' || !hasDriveScope}
            data-testid="settings-data-create-backup"
          >
            {busy ? (
              <>
                <Loader2 className="animate-spin" aria-hidden /> {t('common.loading')}
              </>
            ) : (
              t('backup.createBackupNow')
            )}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2" data-testid="settings-data-auto-backup">
        <div className="flex items-center gap-2">
          <Switch
            id="settings-data-auto-backup-toggle"
            checked={autoBackupEnabled}
            onCheckedChange={handleToggleAutoBackup}
            aria-label={t('backup.autoBackup')}
          />
          <label htmlFor="settings-data-auto-backup-toggle" className="text-sm">
            {t('backup.autoBackup')}
          </label>
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="settings-data-auto-backup-interval"
            className="text-muted-foreground text-xs"
          >
            {t('backup.intervalDays')}
          </label>
          <Input
            id="settings-data-auto-backup-interval"
            type="number"
            min={1}
            max={30}
            value={autoBackupIntervalDays}
            onChange={(e) => handleIntervalChange(e.target.value)}
            className="w-20"
            data-testid="settings-data-auto-backup-interval"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2" data-testid="settings-data-snapshots">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('backup.snapshots')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowList((v) => !v)}
            disabled={!canRestore || status !== 'authed' || !hasDriveScope}
            data-testid="settings-data-snapshots-toggle"
          >
            {showList ? t('common.cancel') : t('backup.restore')}
          </Button>
        </div>
        {showList && (
          <SnapshotsList
            isLoading={backupsListQuery.isLoading}
            files={backupsListQuery.data ?? []}
            onRestore={handleOpenRestore}
            disabled={status !== 'authed' || !hasDriveScope}
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('backup.exportAllCsv')}</span>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleExportCsv()}
            data-testid="settings-data-export-csv"
          >
            {t('backup.exportAllCsv')}
          </Button>
        </div>
      </div>

      <RestoreModal
        open={restoreTarget != null}
        file={restoreTarget}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        onRestoreComplete={handleRestoreComplete}
      />
    </SettingsSection>
  );
}

interface SnapshotsListProps {
  isLoading: boolean;
  files: BackupFile[];
  onRestore: (file: BackupFile) => void;
  disabled: boolean;
}

function SnapshotsList({ isLoading, files, onRestore, disabled }: SnapshotsListProps) {
  const { t } = useTranslation();
  if (isLoading) {
    return <span className="text-muted-foreground text-xs">{t('common.loading')}</span>;
  }
  if (files.length === 0) {
    return (
      <span className="text-muted-foreground text-xs" data-testid="settings-data-snapshots-empty">
        {t('backup.noBackups')}
      </span>
    );
  }
  return (
    <ul
      className="border-border divide-border flex max-h-64 flex-col divide-y overflow-y-auto rounded-md border"
      data-testid="settings-data-snapshots-list"
    >
      {files.map((f) => {
        // Parse the date out of the filename for display.
        const m = f.name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})/);
        const label = m ? `${formatDate(m[1]!)} ${m[2]}:${m[3]}` : f.name;
        return (
          <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="text-sm">
              {label}
              {f.isPreRestore && (
                <span className="text-muted-foreground ml-2 text-xs">(pre-restore)</span>
              )}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onRestore(f)}
              disabled={disabled}
              data-testid={`settings-data-snapshot-restore-${f.id}`}
            >
              {t('backup.restore')}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
