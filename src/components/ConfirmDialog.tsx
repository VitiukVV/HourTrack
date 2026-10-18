import { useTranslation } from 'react-i18next';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Lightweight confirm dialog used by the S05 active-card "click same day twice
 * removes entry" flow. Reuses the existing shadcn `Dialog` primitive instead
 * of introducing shadcn's `AlertDialog` to keep the dependency footprint
 * minimal (Sonner is already installed for S08; we resist adding another
 * Radix variant until it's clearly worth the byte cost).
 *
 * The component is intentionally headless of i18n — callers pass already-
 * translated strings. This makes it trivially reusable for future destructive
 * actions (archive confirm, restore confirm, etc.) without churning the
 * dialog's surface API.
 */
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual treatment for the confirm button — defaults to destructive. */
  confirmVariant?: 'destructive' | 'default';
  onConfirm: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { t } = useTranslation();
  const {
    open,
    onOpenChange,
    title,
    body,
    confirmLabel,
    cancelLabel,
    confirmVariant = 'destructive',
    onConfirm,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant={confirmVariant === 'destructive' ? 'destructive' : 'default'}
            onClick={() => {
              onConfirm();
            }}
          >
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
