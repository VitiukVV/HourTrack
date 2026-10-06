import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { formatLocalDate } from '@hourtrack/shared-utils';

import '@/lib/i18n/i18n';
import i18n from '@/lib/i18n/i18n';
import { db, getAllPayments } from '@/lib/db';

import { MarkPaidDialog } from './MarkPaidDialog';

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const base = {
  open: true,
  onOpenChange: () => {},
  cardId: 'card-1',
  cardName: 'Amparo',
  period: '2026-07',
  remaining: 42,
};

beforeEach(async () => {
  await db.payments.clear();
  await i18n.changeLanguage('en');
});

describe('MarkPaidDialog — create mode', () => {
  it('Payments-page call: today as the date, no entry link', async () => {
    wrap(<MarkPaidDialog {...base} />);
    expect(screen.getByLabelText(/paid on/i)).toHaveValue(formatLocalDate(new Date()));
    await userEvent.click(screen.getByTestId('mark-paid-confirm'));
    await waitFor(async () => expect(await getAllPayments(db)).toHaveLength(1));
    const [payment] = await getAllPayments(db);
    expect(payment).toMatchObject({ amount: 42, period: '2026-07' });
    expect(payment!.entryId ?? null).toBeNull();
  });

  it('cleaning-card call (010): prefills the cleaning date and stamps entryId', async () => {
    wrap(<MarkPaidDialog {...base} entryId="entry-1" defaultPaidOn="2026-07-05" />);
    expect(screen.getByLabelText(/paid on/i)).toHaveValue('2026-07-05');
    await userEvent.click(screen.getByTestId('mark-paid-confirm'));
    await waitFor(async () => expect(await getAllPayments(db)).toHaveLength(1));
    const [payment] = await getAllPayments(db);
    expect(payment).toMatchObject({
      amount: 42,
      paidOn: '2026-07-05',
      period: '2026-07',
      entryId: 'entry-1',
    });
  });
});

describe('MarkPaidDialog — edit mode on the Payments page', () => {
  it('offers no remove action (payment history already has delete)', () => {
    wrap(
      <MarkPaidDialog
        {...base}
        payment={{
          id: 'p1',
          cardId: 'card-1',
          period: '2026-07',
          amount: 40,
          paidOn: '2026-07-05',
          note: null,
          createdAt: '2026-07-05T00:00:00.000Z',
          updatedAt: '2026-07-05T00:00:00.000Z',
        }}
      />,
    );
    expect(screen.queryByTestId('mark-paid-remove')).not.toBeInTheDocument();
  });
});
