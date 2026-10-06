import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Card, Entry, Payment } from '@hourtrack/shared-types';
import { earningsForEntry } from '@hourtrack/shared-utils';

import { Button } from '@/components/ui/button';

import { MarkPaidDialog } from './MarkPaidDialog';
import { usePaymentsByEntry } from './usePayments';

export interface EntryPaymentControlProps {
  entry: Entry;
  card: Card | undefined;
  /** The card's entries in scope — `earningsForEntry` needs them for the fixed-rate split. */
  allCardEntries: Entry[];
}

/**
 * Spec 010 — record a payment straight from a cleaning's card.
 *
 * No linked payment → «Mark paid»: the mark-paid sheet opens prefilled with
 * this cleaning's earnings (from its SAVED values, so the payment matches what
 * is stored even while the editor has unsaved edits), its date and its month,
 * and the created payment carries `entryId`. A linked payment → «Paid X EUR»,
 * which reopens the same sheet in edit mode, so one cleaning never collects a
 * second payment from here.
 *
 * Monthly clients are billed per month on the Payments page — nothing renders.
 * Nothing renders while the payment lookup loads either: showing «Mark paid»
 * before we know whether the cleaning is paid would invite a double record.
 *
 * Render it OUTSIDE the editor's `<form>`: the sheet has its own form, and
 * React bubbles its submit through the portal into any enclosing form.
 */
export function EntryPaymentControl({ entry, card, allCardEntries }: EntryPaymentControlProps) {
  const { t } = useTranslation();
  const byEntry = usePaymentsByEntry();
  const [open, setOpen] = useState(false);
  // The payment being edited, captured when the sheet opens. The live map
  // hands out fresh row objects after ANY payments write (a Drive pull, an
  // Undo elsewhere), and the sheet re-seeds its form whenever its `payment`
  // prop changes — passing the live row would wipe what the user typed.
  const [editing, setEditing] = useState<Payment | null>(null);

  if (!card || card.rateType === 'monthly') return null;
  if (byEntry.isError) {
    return (
      <p className="text-destructive text-xs" role="alert">
        {t('payments.loadError')}
      </p>
    );
  }
  if (!byEntry.data) return null;

  const payment = byEntry.data.get(entry.id) ?? null;
  const expected = earningsForEntry(entry, card, allCardEntries);

  function openSheet(paymentToEdit: Payment | null): void {
    setEditing(paymentToEdit);
    setOpen(true);
  }

  return (
    <div className="flex items-center justify-end">
      {payment ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openSheet(payment)}
          data-testid="entry-paid"
        >
          <CircleCheck aria-hidden="true" className="h-4 w-4 text-emerald-600" />
          {t('payments.entry.paid', { amount: payment.amount.toFixed(2) })}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openSheet(null)}
          data-testid="entry-mark-paid"
        >
          {t('payments.entry.markPaid')}
        </Button>
      )}

      <MarkPaidDialog
        open={open}
        onOpenChange={setOpen}
        cardId={card.id}
        cardName={card.name}
        period={entry.date.slice(0, 7)}
        remaining={expected}
        payment={editing}
        entryId={entry.id}
        defaultPaidOn={entry.date}
      />
    </div>
  );
}
