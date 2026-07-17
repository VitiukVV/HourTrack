import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import '@/lib/i18n';
import i18n from '@/lib/i18n';
import { db } from '@/lib/db';

import { ReminderDialog } from './ReminderDialog';

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(async () => {
  await db.reminders.clear();
  await db.tombstones.clear();
  await db.syncQueue.clear();
  await i18n.changeLanguage('en');
});

describe('ReminderDialog — validation', () => {
  it('shows a required-text error when submitting an empty reminder', async () => {
    const user = userEvent.setup();
    wrap(<ReminderDialog open onOpenChange={vi.fn()} reminder={null} />);
    await user.click(screen.getByTestId('reminder-confirm'));
    expect(await screen.findByText('Enter the reminder text')).toBeInTheDocument();
    expect(await db.reminders.count()).toBe(0);
  });
});

describe('ReminderDialog — create', () => {
  it('creates a reminder and closes on save', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    wrap(<ReminderDialog open onOpenChange={onOpenChange} reminder={null} />);

    await user.type(screen.getByLabelText('Text'), 'Collect from Mary');
    await user.click(screen.getByTestId('reminder-confirm'));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const all = await db.reminders.toArray();
    expect(all).toHaveLength(1);
    expect(all[0]!.text).toBe('Collect from Mary');
    expect(all[0]!.doneAt).toBeNull();
  });

  it('prefills the text from the `prefill` prop (payments quick-create)', async () => {
    wrap(
      <ReminderDialog
        open
        onOpenChange={vi.fn()}
        prefill={{ text: 'Collect payment from Mary for July', dueDate: '2026-08-05' }}
      />,
    );
    expect(screen.getByLabelText('Text')).toHaveValue('Collect payment from Mary for July');
    expect(screen.getByLabelText('Date')).toHaveValue('2026-08-05');
  });
});

describe('ReminderDialog — edit', () => {
  it('seeds fields from an existing reminder and updates on save', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    await db.reminders.put({
      id: 'r1',
      text: 'Old text',
      dueDate: '2026-08-04',
      dueMinutes: 540,
      doneAt: null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
      notifiedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const reminder = (await db.reminders.get('r1'))!;
    wrap(<ReminderDialog open onOpenChange={vi.fn()} reminder={reminder} />);

    const textField = screen.getByLabelText('Text');
    expect(textField).toHaveValue('Old text');
    await user.clear(textField);
    await user.type(textField, 'New text');
    await user.click(screen.getByTestId('reminder-confirm'));

    await waitFor(async () => expect((await db.reminders.get('r1'))?.text).toBe('New text'));
  });
});
