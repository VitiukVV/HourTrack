import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Bell, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Reminder } from '@hourtrack/shared-types';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { minutesToHHMM } from '@/components/ui/TimeInput';
import { isReminderDue } from '@/lib/db';
import { localeFor } from '@/features/calendar/calendarLocale';
import { cn } from '@/lib/utils';

import { ReminderDialog } from './ReminderDialog';
import {
  useDeleteReminderMutation,
  useMarkReminderDoneMutation,
  useOpenRemindersQuery,
} from './useReminders';

/**
 * S28 — header bell surfacing open reminders (UR-28-1, UR-28-2).
 *
 * Badge = count of due, not-done reminders (recomputed against the current
 * clock each render; the RemindersScheduler's 60s invalidate keeps it fresh
 * while the app is open). Tapping opens a popover listing every open reminder,
 * due ones first + highlighted, each with Done + delete, and a "+ Reminder"
 * button that opens the create dialog. Tapping a reminder's text edits it.
 */

/** "4 Aug · 09:00" localized. */
function formatWhen(reminder: Reminder, lang: string | undefined): string {
  const day = format(parseISO(reminder.dueDate), 'd MMM', { locale: localeFor(lang) });
  return `${day} · ${minutesToHHMM(reminder.dueMinutes)}`;
}

export function ReminderBell() {
  const { t, i18n } = useTranslation();
  const { data: reminders } = useOpenRemindersQuery();
  const markDone = useMarkReminderDoneMutation();
  const deleteReminder = useDeleteReminderMutation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);

  const now = new Date();
  const open = reminders ?? [];
  const dueCount = useMemo(
    () => open.filter((r) => isReminderDue(r, now)).length,
    // `now` is a fresh Date each render; depend on the list identity + the
    // minute so the memo recomputes on data change / scheduler tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open],
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (reminder: Reminder) => {
    setEditing(reminder);
    setDialogOpen(true);
  };

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground relative inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors"
            aria-label={t('reminders.bell.ariaLabel')}
            data-testid="reminder-bell"
          >
            <Bell className="h-5 w-5" />
            {dueCount > 0 && (
              <span
                className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 inline-flex min-w-[1.05rem] items-center justify-center rounded-full px-1 text-[0.65rem] leading-4 font-semibold"
                data-testid="reminder-bell-badge"
              >
                {dueCount}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-2" data-testid="reminder-bell-panel">
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-sm font-semibold">{t('reminders.list.title')}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={openCreate}
              data-testid="reminder-add"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('reminders.add')}
            </Button>
          </div>

          {open.length === 0 ? (
            <p
              className="text-muted-foreground px-1 py-3 text-sm"
              data-testid="reminder-list-empty"
            >
              {t('reminders.list.empty')}
            </p>
          ) : (
            <ul
              className="flex max-h-80 flex-col gap-1 overflow-y-auto"
              data-testid="reminder-list"
            >
              {open.map((r) => {
                const due = isReminderDue(r, now);
                return (
                  <li
                    key={r.id}
                    className={cn(
                      'flex items-start gap-2 rounded-md border p-2',
                      due
                        ? 'border-destructive/40 bg-destructive/5'
                        : 'border-border bg-background',
                    )}
                    data-testid="reminder-item"
                    data-due={due ? 'true' : 'false'}
                  >
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="flex min-w-0 flex-1 flex-col text-left"
                      data-testid="reminder-item-edit"
                    >
                      <span className="truncate text-sm font-medium">{r.text}</span>
                      <span className="text-muted-foreground text-xs">
                        {formatWhen(r, i18n.language)}
                        {due && (
                          <span className="text-destructive ml-1 font-medium">
                            · {t('reminders.due')}
                          </span>
                        )}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => markDone.mutate(r.id)}
                        data-testid="reminder-item-done"
                      >
                        {t('reminders.done')}
                      </Button>
                      <button
                        type="button"
                        onClick={() => deleteReminder.mutate(r.id)}
                        className="text-muted-foreground hover:text-destructive inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors"
                        aria-label={t('reminders.delete')}
                        data-testid="reminder-item-delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      <ReminderDialog open={dialogOpen} onOpenChange={setDialogOpen} reminder={editing} />
    </>
  );
}
