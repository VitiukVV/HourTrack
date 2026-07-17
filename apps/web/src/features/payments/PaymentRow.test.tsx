import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import type { Card, Payment } from '@hourtrack/shared-types';

import '@/lib/i18n';
import i18n from '@/lib/i18n';
import { createPayment, db, listPaymentsByPeriod } from '@/lib/db';

import { PaymentRow } from './PaymentRow';
import type { MonthLedgerRow } from './monthLedger';

const PERIOD = '2026-07';

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    name: 'Марі',
    color: '#2563EB',
    defaultDurationMin: 60,
    defaultStartMinutes: 540,
    rateType: 'monthly',
    hourlyRate: null,
    fixedTotal: null,
    monthlyTotal: 250,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function row(overrides: Partial<MonthLedgerRow> = {}): MonthLedgerRow {
  return {
    card: card(),
    expected: 250,
    received: 0,
    sessions: 2,
    totalMinutes: 300,
    payments: [],
    ...overrides,
  };
}

beforeEach(async () => {
  await db.payments.clear();
  await db.tombstones.clear();
  await i18n.changeLanguage('en');
});

describe('PaymentRow — status chip + mark-paid visibility', () => {
  it('unpaid row shows the unpaid status and a mark-paid button', () => {
    wrap(<PaymentRow row={row()} period={PERIOD} today={new Date(2026, 6, 16)} />);
    expect(screen.getByTestId('payment-row-status')).toHaveTextContent('Unpaid');
    expect(screen.getByTestId('payment-row')).toHaveAttribute('data-status', 'unpaid');
    expect(screen.getByTestId('payment-row-mark-paid')).toBeInTheDocument();
  });

  it('paid row hides the mark-paid button', () => {
    wrap(<PaymentRow row={row({ received: 250 })} period={PERIOD} today={new Date(2026, 6, 16)} />);
    expect(screen.getByTestId('payment-row-status')).toHaveTextContent('Paid');
    expect(screen.queryByTestId('payment-row-mark-paid')).not.toBeInTheDocument();
  });

  it('partial row shows "received of expected" and the partial chip', () => {
    wrap(<PaymentRow row={row({ received: 120 })} period={PERIOD} today={new Date(2026, 6, 16)} />);
    expect(screen.getByTestId('payment-row-status')).toHaveTextContent('Partial');
    expect(screen.getByTestId('payment-row-received')).toHaveTextContent('120 of 250');
  });

  it('past unpaid period renders as overdue', () => {
    wrap(<PaymentRow row={row()} period="2026-06" today={new Date(2026, 6, 16)} />);
    expect(screen.getByTestId('payment-row')).toHaveAttribute('data-status', 'overdue');
    expect(screen.getByTestId('payment-row-status')).toHaveTextContent('Overdue');
  });
});

describe('PaymentRow — mark-paid flow', () => {
  it('prefills the remaining balance and creates a payment on confirm', async () => {
    const user = userEvent.setup();
    wrap(<PaymentRow row={row({ received: 100 })} period={PERIOD} today={new Date(2026, 6, 16)} />);

    await user.click(screen.getByTestId('payment-row-mark-paid'));

    const dialog = await screen.findByTestId('mark-paid-dialog');
    const amountInput = within(dialog).getByLabelText(/Amount/i) as HTMLInputElement;
    // remaining = expected 250 - received 100 = 150
    expect(amountInput.value).toBe('150');

    await user.click(within(dialog).getByTestId('mark-paid-confirm'));

    await waitFor(async () => {
      const payments = await listPaymentsByPeriod(db, PERIOD);
      expect(payments).toHaveLength(1);
      expect(payments[0]?.amount).toBe(150);
      expect(payments[0]?.cardId).toBe('card-1');
      expect(payments[0]?.period).toBe(PERIOD);
    });
  });
});

describe('PaymentRow — payment history', () => {
  it('expands to show payment history and deletes a payment', async () => {
    const user = userEvent.setup();
    // Seed an existing payment in the db AND in the row prop.
    const existing = await createPayment(db, {
      id: 'pay-x',
      cardId: 'card-1',
      period: PERIOD,
      amount: 80,
      paidOn: '2026-07-10',
      note: 'cash',
    });
    const seeded: Payment = existing;

    wrap(
      <PaymentRow
        row={row({ received: 80, payments: [seeded] })}
        period={PERIOD}
        today={new Date(2026, 6, 16)}
      />,
    );

    await user.click(screen.getByTestId('payment-row-toggle'));
    expect(await screen.findByTestId('payment-history')).toBeInTheDocument();
    expect(screen.getByTestId('payment-history-item')).toHaveTextContent('80');

    // Delete → confirm.
    await user.click(screen.getByTestId('payment-history-delete'));
    const confirmBtn = await screen.findByRole('button', { name: /^Delete$/i });
    await user.click(confirmBtn);

    await waitFor(async () => {
      const payments = await listPaymentsByPeriod(db, PERIOD);
      expect(payments).toHaveLength(0);
    });
  });
});
