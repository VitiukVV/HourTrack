import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { Card } from '@hourtrack/shared-types';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { CardForm, type CardFormDefaultValues } from './CardForm';
import type { CardInputParsed } from './cardSchema';
import { useCreateCardMutation, useUpdateCardMutation } from './useCards';

interface CommonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CreateProps extends CommonProps {
  mode: 'create';
  /** Existing card is irrelevant in create mode. */
  card?: undefined;
}

interface EditProps extends CommonProps {
  mode: 'edit';
  card: Card;
}

export type CardModalProps = CreateProps | EditProps;

/**
 * Dialog wrapper around `CardForm` that wires submit to the appropriate
 * TanStack Query mutation (create or update) and closes the modal on success.
 *
 * `useCreateCardMutation` / `useUpdateCardMutation` invalidate `['cards']`
 * which refreshes the active-list and archived-list queries. The modal does
 * not need its own cache busting.
 */
export function CardModal(props: CardModalProps) {
  const { t } = useTranslation();
  const create = useCreateCardMutation();
  const update = useUpdateCardMutation();

  const isSubmitting = create.isPending || update.isPending;

  const handleSave = async (payload: CardInputParsed) => {
    try {
      if (props.mode === 'create') {
        await create.mutateAsync({
          id: crypto.randomUUID(),
          name: payload.name,
          color: payload.color,
          defaultDurationMin: payload.defaultDurationMin,
          // S16: required since v2. CardForm seeds a fallback (600 = 10:00)
          // until S16b mounts a visible time picker.
          defaultStartMinutes: payload.defaultStartMinutes,
          rateType: payload.rateType,
          hourlyRate: payload.hourlyRate ?? null,
          fixedTotal: payload.fixedTotal ?? null,
          // S21: monthly retainer field. The schema enforces non-null when
          // rateType === 'monthly', otherwise the resolver pins it to null.
          monthlyTotal: payload.monthlyTotal ?? null,
          defaultNote: payload.defaultNote ?? null,
          isArchived: false,
          archivedAt: null,
        });
      } else {
        await update.mutateAsync({
          id: props.card.id,
          patch: {
            name: payload.name,
            color: payload.color,
            defaultDurationMin: payload.defaultDurationMin,
            defaultStartMinutes: payload.defaultStartMinutes,
            rateType: payload.rateType,
            hourlyRate: payload.hourlyRate ?? null,
            fixedTotal: payload.fixedTotal ?? null,
            monthlyTotal: payload.monthlyTotal ?? null,
            defaultNote: payload.defaultNote ?? null,
          },
        });
      }
      props.onOpenChange(false);
    } catch (err) {
      // The mutation surface keeps the error state; the form stays open so the
      // user can correct and retry. S08 wires the global sonner toaster, so
      // we surface a user-visible error in addition to logging for traceability.
      console.error('[CardModal] save failed:', err);
      toast.error(t('cards.saveFailed'));
    }
  };

  const defaultValues: CardFormDefaultValues | undefined =
    props.mode === 'edit'
      ? {
          name: props.card.name,
          color: props.card.color,
          defaultDurationMin: props.card.defaultDurationMin,
          // S16: pre-fill the (currently invisible) start-time so an edit
          // save round-trips the value instead of resetting to the fallback.
          defaultStartMinutes: props.card.defaultStartMinutes,
          rateType: props.card.rateType,
          hourlyRate: props.card.hourlyRate,
          fixedTotal: props.card.fixedTotal,
          // S21: pre-fill the monthly retainer so an edit save round-trips
          // instead of resetting to null.
          monthlyTotal: props.card.monthlyTotal,
          defaultNote: props.card.defaultNote,
        }
      : undefined;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* S18: bottom-sheet on phones, centered on `sm:+`. */}
      <DialogContent variant="bottom-sheet">
        <DialogHeader>
          <DialogTitle>
            {props.mode === 'create' ? t('cards.createCard') : t('cards.editCard')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {props.mode === 'create' ? t('cards.createCard') : t('cards.editCard')}
          </DialogDescription>
        </DialogHeader>
        <CardForm
          mode={props.mode}
          defaultValues={defaultValues}
          onSave={(payload) => {
            void handleSave(payload);
          }}
          onCancel={() => props.onOpenChange(false)}
          isSubmitting={isSubmitting}
        />
      </DialogContent>
    </Dialog>
  );
}
