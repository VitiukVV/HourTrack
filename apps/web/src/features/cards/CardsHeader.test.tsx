import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/lib/i18n';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, initDB } from '@/lib/db';
import type { Card } from '@hourtrack/shared-types';

import { resolveCardReorder } from './cardReorder';
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
    await createCard(testDb, makeCardInput({ name: 'Active2', color: '#DC2626' }));
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

// S19 (Task 19) — 3-dot menu visibility + actions; chip equal-width.
describe('CardsHeader — S19 active-card menu (UR-19-7)', () => {
  it('does NOT render the 3-dot menu when no card is active', async () => {
    await createCard(testDb, makeCardInput({ name: 'Idle' }));

    renderHeader();

    await screen.findByRole('button', { name: /Idle/i });
    expect(screen.queryByTestId('cards-header-active-menu-trigger')).not.toBeInTheDocument();
  });

  it('renders the 3-dot menu next to the + button when a card is active', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Active' }));
    useActiveCardStore.getState().setActiveCardId(card.id);

    renderHeader();

    expect(await screen.findByTestId('cards-header-active-menu-trigger')).toBeInTheDocument();
  });

  it('clicking 3-dot → Edit opens the edit modal pre-filled with the active card', async () => {
    const user = userEvent.setup();
    const card = await createCard(testDb, makeCardInput({ name: 'Editable' }));
    useActiveCardStore.getState().setActiveCardId(card.id);

    renderHeader();

    await user.click(await screen.findByTestId('cards-header-active-menu-trigger'));
    // The DropdownMenu portal renders the items into document.body.
    await user.click(await screen.findByTestId('cards-header-active-menu-edit'));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Edit card/i })).toBeInTheDocument();
  });

  it('clicking 3-dot → Archive → confirm archives the active card', async () => {
    const user = userEvent.setup();
    const card = await createCard(testDb, makeCardInput({ name: 'Archivable' }));
    useActiveCardStore.getState().setActiveCardId(card.id);

    renderHeader();

    await user.click(await screen.findByTestId('cards-header-active-menu-trigger'));
    await user.click(await screen.findByTestId('cards-header-active-menu-archive'));

    // Archive now goes through the shared ConfirmDialog (no blocking
    // window.confirm). The dialog opens deferred (setTimeout(0)) so Radix's
    // menu scroll-lock unwinds first; findByRole polls through that.
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Archive/i }));

    // Wait for the archive mutation to settle by polling Dexie — the
    // archived card flips to `isArchived = true` and disappears from
    // the non-archived list query.
    await waitFor(async () => {
      const fresh = await testDb.cards.get(card.id);
      expect(fresh?.isArchived).toBe(true);
    });
  });

  it('clicking 3-dot → Archive → cancel leaves the card active', async () => {
    const user = userEvent.setup();
    const card = await createCard(testDb, makeCardInput({ name: 'Keepable' }));
    useActiveCardStore.getState().setActiveCardId(card.id);

    renderHeader();

    await user.click(await screen.findByTestId('cards-header-active-menu-trigger'));
    await user.click(await screen.findByTestId('cards-header-active-menu-archive'));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Cancel/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const fresh = await testDb.cards.get(card.id);
    expect(fresh?.isArchived).toBe(false);
  });

  it('renders chips with equal-width constraints (S19 Task 18)', async () => {
    await createCard(testDb, makeCardInput({ name: 'Short' }));
    await createCard(testDb, makeCardInput({ name: 'A much longer name', color: '#DC2626' }));

    renderHeader();

    const shortChip = await screen.findByRole('button', { name: /Short/i });
    const longChip = await screen.findByRole('button', { name: /A much longer name/i });
    for (const chip of [shortChip, longChip]) {
      expect(chip.className).toMatch(/min-w-\[5\.5rem\]/);
      expect(chip.className).toMatch(/max-w-\[7rem\]/);
      expect(chip.className).toMatch(/truncate/);
    }
  });
});

