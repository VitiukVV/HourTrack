import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import type { Card } from '@hourtrack/shared-types';

import '@/lib/i18n';
import i18n from '@/lib/i18n';
import { db } from '@/lib/db';

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
  await db.reminders.clear();
  await db.tombstones.clear();
  await db.syncQueue.clear();
  await i18n.changeLanguage('en');
});

describe('PaymentRow — "Remind me" quick-create (UR-28-4)', () => {
  it('offers a Remind action on an unpaid row that opens the reminder dialog prefilled', async () => {
    const user = userEvent.setup();
    wrap(<PaymentRow row={row()} period={PERIOD} today={new Date(2026, 6, 16)} />);

    await user.click(screen.getByTestId('payment-row-remind'));

    const dialog = await screen.findByTestId('reminder-dialog');
    expect(dialog).toBeInTheDocument();
    // Text prefilled with the collect-payment template for the card + month.
    expect(screen.getByLabelText('Text')).toHaveValue('Collect payment from Марі for July');
    // Date prefilled to tomorrow (not today).
    const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
    expect(dateInput.value).not.toBe('');
    expect(dateInput.value > '2026-07-16').toBe(true);
  });

  it('does not offer a Remind action on a fully-paid row', () => {
    wrap(<PaymentRow row={row({ received: 250 })} period={PERIOD} today={new Date(2026, 6, 16)} />);
    expect(screen.queryByTestId('payment-row-remind')).not.toBeInTheDocument();
  });
});
