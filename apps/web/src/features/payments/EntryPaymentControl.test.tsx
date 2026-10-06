import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import '@/lib/i18n/i18n';
import i18n from '@/lib/i18n/i18n';
import { createPayment, db, getAllPayments } from '@/lib/db';

import { EntryPaymentControl } from './EntryPaymentControl';

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    name: 'Amparo',
    color: '#2563EB',
    position: 0,
    defaultDurationMin: 60,
    defaultStartMinutes: 540,
    rateType: 'hourly',
    hourlyRate: 14,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const entry: Entry = {
  id: 'entry-1',
  cardId: 'card-1',
  date: '2026-07-05',
  startMinutes: 600,
  durationMin: 180,
  useCustomPayment: false,
  customPayment: null,
  note: null,
  googleEventId: null,
  syncStatus: 'synced',
  syncError: null,
  createdAt: '2026-07-05T00:00:00.000Z',
  updatedAt: '2026-07-05T00:00:00.000Z',
};

beforeEach(async () => {
  await db.payments.clear();
  await i18n.changeLanguage('en');
});

describe('EntryPaymentControl — US1 record a payment', () => {
  it('prefills the cleaning earnings and date, and links the payment to the cleaning', async () => {
    wrap(<EntryPaymentControl entry={entry} card={card()} allCardEntries={[entry]} />);
    await userEvent.click(await screen.findByTestId('entry-mark-paid'));

    expect(screen.getByLabelText(/amount/i)).toHaveValue(42);
    expect(screen.getByLabelText(/paid on/i)).toHaveValue('2026-07-05');

    await userEvent.click(screen.getByTestId('mark-paid-confirm'));
    await waitFor(async () => expect(await getAllPayments(db)).toHaveLength(1));
    const [payment] = await getAllPayments(db);
    expect(payment).toMatchObject({
      cardId: 'card-1',
      period: '2026-07',
      amount: 42,
      paidOn: '2026-07-05',
      entryId: 'entry-1',
    });
  });

  it('is not offered for a monthly client', async () => {
    wrap(
      <EntryPaymentControl
        entry={entry}
        card={card({ rateType: 'monthly', hourlyRate: null, monthlyTotal: 400 })}
        allCardEntries={[entry]}
      />,
    );
    // Give the live read a chance to settle before asserting absence.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('entry-mark-paid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('entry-paid')).not.toBeInTheDocument();
  });
});

describe('EntryPaymentControl — US2 see / change the payment', () => {
  it('shows «Paid X EUR» for a linked payment and edits it instead of adding one', async () => {
    await createPayment(db, {
      id: 'p1',
      cardId: 'card-1',
      period: '2026-07',
      amount: 40,
      paidOn: '2026-07-05',
      note: null,
      entryId: 'entry-1',
    });
    wrap(<EntryPaymentControl entry={entry} card={card()} allCardEntries={[entry]} />);

    const paid = await screen.findByTestId('entry-paid');
    expect(paid).toHaveTextContent('40.00');
    expect(screen.queryByTestId('entry-mark-paid')).not.toBeInTheDocument();

    await userEvent.click(paid);
    const amount = screen.getByLabelText(/amount/i);
    expect(amount).toHaveValue(40);
    await userEvent.clear(amount);
    await userEvent.type(amount, '45');
    await userEvent.click(screen.getByTestId('mark-paid-confirm'));

    await waitFor(async () => expect((await getAllPayments(db))[0]?.amount).toBe(45));
    expect(await getAllPayments(db)).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId('entry-paid')).toHaveTextContent('45.00'));
  });

  it('reflects a payment removed elsewhere (e.g. the Payments page)', async () => {
    await createPayment(db, {
      id: 'p1',
      cardId: 'card-1',
      period: '2026-07',
      amount: 40,
      paidOn: '2026-07-05',
      note: null,
      entryId: 'entry-1',
    });
    wrap(<EntryPaymentControl entry={entry} card={card()} allCardEntries={[entry]} />);
    await screen.findByTestId('entry-paid');

    await db.payments.delete('p1');
    expect(await screen.findByTestId('entry-mark-paid')).toBeInTheDocument();
  });
});

describe('EntryPaymentControl — US2 remove the payment', () => {
  it('removes the linked payment after a confirm, and offers «Mark paid» again', async () => {
    await createPayment(db, {
      id: 'p1',
      cardId: 'card-1',
      period: '2026-07',
      amount: 40,
      paidOn: '2026-07-05',
      note: null,
      entryId: 'entry-1',
    });
    wrap(<EntryPaymentControl entry={entry} card={card()} allCardEntries={[entry]} />);
    await userEvent.click(await screen.findByTestId('entry-paid'));

    await userEvent.click(screen.getByTestId('mark-paid-remove'));
    await userEvent.click(await screen.findByRole('button', { name: /^remove$/i }));

    expect(await screen.findByTestId('entry-mark-paid')).toBeInTheDocument();
    expect(await getAllPayments(db)).toHaveLength(0);
  });
});
