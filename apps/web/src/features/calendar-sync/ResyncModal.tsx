import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/authContext';
import { db } from '@/lib/db';

import { runResyncAll, type ResyncMode } from './resyncAll';

export interface ResyncModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Repair-only vs full force re-sync. Defaults to repair. */
  mode?: ResyncMode;
}

/**
 * Re-sync progress modal launched from `CalendarSection`. Renders a
 * progress bar and a per-second updated "{done} of {total}" counter while
 * `runResyncAll` walks the entry table.
 *
 * The flow is non-blocking from the user's POV — they can close the modal
 * (which cancels the displayed progress, but the underlying runner keeps
 * going; finished events are stamped in Dexie regardless). A future
 * AbortSignal hook is flagged as an S13 followup if users complain.
 */
export function ResyncModal({ open, onOpenChange, mode = 'only-errored' }: ResyncModalProps) {
  const { t } = useTranslation();
  const { tokens } = useAuth();
  const accessToken = tokens?.accessToken ?? null;

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ succeeded: number; failed: number; total: number } | null>(
    null,
  );

  // Stable mode reference inside the effect to avoid re-running mid-flight.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    if (open) {
      setBusy(false);
      setProgress(null);
      setResult(null);
    }
  }, [open]);

  const handleStart = async () => {
    if (!accessToken) {
      toast.error(t('googleCalendar.signInRequired'));
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const summary = await runResyncAll({
        accessToken,
        database: db,
        mode: modeRef.current,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResult({
        succeeded: summary.succeeded,
        failed: summary.failed,
        total: summary.total,
      });
      if (summary.failed === 0) {
        toast.success(t('googleCalendar.resyncDone', { count: summary.succeeded }));
      } else {
        toast.error(
          t('googleCalendar.resyncPartial', {
            succeeded: summary.succeeded,
            failed: summary.failed,
          }),
        );
      }
    } catch (err) {
      console.error('[ResyncModal] runResyncAll threw:', err);
      toast.error(t('googleCalendar.resyncFailed'));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return; // Don't allow closing mid-flight.
    onOpenChange(false);
  };

  const pct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-testid="resync-modal">
        <DialogHeader>
          <DialogTitle>{t('googleCalendar.resyncAll')}</DialogTitle>
          <DialogDescription>{t('googleCalendar.resyncDescription')}</DialogDescription>
        </DialogHeader>

        {busy && progress && (
          <div className="flex flex-col gap-2" data-testid="resync-modal-progress">
            <div
              className="bg-muted h-2 w-full overflow-hidden rounded"
              role="progressbar"
              aria-label={t('googleCalendar.resyncAll')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div
                className="bg-primary h-2 transition-all"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
            </div>
            <span className="text-muted-foreground text-xs" aria-live="polite">
              {t('googleCalendar.resyncInProgress', {
                done: progress.done,
                total: progress.total,
              })}
            </span>
          </div>
        )}

        {result && !busy && (
          <div className="flex flex-col gap-1 text-sm" data-testid="resync-modal-result">
            <span>
              {t('googleCalendar.resyncSummary', {
                succeeded: result.succeeded,
                failed: result.failed,
                total: result.total,
              })}
            </span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            {result ? t('common.close') : t('common.cancel')}
          </Button>
          <Button
            onClick={() => void handleStart()}
            disabled={busy || !accessToken}
            data-testid="resync-modal-start"
          >
            {busy ? t('common.loading') : t('googleCalendar.resyncStart')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
