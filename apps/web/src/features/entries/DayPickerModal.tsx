import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { Card } from '@hourtrack/shared-types';
import { formatDuration } from '@hourtrack/shared-utils';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCardsQuery, useCreateCardMutation } from '@/features/cards/useCards';
import { CardForm } from '@/features/cards/CardForm';
import type { CardInputParsed } from '@/features/cards/cardSchema';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/utils';

/**
 * Quick-pick modal that fires when the user clicks a calendar day with NO
 * active card selected. Lists non-archived cards as buttons; choosing one
 * raises `onPick(card)` so the parent (Month/WeekView wiring) can create the
 * entry on that date with the card's defaults.
 *
 * The `+ Create new card and add` action toggles into the inline `CardForm`.
 * On save we first create the card via `useCreateCardMutation`, then
 * immediately forward to `onPick` with the freshly-persisted card so the
 * caller can chain the entry creation in a single user flow.
 *
 * This is NOT the DayPage (S06) — that's a full route for editing existing
 * entries with the EntryEditor. This is just the pick-one-card affordance.
 */
export interface DayPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** YYYY-MM-DD local date that triggered the picker. Surfaced in the title. */
  date: string;
  onPick: (card: Card) => void;
}

export function DayPickerModal(props: DayPickerModalProps) {
  const { open, onOpenChange, date, onPick } = props;
  const { t } = useTranslation();
  const cardsQuery = useCardsQuery();
  const createCard = useCreateCardMutation();

  const [mode, setMode] = useState<'pick' | 'create'>('pick');

  // Reset to pick mode whenever the dialog is closed so the next open starts
  // on the list, not the half-filled form.
  const handleOpenChange = (next: boolean) => {
    if (!next) setMode('pick');
    onOpenChange(next);
  };

  const handlePick = (card: Card) => {
    onPick(card);
    onOpenChange(false);
    setMode('pick');
  };

  const handleCreateAndAdd = async (payload: CardInputParsed) => {
    try {
      const created = await createCard.mutateAsync({
        id: crypto.randomUUID(),
        name: payload.name,
        color: payload.color,
        defaultDurationMin: payload.defaultDurationMin,
        // S16: required since v2 — CardForm seeds a fallback when no
        // visible picker is mounted.
        defaultStartMinutes: payload.defaultStartMinutes,
        rateType: payload.rateType,
        hourlyRate: payload.hourlyRate ?? null,
        fixedTotal: payload.fixedTotal ?? null,
        defaultNote: payload.defaultNote ?? null,
        isArchived: false,
        archivedAt: null,
      });
      onPick(created);
      onOpenChange(false);
      setMode('pick');
    } catch (err) {
      // Stay on the form so the user can correct + retry. S08 surfaces the
      // failure via sonner so the user sees something happened.
      console.error('[DayPickerModal] create-and-add failed:', err);
      toast.error(t('cards.saveFailed'));
    }
  };

  const cards = cardsQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* S18: bottom-sheet on phones, centered on `sm:+`. */}
      <DialogContent variant="bottom-sheet">
        <DialogHeader>
          <DialogTitle>{t('entries.dayPicker.title', { date: formatDate(date) })}</DialogTitle>
          <DialogDescription>{t('entries.dayPicker.subtitle')}</DialogDescription>
        </DialogHeader>

        {mode === 'pick' ? (
          <div className="flex flex-col gap-3">
            {/* S18: cap the card-list height at 70vh on mobile so a long
                list never blows out the bottom-sheet viewport at 375px
                tall. Inherits the centered `max-h-72` on larger screens
                via the same overflow-y-auto. */}
            <div className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto sm:max-h-72">
              {cards.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-sm">
                  {/* S05 followup: the previous copy referenced the "+ button" */}
                  {/* which doesn't exist inside the modal. Use a dedicated key */}
                  {/* that points users to the inline "Create new" button below. */}
                  {t('entries.dayPicker.noCardsYet')}
                </p>
              ) : (
                cards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => handlePick(card)}
                    className={cn(
                      'border-border bg-background hover:bg-accent flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: card.color }}
                    />
                    <span className="flex-1 font-medium">{card.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatDuration(card.defaultDurationMin)}
                    </span>
                  </button>
                ))
              )}
            </div>

            <Button type="button" variant="outline" onClick={() => setMode('create')}>
              {t('entries.dayPicker.createNew')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              {t('entries.dayPicker.cancel')}
            </Button>
          </div>
        ) : (
          <CardForm
            mode="create"
            onSave={(payload) => {
              void handleCreateAndAdd(payload);
            }}
            onCancel={() => setMode('pick')}
            isSubmitting={createCard.isPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
