import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, initDB } from '@/lib/db';
import type { Card } from '@hourtrack/shared-types';

import { DayPickerModal } from './DayPickerModal';

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
    color: '#2563EB',
    position: 0,
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    ...overrides,
  };
}

function renderModal(props: Partial<React.ComponentProps<typeof DayPickerModal>> = {}) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return render(
    <DayPickerModal open date="2026-05-14" onOpenChange={vi.fn()} onPick={vi.fn()} {...props} />,
    { wrapper: Wrapper },
  );
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-day-picker-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  await testDb.delete();
});

describe('DayPickerModal', () => {
  it('renders a row for each non-archived card with name + color dot + default duration label', async () => {
    await createCard(testDb, makeCardInput({ name: 'Raquel', defaultDurationMin: 165 }));
    await createCard(
      testDb,
      makeCardInput({ name: 'Hidden', isArchived: true, archivedAt: new Date().toISOString() }),
    );
    renderModal();

    // Visible card surfaces
    const raquel = await screen.findByRole('button', { name: /Raquel/i });
    expect(raquel).toBeInTheDocument();
    // Archived card not in list
    expect(screen.queryByRole('button', { name: /Hidden/i })).not.toBeInTheDocument();
    // Duration label uses formatDuration ("2h 45m")
    expect(raquel.textContent).toMatch(/2h\s*45m/);
  });

  it('lists the cards in the order the user chose (FR-005)', async () => {
    // The fourth surface FR-005 enumerates, alongside the header, the report
    // filters and the archive list. Ids run counter to the ranks so id order
    // cannot pass by accident.
    await createCard(testDb, makeCardInput({ id: 'c-a', name: 'Third', position: 2048 }));
    await createCard(testDb, makeCardInput({ id: 'c-b', name: 'First', position: 0 }));
    await createCard(testDb, makeCardInput({ id: 'c-c', name: 'Second', position: 1024 }));
    renderModal();

    await screen.findByRole('button', { name: /First/i });
    const names = screen
      .getAllByRole('button', { name: /First|Second|Third/i })
      .map((el) => el.textContent ?? '');
    expect(names.map((n) => n.match(/First|Second|Third/)?.[0])).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  it('renders the "+ Create new card and add" action button', async () => {
    renderModal();
    // The action is i18n-labelled as entries.dayPicker.createNew; English text:
    expect(await screen.findByRole('button', { name: /Create new card/i })).toBeInTheDocument();
  });

  it('calls onPick with the chosen card when the user clicks a row', async () => {
    const onPick = vi.fn();
    const card = await createCard(testDb, makeCardInput({ name: 'Picky' }));
    renderModal({ onPick });

    const user = userEvent.setup();
    const row = await screen.findByRole('button', { name: /Picky/i });
    await user.click(row);

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick.mock.calls[0]?.[0]?.id).toBe(card.id);
  });

  it('switches to the inline card form when "Create new card and add" is clicked', async () => {
    renderModal();
    const user = userEvent.setup();
    const createBtn = await screen.findByRole('button', { name: /Create new card/i });
    await user.click(createBtn);

    // CardForm reveals the Name input (label "Name" in en locale)
    expect(await screen.findByLabelText(/^Name$/i)).toBeInTheDocument();
  });

  it('renders an empty-state hint when no cards exist', async () => {
    renderModal();
    // The no-cards copy is cards.noCards in en locale.
    expect(
      await screen.findByText(/No cards yet|Card list is empty|create your first/i),
    ).toBeInTheDocument();
  });
});