// ---------------------------------------------------------------------------
// 001-cards-order-colors — the reorderable row.
//
// The gesture itself lives in the browser (e2e/12-card-reorder.spec.ts): a
// real drag needs real element rects, which happy-dom does not produce. What
// IS worth pinning here is everything around the gesture — the row renders in
// the user's order, the drag-end decision (including both cancel paths), the
// a11y strings coming from i18n, and the fact that adding dnd-kit did not
// break tap-to-activate or the onboarding anchor.
// ---------------------------------------------------------------------------

describe('CardsHeader — card order (001-cards-order-colors)', () => {
  it('renders the chips in the user order, not in id order', async () => {
    // Ids deliberately run counter to the ranks: 'c-a' would come first if
    // the row were still reading Dexie primary-key order.
    await createCard(testDb, makeCardInput({ id: 'c-a', name: 'Third', position: 2048 }));
    await createCard(testDb, makeCardInput({ id: 'c-b', name: 'First', position: 0 }));
    await createCard(testDb, makeCardInput({ id: 'c-c', name: 'Second', position: 1024 }));

    renderHeader();

    await screen.findByRole('button', { name: /First/i });
    const chips = within(screen.getByTestId('cards-header'))
      .getAllByRole('button')
      .map((b) => b.getAttribute('title'))
      .filter((title): title is string => title !== null);
    expect(chips.slice(0, 3)).toEqual(['First', 'Second', 'Third']);
  });

  it('keeps the onboarding anchor on the first chip', async () => {
    await createCard(testDb, makeCardInput({ id: 'c-b', name: 'First', position: 0 }));
    await createCard(testDb, makeCardInput({ id: 'c-a', name: 'Second', position: 1024 }));

    renderHeader();

    const anchor = await screen.findByTestId('cards-header-first-chip');
    expect(anchor).toHaveAttribute('title', 'First');
  });

  it('still activates a card on a plain tap', async () => {
    await createCard(testDb, makeCardInput({ id: 'c-a', name: 'Tappable', position: 0 }));

    renderHeader();
    const chip = await screen.findByRole('button', { name: /Tappable/i });
    await userEvent.click(chip);

    await waitFor(() => expect(useActiveCardStore.getState().activeCardId).toBe('c-a'));
  });

  it('exposes localized drag instructions rather than dnd-kit English defaults', async () => {
    await createCard(testDb, makeCardInput({ id: 'c-a', name: 'Anabel', position: 0 }));

    renderHeader();
    await screen.findByRole('button', { name: /Anabel/i });

    // The i18n key must resolve — a missing key would render the key itself.
    const instructions = i18n.t('cards.reorder.instructions');
    expect(instructions).not.toBe('cards.reorder.instructions');
    expect(document.body.textContent).toContain(instructions);
  });
});

describe('resolveCardReorder', () => {
  const row = [{ id: 'c-a' }, { id: 'c-b' }, { id: 'c-c' }] as Parameters<
    typeof resolveCardReorder
  >[0];

  it('returns the target index of the card that was dropped on', () => {
    expect(resolveCardReorder(row, 'c-a', 'c-c')).toEqual({ kind: 'moved', toIndex: 2 });
    expect(resolveCardReorder(row, 'c-c', 'c-a')).toEqual({ kind: 'moved', toIndex: 0 });
  });

  it('writes nothing when the chip is dropped on its own slot', () => {
    expect(resolveCardReorder(row, 'c-b', 'c-b')).toEqual({ kind: 'noop' });
  });

  it('writes nothing when the drag ended outside the row', () => {
    // dnd-kit reports `over: null` for a pointer released off the row, and
    // an Escape cancel never reaches drag-end at all.
    expect(resolveCardReorder(row, 'c-b', null)).toEqual({ kind: 'noop' });
    expect(resolveCardReorder(row, 'c-b', undefined)).toEqual({ kind: 'noop' });
  });

  it('reports a row that changed under the drag as stale, not as a no-op', () => {
    // A background sync applying mid-drag looks exactly like this. The user
    // asked for a move and is not getting one, so the caller must be able to
    // tell it apart from "dropped on its own slot" and say something.
    expect(resolveCardReorder(row, 'c-ghost', 'c-a')).toEqual({ kind: 'stale' });
    expect(resolveCardReorder(row, 'c-a', 'c-ghost')).toEqual({ kind: 'stale' });
  });
});
