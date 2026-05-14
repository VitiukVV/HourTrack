import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { useAllCardsQuery } from '@/features/cards/useCards';
import { buildReportCsv, downloadCsv } from '@/features/reports/exportCsv';
import { db, getEntriesByDateRange } from '@/lib/db';

import { SettingsSection } from './SettingsSection';
import { useSettingsQuery } from './useSettings';

/**
 * Data section. Three groups:
 *
 *   1. Backup status + manual + auto-backup controls — all visually
 *      scaffolded but DISABLED with a "Requires Google sign-in" caption.
 *      Real implementation lands in S11 once S09 ships auth and S10 ships
 *      Drive sync.
 *   2. Restore from snapshot — also disabled until S11.
 *   3. Export CSV (all data) — WIRED HERE. Iterates every entry across the
 *      full DB (no date range) and downloads a CSV via the S07 builder.
 *
 * The CSV button is the lone live action in this section for S08. We surface
 * a `toast.success` on completion and `toast.error` on failure (the
 * `<Toaster />` is mounted globally in S08, see `App.tsx`).
 */
export function DataSection() {
  const { t } = useTranslation();
  const settingsQuery = useSettingsQuery();
  const allCardsQuery = useAllCardsQuery(true);

  const lastBackupAt = settingsQuery.data?.lastBackupAt;
  const autoBackupEnabled = settingsQuery.data?.autoBackupEnabled ?? true;
  const autoBackupIntervalDays = settingsQuery.data?.autoBackupIntervalDays ?? 3;

  const signInRequiredCaption = t('settings.data.signInRequired');

  const handleExportCsv = async () => {
    try {
      // Pick a wide enough range that any plausible entry is covered. The
      // shared-utils helpers don't expose an "all entries" query, so we use
      // a 100-year window which is comfortably beyond any realistic data.
      const entries = await getEntriesByDateRange(db, '1970-01-01', '2200-12-31');
      const cards = allCardsQuery.data ?? [];
      if (entries.length === 0) {
        toast.message(t('settings.data.exportEmpty'));
        return;
      }
      const csv = buildReportCsv(entries, cards);
      const filename = `hourtrack-export-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(filename, csv);
      toast.success(t('settings.data.exportSuccess'));
    } catch (err) {
      console.error('[DataSection] export csv failed:', err);
      toast.error(t('settings.data.exportFailed'));
    }
  };

  return (
    <SettingsSection
      title={t('settings.data.title')}
      testId="settings-data"
      subtitle={t('settings.data.subtitle')}
    >
      <div className="flex flex-col gap-1.5" data-testid="settings-data-backup-status">
        <span className="text-sm font-medium">{t('settings.data.backupStatus')}</span>
        <span className="text-muted-foreground text-sm">
          {lastBackupAt
            ? t('settings.data.lastBackupAt', { date: lastBackupAt })
            : t('settings.data.noBackupYet')}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <Button type="button" variant="outline" size="sm" disabled title={signInRequiredCaption}>
            {t('settings.data.createBackup')}
          </Button>
        </div>
        <span className="text-muted-foreground text-xs">{signInRequiredCaption}</span>
      </div>

      <div className="flex flex-col gap-2" data-testid="settings-data-auto-backup">
        <div className="flex items-center gap-2">
          <Switch
            id="settings-data-auto-backup-toggle"
            checked={autoBackupEnabled}
            disabled
            aria-label={t('settings.data.autoBackup')}
          />
          <label
            htmlFor="settings-data-auto-backup-toggle"
            className="text-muted-foreground text-sm"
          >
            {t('settings.data.autoBackup')}
          </label>
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="settings-data-auto-backup-interval"
            className="text-muted-foreground text-xs"
          >
            {t('settings.data.autoBackupInterval')}
          </label>
          <Input
            id="settings-data-auto-backup-interval"
            type="number"
            min={1}
            max={30}
            value={autoBackupIntervalDays}
            disabled
            className="w-20"
            readOnly
          />
        </div>
      </div>

      <div>
        <Button type="button" variant="outline" size="sm" disabled title={signInRequiredCaption}>
          {t('settings.data.restore')}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('settings.data.exportCsv')}</span>
        <div>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void handleExportCsv();
            }}
            data-testid="settings-data-export-csv"
          >
            {t('settings.data.exportCsv')}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
