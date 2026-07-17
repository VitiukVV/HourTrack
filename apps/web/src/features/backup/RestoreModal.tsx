import { useEffect, useMemo, useState } from 'react';
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
 * S16: when the selected file's `appProperties.schemaVersion` is outside the
 * SUPPORTED range, the modal short-circuits to a dedicated "version mismatch"
 * screen — Restore button hidden, only a Dismiss button — and a friendly copy
 * block explains the user has to re-enter the data manually. This catches the
 * most-common v1 → v2 case BEFORE downloading the file. As a defense-in-depth,
 * the post-download validation in `runRestore` returns
 * `validationCode: 'versionMismatch'` for any file that somehow slips through
 * (e.g. missing appProperties); the modal renders the same screen in that case.
 *
 * S29: the gate was hardcoded to a single `'2'`, which — after S21 (v3), S27
 * (v4) and S28 (v5) — rejected every *current* backup at the pre-download step
 * even though `validateSnapshot` + `applySnapshot` handle v2..v5 fine. The
 * gate now accepts the full supported range (`SUPPORTED_SCHEMA_VERSIONS`) so
 * only genuinely foreign (v1 / future) files short-circuit.
 *
 * Production wiring (`DataSection` → `BackupSection`) passes a real
 * `onRestoreComplete` that triggers `window.location.reload()`. Tests inject a
 * spy + suppress the reload.
 */

const CONFIRM_WORD = 'RESTORE' as const;
/**
 * Schema versions the restore pipeline (`validateSnapshot` → `applySnapshot`)
 * can actually import. Keep in lockstep with the `schemaVersion` union in
 * `validateSnapshot.ts` (`z.union([2,3,4,5])`). v1 and any future version fall
 * through to the friendly version-mismatch screen.
 */
const SUPPORTED_SCHEMA_VERSIONS = new Set(['2', '3', '4', '5']);

type Step = 'confirm-1' | 'confirm-2' | 'version-mismatch';

export function RestoreModal({ open, file, onOpenChange, onRestoreComplete }: RestoreModalProps) {
  const { t } = useTranslation();
  const { tokens } = useAuth();
  const accessToken = tokens?.accessToken ?? null;

  // Inspect the file's stamped schemaVersion BEFORE we let the user kick
  // off a destructive flow. If the property is missing, we trust the
  // download-time validator (`runRestore`) to catch it — the appProperty
  // is metadata only, not a security gate.
  const fileSchemaVersion = useMemo<string | undefined>(
    () => file?.appProperties?.schemaVersion,
    [file],
  );
  const isKnownVersionMismatch =
    fileSchemaVersion !== undefined && !SUPPORTED_SCHEMA_VERSIONS.has(fileSchemaVersion);

  const [step, setStep] = useState<Step>('confirm-1');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset internal state every time the dialog reopens. If the inbound
  // file is already known to be a version mismatch, jump straight to the
  // dedicated screen.
  useEffect(() => {
    if (open) {
      setStep(isKnownVersionMismatch ? 'version-mismatch' : 'confirm-1');
      setTyped('');
      setBusy(false);
    }
  }, [open, isKnownVersionMismatch]);

  const close = () => {
    if (busy) return; // Prevent close mid-flight.
    onOpenChange(false);
  };

  const handleStep1Continue = () => setStep('confirm-2');

  const handleConfirmRestore = async () => {
    if (!file || !accessToken) return;
    if (typed !== CONFIRM_WORD) return;
    setBusy(true);
    // S23 Task 29 — surface the in-flight restore via a sonner loading
    // toast. The flow involves a Drive download, a Dexie wipe-and-apply
    // transaction, and a post-restore push — all of which can take a
    // visible second or two on a busy mobile network. Without a loading
    // affordance the modal sits frozen on the "Type RESTORE" screen and
    // users wonder if their click registered.
    //
    // We use `toast.loading(...)` with the id pattern instead of
    // `toast.promise(...)` so the success / error branches below can
    // dismiss the loading toast and surface their domain-specific copy
    // (validation, schema-version mismatch) without losing the
    // sonner-native loading affordance.
    const loadingToastId = toast.loading(t('backup.restoreInProgress'));
    try {
      const result = await runRestore({
        accessToken,
        fileId: file.id,
      });
      toast.dismiss(loadingToastId);
      if (result.outcome === 'success') {
        toast.success(t('backup.restoreSuccess'));
        onOpenChange(false);
        onRestoreComplete?.();
        return;
      }
      if (result.outcome === 'invalid') {
        // S16: defense-in-depth — runRestore re-validated the downloaded
        // file and surfaced a structured `validationCode`. If it's a
        // version mismatch we never spotted at modal open, switch screens
        // in-place rather than firing a generic error toast (which the
        // user would have to act on without context).
        if (result.validationCode === 'versionMismatch') {
          setStep('version-mismatch');
          return;
        }
        toast.error(`${t('backup.restoreError')}: ${result.error ?? ''}`);
      } else {
        toast.error(t('backup.restoreError'));
      }
    } catch (err) {
      toast.dismiss(loadingToastId);
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
        {step === 'version-mismatch' ? (
          <>
            <DialogHeader>
              <DialogTitle data-testid="restore-modal-version-mismatch-title">
                {t('backup.restoreVersionMismatch.title')}
              </DialogTitle>
              <DialogDescription data-testid="restore-modal-version-mismatch-body">
                {t('backup.restoreVersionMismatch.body')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={close}
                data-testid="restore-modal-version-mismatch-dismiss"
              >
                {t('backup.restoreVersionMismatch.dismiss')}
              </Button>
            </DialogFooter>
          </>
        ) : step === 'confirm-1' ? (
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
