import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { isReminderDue } from '@/lib/db';

import { useMarkReminderDoneMutation, useOpenRemindersQuery } from './useReminders';

/**
 * S28 — due-reminders banner shown on app open (UR-28-2:
 * "має висвітитись при заході в додаток").
 *
 * Lists every due, not-done reminder with a Done button. Dismiss (the X) is
 * session-local and does NOT mark anything done — the banner reappears on the
 * next app open (reload / fresh mount) until each reminder is marked Done.
 * Rendered once under AppLayout, above the page content.
 */
export function DueRemindersBanner() {
  const { t } = useTranslation();
  const { data: reminders } = useOpenRemindersQuery();
  const markDone = useMarkReminderDoneMutation();
  const [dismissed, setDismissed] = useState(false);

  // A failed Dexie write used to be swallowed: the row stayed put with no
  // explanation, so the tap read as 'the button does nothing'.
  const handleActionError = (err: unknown) => {
    console.error('[DueRemindersBanner] reminder action failed:', err);
    toast.error(t('reminders.actionFailed'));
  };

  const due = useMemo(
    () => (reminders ?? []).filter((r) => isReminderDue(r, new Date())),
    [reminders],
  );

  if (dismissed || due.length === 0) return null;

  return (
    <div
      className="border-destructive/30 bg-destructive/5 mx-auto mt-4 w-full max-w-6xl rounded-md border px-4 py-3"
      role="status"
      data-testid="due-reminders-banner"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold">{t('reminders.banner.title')}</span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md"
          aria-label={t('reminders.banner.dismiss')}
          data-testid="due-reminders-dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5" data-testid="due-reminders-list">
        {due.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-2"
            data-testid="due-reminder-item"
          >
            <span className="min-w-0 flex-1 truncate text-sm">{r.text}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => markDone.mutate(r.id, { onError: handleActionError })}
              data-testid="due-reminder-done"
            >
              {t('reminders.done')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
