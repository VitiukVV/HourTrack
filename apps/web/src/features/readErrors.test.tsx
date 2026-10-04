import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@/lib/db';

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>();
  const fail = () => Promise.reject(new Error('read failed'));
  return {
    ...actual,
    getCardsOrdered: vi.fn(fail),
    getArchivedCardsOrdered: vi.fn(fail),
    listOpenReminders: vi.fn(fail),
  };
});

import '@/lib/i18n/i18n';
import i18n from '@/lib/i18n/i18n';
import { ArchivedCardsList } from '@/features/cards/ArchivedCardsList';
import { CardsHeader } from '@/features/cards/CardsHeader';
import { ReminderBell } from '@/features/reminders/ReminderBell';
import { ReportsFilters } from '@/features/reports/ReportsFilters';

/**
 * Spec 009 — a failed read says so; it is not shown as an empty list
 * ("no cards", "no archived cards", "no reminders").
 */

function renderWithQuery(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const loadFailed = () => i18n.t('common.loadFailed');

describe('read errors are not empty states', () => {
  it('CardsHeader', async () => {
    renderWithQuery(<CardsHeader />);
    expect(await screen.findByTestId('cards-header-load-failed')).toHaveTextContent(loadFailed());
    expect(screen.queryByText(i18n.t('cards.noCards'))).not.toBeInTheDocument();
  });

  it('ArchivedCardsList', async () => {
    renderWithQuery(<ArchivedCardsList onDeletePermanently={() => {}} />);
    expect(await screen.findByTestId('archived-cards-load-failed')).toHaveTextContent(loadFailed());
    expect(screen.queryByTestId('archived-cards-empty')).not.toBeInTheDocument();
  });

  it('ReportsFilters', async () => {
    renderWithQuery(<ReportsFilters />);
    expect(await screen.findByTestId('reports-filters-load-failed')).toHaveTextContent(
      loadFailed(),
    );
  });

  it('ReminderBell', async () => {
    renderWithQuery(<ReminderBell />);
    await userEvent.click(screen.getByTestId('reminder-bell'));
    expect(await screen.findByTestId('reminder-list-load-failed')).toHaveTextContent(loadFailed());
    expect(screen.queryByTestId('reminder-list-empty')).not.toBeInTheDocument();
  });
});
