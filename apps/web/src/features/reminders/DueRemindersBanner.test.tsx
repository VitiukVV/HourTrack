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

import { DueRemindersBanner } from './DueRemindersBanner';

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
    dueDate: '2020-01-01',
    dueMinutes: 0,
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

describe('DueRemindersBanner', () => {
  it('shows a due, not-done reminder', async () => {
    await seed({ id: 'due', text: 'Collect cash' });
    wrap(<DueRemindersBanner />);
    expect(await screen.findByTestId('due-reminders-banner')).toBeInTheDocument();
    expect(screen.getByText('Collect cash')).toBeInTheDocument();
  });

  it('does not render when the only reminder is not yet due', async () => {
    await seed({ id: 'future', dueDate: '2999-01-01' });
    wrap(<DueRemindersBanner />);
    await waitFor(() => {
      expect(screen.queryByTestId('due-reminders-banner')).not.toBeInTheDocument();
    });
  });

  it('does not render a done reminder', async () => {
    await seed({ id: 'done', doneAt: new Date().toISOString() });
    wrap(<DueRemindersBanner />);
    await waitFor(() => {
      expect(screen.queryByTestId('due-reminders-banner')).not.toBeInTheDocument();
    });
  });

  it('Done clears the reminder from the banner', async () => {
    await seed({ id: 'due', text: 'Collect cash' });
    const user = userEvent.setup();
    wrap(<DueRemindersBanner />);
    await screen.findByTestId('due-reminders-banner');
    await user.click(screen.getByTestId('due-reminder-done'));
    await waitFor(() => {
      expect(screen.queryByTestId('due-reminders-banner')).not.toBeInTheDocument();
    });
    expect((await db.reminders.get('due'))?.doneAt).not.toBeNull();
  });

  it('dismiss (X) hides the banner without marking done', async () => {
    await seed({ id: 'due', text: 'Collect cash' });
    const user = userEvent.setup();
    wrap(<DueRemindersBanner />);
    await screen.findByTestId('due-reminders-banner');
    await user.click(screen.getByTestId('due-reminders-dismiss'));
    await waitFor(() => {
      expect(screen.queryByTestId('due-reminders-banner')).not.toBeInTheDocument();
    });
    // Dismiss ≠ done — the reminder is still open.
    expect((await db.reminders.get('due'))?.doneAt).toBeNull();
  });
});
