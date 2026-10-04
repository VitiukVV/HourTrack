import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Payment } from '@hourtrack/shared-types';

import '@/lib/i18n/i18n';
import type * as dbModule from '@/lib/db';

import { PaymentHistory } from './PaymentHistory';

/**
 * Spec 007 — a failed payment delete used to close the dialog, leave the
 * payment in place and only log: the user had no idea why it was still there.
 */

type DbModule = typeof dbModule;

vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<DbModule>()),
  deletePayment: () => Promise.reject(new Error('disk full')),
}));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (msg: string) => toastError(msg) } }));

const payment: Payment = {
  id: 'p1',
  cardId: 'c1',
  period: '2026-05',
  amount: 100,
  paidOn: '2026-06-01',
  note: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

afterEach(() => {
  vi.restoreAllMocks();
  toastError.mockClear();
});

describe('PaymentHistory — failed delete', () => {
  it('tells the user when the delete fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PaymentHistory payments={[payment]} onEdit={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(screen.getByTestId('payment-history-delete'));
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'));
    await user.click(within(dialog).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  });
});
