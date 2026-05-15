import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, createEntry, initDB } from '@/lib/db';
import type { Card, Entry } from '@hourtrack/shared-types';

import { EntryEditModal } from './EntryEditModal';

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

function renderModal({
  entryId,
  open,
  onOpenChange,
}: {
  entryId: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
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
  return render(<EntryEditModal entryId={entryId} open={open} onOpenChange={onOpenChange} />, {
    wrapper: Wrapper,
  });
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-entry-edit-modal-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  await testDb.delete();
});

describe('EntryEditModal', () => {
  it('prefills the form from the loaded entry (start time, hours, minutes)', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Raquel' }));
    const entry = await createEntry(
      testDb,
      makeEntryInput(card.id, '2026-05-14', { startMinutes: 8 * 60 + 30, durationMin: 165 }),
    );

    renderModal({ entryId: entry.id, open: true, onOpenChange: () => {} });

    const dialog = await screen.findByRole('dialog');
    // Wait for the async entry query to resolve and EntryEditor to mount.
    await within(dialog).findByTestId('entry-editor');

    const timeInput = within(dialog).getByLabelText(/start time/i) as HTMLInputElement;
    const hoursInput = within(dialog).getByLabelText(/^hours/i) as HTMLInputElement;
    const minutesInput = within(dialog).getByLabelText(/^minutes/i) as HTMLInputElement;

    expect(timeInput.value).toBe('08:30');
    expect(hoursInput.value).toBe('2');
    expect(minutesInput.value).toBe('45');
  });

  it('saving an edited start time persists via useUpdateEntryMutation and closes the modal', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Save' }));
    const entry = await createEntry(
      testDb,
      makeEntryInput(card.id, '2026-05-14', { startMinutes: 540 }),
    );

    const onOpenChange = vi.fn();
    renderModal({ entryId: entry.id, open: true, onOpenChange });

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('entry-editor');
    const timeInput = within(dialog).getByLabelText(/start time/i);

    // happy-dom doesn't emulate native time-input keyboard entry — use
    // fireEvent.change to deliver the picker-equivalent value.
    fireEvent.change(timeInput, { target: { value: '14:00' } });

    const saveButton = within(dialog).getByRole('button', { name: /save/i });
    const user = userEvent.setup();
    await user.click(saveButton);

    await waitFor(async () => {
      const updated = await testDb.entries.get(entry.id);
      expect(updated?.startMinutes).toBe(14 * 60);
    });

    // After a successful save the modal closes — `onOpenChange(false)` fires.
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('Cancel with no dirty changes closes the modal immediately (no confirm dialog)', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Clean' }));
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));

    const onOpenChange = vi.fn();
    renderModal({ entryId: entry.id, open: true, onOpenChange });

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('entry-editor');
    const cancelButton = await within(dialog).findByRole('button', { name: /cancel/i });

    const user = userEvent.setup();
    await user.click(cancelButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);

    // The dirty-confirm dialog (with "Discard changes?" title) must NOT have
    // surfaced — there's only the editor dialog in the DOM.
    expect(screen.queryByText(/discard changes/i)).not.toBeInTheDocument();
  });

  it('Cancel with dirty changes opens the discard-changes confirmation dialog', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Dirty' }));
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));

    const onOpenChange = vi.fn();
    renderModal({ entryId: entry.id, open: true, onOpenChange });

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('entry-editor');
    const hoursInput = within(dialog).getByLabelText(/^hours/i);

    const user = userEvent.setup();
    await user.clear(hoursInput);
    await user.type(hoursInput, '5');

    const cancelButton = within(dialog).getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    // Discard-changes confirm dialog surfaces — modal not closed yet.
    const discardTitle = await screen.findByText(/discard changes/i);
    expect(discardTitle).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('Confirming "discard changes" closes the modal without saving', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Discard' }));
    const entry = await createEntry(
      testDb,
      makeEntryInput(card.id, '2026-05-14', { durationMin: 60 }),
    );

    const onOpenChange = vi.fn();
    renderModal({ entryId: entry.id, open: true, onOpenChange });

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('entry-editor');
    const hoursInput = within(dialog).getByLabelText(/^hours/i);

    const user = userEvent.setup();
    await user.clear(hoursInput);
    await user.type(hoursInput, '5');

    const cancelButton = within(dialog).getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    // All dialogs in the DOM — the second one is the discard confirm. Its
    // confirm button is labelled by `entryEdit.discardChanges.confirm`
    // ("Discard" in en). Look for it.
    const allDialogs = await screen.findAllByRole('dialog');
    const discardDialog = allDialogs.find((d) => /discard changes/i.test(d.textContent ?? ''));
    expect(discardDialog).toBeDefined();
    const confirmButton = within(discardDialog!).getByRole('button', { name: /^discard$/i });
    await user.click(confirmButton);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    // DB unchanged — discarding does NOT save.
    const still = await testDb.entries.get(entry.id);
    expect(still?.durationMin).toBe(60);
  });

  it('Delete from the modal footer removes the entry and closes', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Del' }));
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));

    const onOpenChange = vi.fn();
    renderModal({ entryId: entry.id, open: true, onOpenChange });

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('entry-editor');
    const deleteButton = within(dialog).getByRole('button', { name: /delete/i });

    const user = userEvent.setup();
    await user.click(deleteButton);

    // Delete confirm dialog
    const allDialogs = await screen.findAllByRole('dialog');
    const confirmDialog = allDialogs.find((d) => /delete entry\?/i.test(d.textContent ?? ''));
    expect(confirmDialog).toBeDefined();
    const confirmBtn = within(confirmDialog!).getByRole('button', { name: /delete/i });
    await user.click(confirmBtn);

    await waitFor(async () => {
      const gone = await testDb.entries.get(entry.id);
      expect(gone).toBeUndefined();
    });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('does NOT render anything when entryId is null (idle state)', async () => {
    renderModal({ entryId: null, open: false, onOpenChange: () => {} });
    // Radix Dialog with open=false never mounts the content.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the modal header with the project name', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Acme Inc' }));
    const entry = await createEntry(testDb, makeEntryInput(card.id, '2026-05-14'));

    renderModal({ entryId: entry.id, open: true, onOpenChange: () => {} });

    const dialog = await screen.findByRole('dialog');
    // Wait for the card query to resolve so the title interpolates with the
    // card name. Until then the title shows the ellipsis fallback. The
    // editor query and the card query are independent async hops. The
    // card name appears in TWO places (dialog title + EntryEditor header
    // chip) once both queries resolve — assert via `findAllByText` so the
    // multi-match isn't a getByText violation.
    await within(dialog).findByTestId('entry-editor');
    const matches = await within(dialog).findAllByText(/Acme Inc/, undefined, {
      timeout: 3000,
    });
    expect(matches.length).toBeGreaterThan(0);
    // Specifically the H2 dialog title carries the interpolation.
    const heading = within(dialog).getByRole('heading');
    expect(heading.textContent).toMatch(/Acme Inc/);
  });
});
