import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Payment } from '@hourtrack/shared-types';

import '@/lib/i18n/i18n';

import { PaymentHistory } from './PaymentHistory';

/**
 * Spec 007 — a failed payment delete used to close the dialog, leave the
 * payment in place and only log: the user had no idea why it was still there.
 */

const mutateAsync = vi.fn();
vi.mock('./usePayments', () => ({ useDeletePaymentMutation: () => ({ mutateAsync }) }));
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
    mutateAsync.mockRejectedValueOnce(new Error('disk full'));
    const user = userEvent.setup();
    render(<PaymentHistory payments={[payment]} onEdit={vi.fn()} />);

    await user.click(screen.getByTestId('payment-history-delete'));
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'));
    await user.click(within(dialog).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  });
});
