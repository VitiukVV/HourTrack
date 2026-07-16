import { format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { MonthPicker } from '@/components/ui/MonthPicker';
import { localeFor } from '@/features/calendar/calendarLocale';

import type { LedgerTotals } from './monthLedger';
import { usePaymentsStore } from './paymentsStore';

/**
 * S27 — Payments page header: month navigation (`‹ Липень 2026 ›` chevrons +
 * the shared `MonthPicker` primitive) plus the rollup strip (Expected /
 * Received / Outstanding) that answers "скільки мені ще винні" at a glance.
 */
export interface PaymentsHeaderProps {
  totals: LedgerTotals | undefined;
}

/** EUR display: integers stay integer, fractionals show 2 decimals. */
function eur(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function PaymentsHeader({ totals }: PaymentsHeaderProps) {
  const { t, i18n } = useTranslation();
  const period = usePaymentsStore((s) => s.period);
  const setPeriod = usePaymentsStore((s) => s.setPeriod);
  const stepMonth = usePaymentsStore((s) => s.stepMonth);

  const locale = localeFor(i18n.resolvedLanguage ?? i18n.language);
  const monthLabel = useMemo(() => {
    const formatted = format(parseISO(`${period}-01`), 'LLLL yyyy', { locale });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }, [period, locale]);

  return (
    <div className="flex flex-col gap-4" data-testid="payments-header">
      {/* Month navigation */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => stepMonth(-1)}
          aria-label={t('payments.prevMonth')}
          data-testid="payments-prev-month"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <MonthPicker
          value={`${period}-01`}
          onChange={(anchor) => setPeriod(anchor.slice(0, 7))}
          aria-label={monthLabel}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => stepMonth(1)}
          aria-label={t('payments.nextMonth')}
          data-testid="payments-next-month"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Rollup strip */}
      <div className="grid grid-cols-3 gap-2" data-testid="payments-rollup">
        <RollupTile
          label={t('payments.rollup.expected')}
          value={totals ? eur(totals.expected) : '—'}
        />
        <RollupTile
          label={t('payments.rollup.received')}
          value={totals ? eur(totals.received) : '—'}
        />
        <RollupTile
          label={t('payments.rollup.outstanding')}
          value={totals ? eur(totals.outstanding) : '—'}
          emphasize={!!totals && totals.outstanding > 0}
        />
      </div>
    </div>
  );
}

function RollupTile({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="border-border bg-background flex flex-col gap-1 rounded-md border p-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span
        className={emphasize ? 'text-destructive text-lg font-semibold' : 'text-lg font-semibold'}
      >
        {value} €
      </span>
    </div>
  );
}
