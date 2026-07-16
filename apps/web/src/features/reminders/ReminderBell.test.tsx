import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import type { Reminder } from '@hourtrack/shared-types';

import '@/lib/i18n';
import i18n from '@/lib/i18n';
import { db } from '@/lib/db';

import { ReminderBell } from './ReminderBell';

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

async function seed(overrides: Partial<Reminder>): Promise<void> {
  const now = new Date().toISOString();
  await db.reminders.put({
    id: 'r-' + Math.random().toString(36).slice(2, 8),
    text: 'A reminder',
    dueDate: '2026-08-04',
    dueMinutes: 540,
    doneAt: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    notifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

beforeEach(async () => {
  await db.reminders.clear();
  await db.tombstones.clear();
  await db.syncQueue.clear();
  await i18n.changeLanguage('en');
});

describe('ReminderBell — due badge', () => {
  it('shows a badge counting only due, not-done reminders', async () => {
    await seed({ id: 'past', text: 'Past due', dueDate: '2020-01-01', dueMinutes: 0 });
    await seed({ id: 'future', text: 'Future', dueDate: '2999-01-01', dueMinutes: 0 });
    wrap(<ReminderBell />);
    const badge = await screen.findByTestId('reminder-bell-badge');
    expect(badge).toHaveTextContent('1');
  });

  it('renders no badge when nothing is due', async () => {
    await seed({ id: 'future', dueDate: '2999-01-01', dueMinutes: 0 });
    wrap(<ReminderBell />);
    await waitFor(() => expect(screen.getByTestId('reminder-bell')).toBeInTheDocument());
    expect(screen.queryByTestId('reminder-bell-badge')).not.toBeInTheDocument();
  });
});

describe('ReminderBell — list', () => {
  it('lists open reminders and marks a due one with the due flag', async () => {
    await seed({ id: 'past', text: 'Past due', dueDate: '2020-01-01', dueMinutes: 0 });
    await seed({ id: 'future', text: 'Future', dueDate: '2999-01-01', dueMinutes: 0 });
    const user = userEvent.setup();
    wrap(<ReminderBell />);
    await user.click(await screen.findByTestId('reminder-bell'));

    const items = await screen.findAllByTestId('reminder-item');
    expect(items).toHaveLength(2);
    // The due (past) reminder sorts first and carries data-due="true".
    expect(items[0]).toHaveAttribute('data-due', 'true');
    expect(items[0]).toHaveTextContent('Past due');
  });

  it('shows the empty state when there are no open reminders', async () => {
    const user = userEvent.setup();
    wrap(<ReminderBell />);
    await user.click(await screen.findByTestId('reminder-bell'));
    expect(await screen.findByTestId('reminder-list-empty')).toBeInTheDocument();
  });
});
