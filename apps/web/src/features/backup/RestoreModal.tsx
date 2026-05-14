import { useEffect, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/authContext';
import { formatDate } from '@/lib/date';

import { runRestore } from './restoreFlow';
import type { BackupFile } from './backupService';

export interface RestoreModalProps {
  open: boolean;
  /** Selected snapshot file. When null, the modal renders an empty state. */
  file: BackupFile | null;
  onOpenChange: (open: boolean) => void;
  /**
   * Called immediately after a successful restore. Production wiring triggers
   * a full page reload; tests inject a spy.
   */
  onRestoreComplete?: () => void;
}

/**
 * Two-step destructive restore confirmation per sprint spec task #5.
 *
 * Step A: "This will replace your current data with the snapshot from {date}.
 *          Continue?" — Continue button advances to step B.
 * Step B: "Type RESTORE to confirm" — text input must equal `RESTORE` to enable
 *          the final destructive button.
 *
 * Production wiring (`DataSection` → `BackupSection`) passes a real
 * `onRestoreComplete` that triggers `window.location.reload()`. Tests inject a
 * spy + suppress the reload.
 */

const CONFIRM_WORD = 'RESTORE' as const;

type Step = 'confirm-1' | 'confirm-2';

export function RestoreModal({ open, file, onOpenChange, onRestoreComplete }: RestoreModalProps) {
  const { t } = useTranslation();
  const { tokens } = useAuth();
  const accessToken = tokens?.accessToken ?? null;

  const [step, setStep] = useState<Step>('confirm-1');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset internal state every time the dialog reopens.
  useEffect(() => {
    if (open) {
      setStep('confirm-1');
      setTyped('');
      setBusy(false);
    }
  }, [open]);

  const close = () => {
    if (busy) return; // Prevent close mid-flight.
    onOpenChange(false);
  };

  const handleStep1Continue = () => setStep('confirm-2');

  const handleConfirmRestore = async () => {
    if (!file || !accessToken) return;
    if (typed !== CONFIRM_WORD) return;
    setBusy(true);
    try {
      const result = await runRestore({
        accessToken,
        fileId: file.id,
      });
      if (result.outcome === 'success') {
        toast.success(t('backup.restoreSuccess'));
        onOpenChange(false);
        onRestoreComplete?.();
        return;
      }
      if (result.outcome === 'invalid') {
        toast.error(`${t('backup.restoreError')}: ${result.error ?? ''}`);
      } else {
        toast.error(t('backup.restoreError'));
      }
    } catch (err) {
      console.error('[RestoreModal] runRestore threw:', err);
      toast.error(t('backup.restoreError'));
    } finally {
      setBusy(false);
    }
  };

  // Derive the date the user is restoring from. Backup filename pattern is
  // `backups/YYYY-MM-DDTHHmm.json` or `backups/pre-restore-…Z.json`. Falling
  // back to Drive's modifiedTime keeps the UI readable for edge filenames.
  const restoreDate = (() => {
    if (!file) return '';
    const m = file.name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})/);
    if (m) {
      return `${formatDate(m[1]!)} ${m[2]}:${m[3]}`;
    }
    if (file.modifiedTime) return formatDate(file.modifiedTime);
    return file.name;
  })();

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-testid="restore-modal">
        {step === 'confirm-1' ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('backup.restore')}</DialogTitle>
              <DialogDescription>
                {t('backup.restoreConfirm1', { date: restoreDate })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleStep1Continue}
                disabled={busy || !file}
                data-testid="restore-modal-continue"
              >
                {t('common.confirm')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('backup.restore')}</DialogTitle>
              <DialogDescription>
                {t('backup.restoreConfirm2', { word: CONFIRM_WORD })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={CONFIRM_WORD}
                aria-label={t('backup.restoreTypeWord', { word: CONFIRM_WORD })}
                disabled={busy}
                data-testid="restore-modal-input"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleConfirmRestore()}
                disabled={busy || typed !== CONFIRM_WORD || !file || !accessToken}
                data-testid="restore-modal-confirm"
              >
                {busy ? t('common.loading') : t('backup.restore')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
