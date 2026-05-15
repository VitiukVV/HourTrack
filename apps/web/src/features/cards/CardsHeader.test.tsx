import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, initDB } from '@/lib/db';
import type { Card } from '@hourtrack/shared-types';

import { CardsHeader } from './CardsHeader';
import { useActiveCardStore } from './useActiveCardStore';

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

function renderHeader() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return render(<CardsHeader />, { wrapper: Wrapper });
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-header-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
  sessionStorage.clear();
  useActiveCardStore.getState().clearActive();
});

afterEach(async () => {
  await testDb.delete();
  sessionStorage.clear();
});

describe('CardsHeader', () => {
  it('renders the + Add card button', async () => {
    renderHeader();
    expect(await screen.findByRole('button', { name: /Add card/i })).toBeInTheDocument();
    // Wait for query to settle so no state update happens after the test ends.
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
  });

  it('renders chips for non-archived cards and hides archived cards', async () => {
    await createCard(testDb, makeCardInput({ name: 'Active1' }));
    await createCard(testDb, makeCardInput({ name: 'Active2', color: '#EF4444' }));
    await createCard(
      testDb,
      makeCardInput({
        name: 'ArchivedOne',
        isArchived: true,
        archivedAt: new Date().toISOString(),
      }),
    );

    renderHeader();

    expect(await screen.findByRole('button', { name: /Active1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Active2/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ArchivedOne/i })).not.toBeInTheDocument();
  });

  it('clicking a chip activates that card in the store', async () => {
    const user = userEvent.setup();
    const card = await createCard(testDb, makeCardInput({ name: 'Toggle' }));

    renderHeader();

    const chip = await screen.findByRole('button', { name: /Toggle/i });
    await user.click(chip);

    expect(useActiveCardStore.getState().activeCardId).toBe(card.id);
  });

  it('clicking the active chip again toggles it off', async () => {
    const user = userEvent.setup();
    const card = await createCard(testDb, makeCardInput({ name: 'Toggle' }));
    useActiveCardStore.getState().setActiveCardId(card.id);

    renderHeader();

    const chip = await screen.findByRole('button', { name: /Toggle/i });
    await user.click(chip);

    expect(useActiveCardStore.getState().activeCardId).toBeNull();
  });

  it('clicking + Add card opens the create modal', async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(await screen.findByRole('button', { name: /Add card/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Create card/i })).toBeInTheDocument();
  });

  it('right-click on a chip opens the context menu with Edit and Archive', async () => {
    await createCard(testDb, makeCardInput({ name: 'Contextual' }));

    renderHeader();

    const chip = await screen.findByRole('button', { name: /Contextual/i });
    // Radix `<ContextMenu.Trigger>` listens on the synthesized `contextmenu`
    // event and opens its content via a portal. happy-dom dispatches the
    // event correctly; we wrap in act() so React flushes the resulting
    // state updates before the assertion.
    act(() => {
      chip.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
      );
    });

    // Radix portal renders into document.body; use `findByRole` which waits
    // through the portal placement effect.
    expect(await screen.findByRole('menuitem', { name: /Edit/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Archive/i })).toBeInTheDocument();
  });
});
