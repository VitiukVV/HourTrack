import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Payment } from '@hourtrack/shared-types';
import { formatDuration } from '@hourtrack/shared-utils';

import { Button } from '@/components/ui/button';
import { getReadableTextColor } from '@/lib/colors';
import { cn } from '@/lib/utils';

import { MarkPaidDialog } from './MarkPaidDialog';
import { PaymentHistory } from './PaymentHistory';
import type { MonthLedgerRow } from './monthLedger';
import { isOverdue, paymentStatus, type PaymentStatus } from './paymentStatus';

/**
 * S27 — one ledger row on the Payments page. Mobile-first: this page gets used
 * on the phone while holding cash, so the primary "Отримано" action is a big,
 * always-reachable button and the whole row expands to the payment history.
 */
export interface PaymentRowProps {
  row: MonthLedgerRow;
  period: string;
  /** Injected for deterministic overdue derivation in tests. */
  today?: Date;
}

const FALLBACK_COLOR = '#94A3B8';

/** EUR display: integers stay integer, fractionals show 2 decimals. */
function eur(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function chipClasses(status: PaymentStatus, overdue: boolean): string {
  if (overdue) {
    return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
  }
  switch (status) {
    case 'paid':
      return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
    case 'partial':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
    default:
      return 'bg-secondary text-secondary-foreground';
  }
}

export function PaymentRow({ row, period, today }: PaymentRowProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);

  const status = paymentStatus(row.expected, row.received);
  const overdue = isOverdue(period, status, today);
  const remaining = Math.max(row.expected - row.received, 0);

  const color = row.card.color ?? FALLBACK_COLOR;
  const statusLabel = overdue ? t('payments.status.overdue') : t(`payments.status.${status}`);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (payment: Payment) => {
    setEditing(payment);
    setDialogOpen(true);
  };

  return (
    <div
      className="border-border bg-background flex flex-col rounded-md border"
      data-testid="payment-row"
      data-card-id={row.card.id}
      data-status={overdue ? 'overdue' : status}
    >
      <div className="flex items-center gap-3 p-3">
        {/* Card pill + summary — the whole cluster toggles the history. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
          data-testid="payment-row-toggle"
        >
          {expanded ? (
            <ChevronUp className="text-muted-foreground h-4 w-4 shrink-0" />
          ) : (
            <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
          )}
          <span className="flex min-w-0 flex-col">
            <span
              style={{ backgroundColor: color, color: getReadableTextColor(color) }}
              className="inline-flex max-w-[12rem] self-start truncate rounded-full px-2 py-0.5 text-xs font-semibold"
              title={row.card.name}
            >
              {row.card.name}
            </span>
            <span className="text-muted-foreground mt-1 text-xs">
              {t('payments.row.summary', {
                count: row.sessions,
                duration: formatDuration(row.totalMinutes),
              })}
            </span>
          </span>
        </button>

        {/* Amounts + status + action */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-semibold" data-testid="payment-row-expected">
            {eur(row.expected)} €
          </span>
          {row.received > 0 && status !== 'paid' ? (
            <span className="text-muted-foreground text-xs" data-testid="payment-row-received">
              {t('payments.row.receivedOf', {
                received: eur(row.received),
                expected: eur(row.expected),
              })}
            </span>
          ) : row.received > 0 ? (
            <span className="text-muted-foreground text-xs" data-testid="payment-row-received">
              {eur(row.received)} €
            </span>
          ) : null}
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              chipClasses(status, overdue),
            )}
            data-testid="payment-row-status"
          >
            {statusLabel}
          </span>
        </div>
      </div>

      {status !== 'paid' && (
        <div className="px-3 pb-3">
          <Button
            type="button"
            size="sm"
            className="w-full sm:w-auto"
            onClick={openCreate}
            data-testid="payment-row-mark-paid"
          >
            {t('payments.row.markPaid')}
          </Button>
        </div>
      )}

      {expanded && (
        <div className="border-border/60 border-t px-3 py-3">
          {row.expected === 0 && (
            <p className="text-muted-foreground mb-2 text-xs" data-testid="payment-row-orphan-hint">
              {t('payments.row.orphanHint')}
            </p>
          )}
          <PaymentHistory payments={row.payments} onEdit={openEdit} />
        </div>
      )}

      <MarkPaidDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cardId={row.card.id}
        cardName={row.card.name}
        period={period}
        remaining={remaining}
        payment={editing}
      />
    </div>
  );
}
