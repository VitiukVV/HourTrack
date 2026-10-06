import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { Toaster, toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import '@/lib/i18n/i18n';
import i18n from '@/lib/i18n/i18n';
import { createPayment, db, getAllPayments, updatePayment } from '@/lib/db';

import { EntryPaymentControl } from './EntryPaymentControl';

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      {node}
      <Toaster />
    </QueryClientProvider>,
  );
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

afterEach(() => {
  toast.dismiss();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await db.payments.clear();
  await db.tombstones.clear();
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
    const other: Entry = { ...entry, id: 'entry-2', cardId: 'card-2' };
    wrap(
      <>
        <EntryPaymentControl
          entry={entry}
          card={card({ rateType: 'monthly', hourlyRate: null, monthlyTotal: 400 })}
          allCardEntries={[entry]}
        />
        <EntryPaymentControl entry={other} card={card({ id: 'card-2' })} allCardEntries={[other]} />
      </>,
    );
    // The hourly control rendering proves the payment lookup has settled.
    await screen.findByTestId('entry-mark-paid');
    expect(screen.getAllByTestId('entry-mark-paid')).toHaveLength(1);
    expect(screen.queryByTestId('entry-paid')).not.toBeInTheDocument();
  });

  it('prefills a fixed-rate cleaning with its flat per-cleaning amount', async () => {
    const second: Entry = { ...entry, id: 'entry-2', date: '2026-07-12' };
    wrap(
      <EntryPaymentControl
        entry={entry}
        card={card({ rateType: 'fixed', hourlyRate: null, fixedTotal: 100 })}
        allCardEntries={[entry, second]}
      />,
    );
    await userEvent.click(await screen.findByTestId('entry-mark-paid'));
    expect(screen.getByLabelText(/amount/i)).toHaveValue(100);
  });

  it('Undo removes the payment and offers «Mark paid» again', async () => {
    wrap(<EntryPaymentControl entry={entry} card={card()} allCardEntries={[entry]} />);
    await userEvent.click(await screen.findByTestId('entry-mark-paid'));
    await userEvent.click(screen.getByTestId('mark-paid-confirm'));
    await screen.findByTestId('entry-paid');

    await userEvent.click(await screen.findByRole('button', { name: /^undo$/i }));
    expect(await screen.findByTestId('entry-mark-paid')).toBeInTheDocument();
    expect(await getAllPayments(db)).toHaveLength(0);
  });

  it('shows the read error and no «Mark paid» when the payment lookup fails', async () => {
    vi.spyOn(db.payments, 'filter').mockImplementation(() => {
      throw new Error('boom');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    wrap(<EntryPaymentControl entry={entry} card={card()} allCardEntries={[entry]} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load payments/i);
    expect(screen.queryByTestId('entry-mark-paid')).not.toBeInTheDocument();
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

const linked = {
  cardId: 'card-1',
  period: '2026-07',
  paidOn: '2026-07-05',
  note: null,
} as const;

describe('EntryPaymentControl — review fixes', () => {
  it('keeps what the user typed when another payment changes while the sheet is open', async () => {
    await createPayment(db, { ...linked, id: 'p1', amount: 40, entryId: 'entry-1' });
    await createPayment(db, { ...linked, id: 'p2', amount: 30, entryId: 'entry-9' });
    wrap(<EntryPaymentControl entry={entry} card={card()} allCardEntries={[entry]} />);
    await userEvent.click(await screen.findByTestId('entry-paid'));
    const amount = screen.getByLabelText(/amount/i);
    await userEvent.clear(amount);
    await userEvent.type(amount, '45');

    await updatePayment(db, 'p2', { note: 'synced from another device' });
    await new Promise((r) => setTimeout(r, 100));

    expect(screen.getByLabelText(/amount/i)).toHaveValue(45);
  });

  it('a failed remove closes the confirm but keeps the sheet and the payment', async () => {
    await createPayment(db, { ...linked, id: 'p1', amount: 40, entryId: 'entry-1' });
    vi.spyOn(db.payments, 'delete').mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    wrap(<EntryPaymentControl entry={entry} card={card()} allCardEntries={[entry]} />);
    await userEvent.click(await screen.findByTestId('entry-paid'));
    await userEvent.click(screen.getByTestId('mark-paid-remove'));
    await userEvent.click(await screen.findByRole('button', { name: /^remove$/i }));

    await waitFor(() => expect(screen.queryByText('Remove this payment?')).not.toBeInTheDocument());
    expect(screen.getByTestId('mark-paid-dialog')).toBeInTheDocument();
    expect(await getAllPayments(db)).toHaveLength(1);
  });
});
