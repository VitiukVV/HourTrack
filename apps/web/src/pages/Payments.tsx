import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { PaymentRow } from '@/features/payments/PaymentRow';
import { PaymentsHeader } from '@/features/payments/PaymentsHeader';
import { usePaymentsStore } from '@/features/payments/paymentsStore';
import { useMonthLedger } from '@/features/payments/usePayments';

/**
 * /payments page assembly (S27).
 *
 * Layout:
 *   - `<PaymentsHeader />` — month navigation + Expected/Received/Outstanding
 *     rollup strip.
 *   - one `<PaymentRow />` per ledger item (card with ≥1 entry OR ≥1 payment
 *     this month), each expandable to its payment history.
 *
 * States: loading skeleton (consistent with Reports), error line, and a
 * friendly empty state when no card has activity in the month.
 */
export function PaymentsPage() {
  const { t } = useTranslation();
  const period = usePaymentsStore((s) => s.period);
  const ledger = useMonthLedger(period);

  return (
    <section className="flex flex-col gap-4" data-testid="payments-page">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('payments.title')}</h1>
      </header>

      <PaymentsHeader totals={ledger.data?.totals} />

      {ledger.isLoading ? (
        <p className="text-muted-foreground text-sm" data-testid="payments-loading">
          {t('common.loading')}
        </p>
      ) : ledger.isError ? (
        <p className="text-destructive text-sm" data-testid="payments-error">
          {t('payments.loadError')}
        </p>
      ) : ledger.data && ledger.data.rows.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="payments-list">
          {ledger.data.rows.map((row) => (
            <li key={row.card.id}>
              <PaymentRow row={row} period={period} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          testId="payments-empty"
          title={t('payments.empty.title')}
          body={t('payments.empty.body')}
          cta={
            <Button asChild size="sm" variant="outline">
              <Link to="/">{t('payments.empty.cta')}</Link>
            </Button>
          }
        />
      )}
    </section>
  );
}
