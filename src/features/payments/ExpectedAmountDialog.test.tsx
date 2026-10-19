import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n/i18n';
import i18n from '@/lib/i18n/i18n';
import * as dbModule from '@/lib/db';
import { db, getAllMonthAdjustments, setMonthAdjustment } from '@/lib/db';

import { ExpectedAmountDialog } from './ExpectedAmountDialog';

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const base = {
  open: true,
  cardId: 'card-1',
  cardName: 'Casa',
  period: '2026-10',
  expected: 250,
  calculated: 250,
  adjusted: false,
};

beforeEach(async () => {
  await db.monthAdjustments.clear();
  await i18n.changeLanguage('en');
  vi.restoreAllMocks();
});

async function typeAmount(value: string) {
  const input = screen.getByLabelText(/expected amount/i);
  await userEvent.clear(input);
  if (value) await userEvent.type(input, value);
}

describe('ExpectedAmountDialog', () => {
  it('prefills the current expected amount and saves a new one for that month', async () => {
    const onOpenChange = vi.fn();
    wrap(<ExpectedAmountDialog {...base} onOpenChange={onOpenChange} />);
    expect(screen.getByLabelText(/expected amount/i)).toHaveValue(250);
    expect(screen.queryByTestId('expected-amount-reset')).toBeNull();

    await typeAmount('200');
    await userEvent.click(screen.getByTestId('expected-amount-save'));

    await waitFor(async () =>
      expect(await getAllMonthAdjustments(db)).toEqual([
        expect.objectContaining({ cardId: 'card-1', period: '2026-10', amount: 200 }),
      ]),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('accepts 0', async () => {
    wrap(<ExpectedAmountDialog {...base} onOpenChange={() => {}} />);
    await typeAmount('0');
    await userEvent.click(screen.getByTestId('expected-amount-save'));
    await waitFor(async () =>
      expect(await getAllMonthAdjustments(db)).toEqual([expect.objectContaining({ amount: 0 })]),
    );
  });

  it.each([
    ['', /enter an amount/i],
    ['-5', /0 or more/i],
    ['12.345', /cents/i],
    ['1000001', /too large/i],
  ])('rejects %j with a message and saves nothing', async (value, message) => {
    wrap(<ExpectedAmountDialog {...base} onOpenChange={() => {}} />);
    await typeAmount(value);
    await userEvent.click(screen.getByTestId('expected-amount-save'));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(await getAllMonthAdjustments(db)).toEqual([]);
  });

  it('shows the calculated amount and resets an adjusted month', async () => {
    await setMonthAdjustment(db, { cardId: 'card-1', period: '2026-10', amount: 200 });
    const onOpenChange = vi.fn();
    wrap(<ExpectedAmountDialog {...base} expected={200} adjusted onOpenChange={onOpenChange} />);
    expect(screen.getByText(/card rate: 250 €/i)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('expected-amount-reset'));
    await waitFor(async () => expect(await getAllMonthAdjustments(db)).toEqual([]));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('a failed save toasts and keeps the sheet open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => 'id');
    vi.spyOn(dbModule, 'setMonthAdjustment').mockRejectedValue(new Error('disk full'));
    const onOpenChange = vi.fn();
    wrap(<ExpectedAmountDialog {...base} onOpenChange={onOpenChange} />);
    await typeAmount('200');
    await userEvent.click(screen.getByTestId('expected-amount-save'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('cancel writes nothing', async () => {
    const onOpenChange = vi.fn();
    wrap(<ExpectedAmountDialog {...base} onOpenChange={onOpenChange} />);
    await typeAmount('200');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(await getAllMonthAdjustments(db)).toEqual([]);
  });

  it('keeps what the user typed when the row updates while open', async () => {
    const { rerender } = wrap(<ExpectedAmountDialog {...base} onOpenChange={() => {}} />);
    await typeAmount('199');
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ExpectedAmountDialog {...base} expected={260} calculated={260} onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText(/expected amount/i)).toHaveValue(199);
  });

  it('a failed write says the change, not a payment, failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => 'id');
    vi.spyOn(dbModule, 'deleteMonthAdjustment').mockRejectedValue(new Error('disk full'));
    await setMonthAdjustment(db, { cardId: 'card-1', period: '2026-10', amount: 200 });
    const onOpenChange = vi.fn();
    wrap(<ExpectedAmountDialog {...base} expected={200} adjusted onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByTestId('expected-amount-reset'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(i18n.t('common.saveFailed')));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(await getAllMonthAdjustments(db)).toHaveLength(1);
  });
});
