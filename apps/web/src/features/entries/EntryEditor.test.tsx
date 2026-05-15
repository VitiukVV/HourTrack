import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, createEntry, initDB } from '@/lib/db';
import type { Card, Entry } from '@hourtrack/shared-types';

import { EntryEditor } from './EntryEditor';

let testDb: HourTrackDB;
type DbModule = typeof dbModule;

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<DbModule>();
  return {
    ...actual,
    get db() {
      return testDb;
    },
  };
});

function makeCardInput(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    name: 'Card',
    color: '#3B82F6',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    ...overrides,
  };
}

function makeEntryInput(
  cardId: string,
  date: string,
  overrides: Partial<Entry> = {},
): Omit<Entry, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    cardId,
    date,
    startMinutes: 600,
    durationMin: 120,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    ...overrides,
  };
}

function renderEditor({
  entry,
  card,
  allCardEntries,
}: {
  entry: Entry;
  card: Card;
  allCardEntries: Entry[];
}) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return render(<EntryEditor entry={entry} card={card} allCardEntries={allCardEntries} />, {
    wrapper: Wrapper,
  });
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-entry-editor-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  await testDb.delete();
});

describe('EntryEditor', () => {
  it('renders card name + color chip in the row header', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Raquel', color: '#EF4444' }));
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));

    renderEditor({ entry, card, allCardEntries: [entry] });

    expect(screen.getByText('Raquel')).toBeInTheDocument();
    expect(screen.getByTestId('entry-editor')).toHaveAttribute('data-card-color', '#EF4444');
  });

  it('renders hours and minutes inputs prefilled from the entry durationMin', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'C' }));
    const entry = await createEntry(
      testDb,
      makeEntryInput(card.id, '2026-05-14', { durationMin: 165 }), // 2H 45M
    );

    renderEditor({ entry, card, allCardEntries: [entry] });

    const hoursInput = screen.getByLabelText(/hours/i) as HTMLInputElement;
    const minutesInput = screen.getByLabelText(/minutes/i) as HTMLInputElement;
    expect(hoursInput.value).toBe('2');
    expect(minutesInput.value).toBe('45');
  });

  it('shows earnings computed from hours × hourly rate (read-only, 2dp EUR)', async () => {
    const card = await createCard(
      testDb,
      makeCardInput({ name: 'H', rateType: 'hourly', hourlyRate: 30 }),
    );
    const entry = await createEntry(
      testDb,
      makeEntryInput(card.id, '2026-05-14', { durationMin: 120 }), // 2h × 30 = 60.00
    );

    renderEditor({ entry, card, allCardEntries: [entry] });

    const editor = screen.getByTestId('entry-editor');
    expect(editor.textContent).toMatch(/60\.00/);
  });

  it('recomputes earnings live when hours change (hourly card)', async () => {
    const card = await createCard(
      testDb,
      makeCardInput({ name: 'Live', rateType: 'hourly', hourlyRate: 20 }),
    );
    const entry = await createEntry(
      testDb,
      makeEntryInput(card.id, '2026-05-14', { durationMin: 60 }),
    );

    renderEditor({ entry, card, allCardEntries: [entry] });

    const user = userEvent.setup();
    const hoursInput = screen.getByLabelText(/hours/i);

    await user.clear(hoursInput);
    await user.type(hoursInput, '3');

    const editor = screen.getByTestId('entry-editor');
    // 3h × 20 = 60.00
    await waitFor(() => expect(editor.textContent).toMatch(/60\.00/));
  });

  it('custom payment toggle ON reveals amount input and uses it as earnings', async () => {
    const card = await createCard(
      testDb,
      makeCardInput({ name: 'CP', rateType: 'hourly', hourlyRate: 10 }),
    );
    const entry = await createEntry(
      testDb,
      makeEntryInput(card.id, '2026-05-14', { durationMin: 60 }),
    );

    renderEditor({ entry, card, allCardEntries: [entry] });

    // Initially OFF: amount input not rendered
    expect(screen.queryByLabelText(/amount/i)).not.toBeInTheDocument();

    const user = userEvent.setup();
    const toggle = screen.getByRole('switch', { name: /custom payment/i });
    await user.click(toggle);

    // Amount input now visible
    const amountInput = await screen.findByLabelText(/amount/i);
    await user.clear(amountInput);
    await user.type(amountInput, '125');

    const editor = screen.getByTestId('entry-editor');
    await waitFor(() => expect(editor.textContent).toMatch(/125\.00/));
  });

  it('custom payment toggle OFF hides amount input (state preserved)', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Toggle' }));
    const entry = await createEntry(
      testDb,
      makeEntryInput(card.id, '2026-05-14', { useCustomPayment: true, customPayment: 50 }),
    );

    renderEditor({ entry, card, allCardEntries: [entry] });

    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();

    const user = userEvent.setup();
    const toggle = screen.getByRole('switch', { name: /custom payment/i });
    await user.click(toggle);

    expect(screen.queryByLabelText(/amount/i)).not.toBeInTheDocument();
  });

  it('save button persists updates via useUpdateEntryMutation', async () => {
    const card = await createCard(
      testDb,
      makeCardInput({ name: 'Save', rateType: 'hourly', hourlyRate: 20 }),
    );
    const entry = await createEntry(
      testDb,
      makeEntryInput(card.id, '2026-05-14', { durationMin: 60 }),
    );

    renderEditor({ entry, card, allCardEntries: [entry] });

    const user = userEvent.setup();
    const hoursInput = screen.getByLabelText(/hours/i);
    await user.clear(hoursInput);
    await user.type(hoursInput, '3');

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(async () => {
      const updated = await testDb.entries.get(entry.id);
      expect(updated?.durationMin).toBe(180);
    });
  });

  it('save button is disabled when form has no dirty fields', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Pristine' }));
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));

    renderEditor({ entry, card, allCardEntries: [entry] });

    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it('delete button opens ConfirmDialog and deletes on confirm', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'DEL' }));
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));

    renderEditor({ entry, card, allCardEntries: [entry] });

    const user = userEvent.setup();
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    // Confirm dialog visible
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    const confirmButton = within(dialog).getByRole('button', { name: /delete/i });
    await user.click(confirmButton);

    await waitFor(async () => {
      const gone = await testDb.entries.get(entry.id);
      expect(gone).toBeUndefined();
    });
  });

  it('does not delete when ConfirmDialog cancel is clicked', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Keep' }));
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));

    renderEditor({ entry, card, allCardEntries: [entry] });

    const user = userEvent.setup();
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    const dialog = await screen.findByRole('dialog');
    const cancelButton = within(dialog).getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    const still = await testDb.entries.get(entry.id);
    expect(still).toBeDefined();
  });

  it('shows inline validation error when hours > 23 and prevents save', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'V' }));
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));

    renderEditor({ entry, card, allCardEntries: [entry] });

    const user = userEvent.setup();
    const hoursInput = screen.getByLabelText(/hours/i);
    await user.clear(hoursInput);
    await user.type(hoursInput, '24');

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    expect(await screen.findByRole('alert')).toHaveTextContent(/0 and 23|hours/i);

    // DB unchanged
    const still = await testDb.entries.get(entry.id);
    expect(still?.durationMin).toBe(120);
  });

  it('renders note textarea prefilled with entry.note and saves edits', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'N' }));
    const entry = await createEntry(
      testDb,
      makeEntryInput(card.id, '2026-05-14', { note: 'initial' }),
    );

    renderEditor({ entry, card, allCardEntries: [entry] });

    const noteInput = screen.getByLabelText(/note/i) as HTMLTextAreaElement;
    expect(noteInput.value).toBe('initial');

    const user = userEvent.setup();
    await user.clear(noteInput);
    await user.type(noteInput, 'updated note');

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(async () => {
      const updated = await testDb.entries.get(entry.id);
      expect(updated?.note).toBe('updated note');
    });
  });
});
