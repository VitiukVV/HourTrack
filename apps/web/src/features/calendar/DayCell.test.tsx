import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import type { Card, Entry } from '@hourtrack/shared-types';

import { DayCell } from './DayCell';

/**
 * S18 — `DayCell` mobile overflow tests.
 *
 * Mobile (`< sm`) shows 2 chips with the rest folded into a `+N more`
 * trigger that opens an inline popover listing all entries for the day.
 * Each entry in the popover routes through the same `onEntryEdit`
 * callback as the visible chips, so a tap on an overflowed entry opens
 * the S17 edit modal directly without leaving the calendar surface.
 *
 * The test forces `matchMedia` to report `matches: true` for the
 * `< sm` query so the mobile branch renders deterministically. Without
 * the polyfill in `vitest.setup.ts` the very first DayCell render below
 * throws `window.matchMedia is not a function`.
 */

const card: Card = {
  id: 'card-1',
  name: 'Project A',
  color: '#2563EB',
  defaultDurationMin: 60,
  defaultStartMinutes: 600,
  rateType: 'hourly',
  hourlyRate: 20,
  fixedTotal: null,
  defaultNote: null,
  isArchived: false,
  archivedAt: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

function makeEntry(overrides: Partial<Entry>): Entry {
  return {
    id: crypto.randomUUID(),
    cardId: card.id,
    date: '2026-05-15',
    startMinutes: 600,
    durationMin: 60,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
    ...overrides,
  };
}

function renderCell(props: {
  entries: Entry[];
  onEntryEdit?: (id: string) => void;
  onClick?: (date: string) => void;
}) {
  const cardsById = new Map<string, Card>([[card.id, card]]);
  const entriesByCard = new Map<string, Entry[]>([[card.id, props.entries]]);
  return render(
    <MemoryRouter>
      <DayCell
        date="2026-05-15"
        dayNumber={15}
        entries={props.entries}
        cardsById={cardsById}
        entriesByCard={entriesByCard}
        isToday={false}
        isCurrentMonth
        onClick={props.onClick}
        onEntryEdit={props.onEntryEdit}
      />
    </MemoryRouter>,
  );
}

// Restore the default polyfill (matches:false) between every test, so any
// per-test override doesn't leak into the next test's render. `vi.restore
// AllMocks` doesn't help here because `window.matchMedia = vi.fn(...)` is a
// reassignment, not a spy — only an explicit re-install brings the default
// back.
function installDefaultMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  installDefaultMatchMedia();
});

describe('DayCell — S18 mobile overflow', () => {
  beforeEach(() => {
    // Force the `< sm` branch. matchMedia(...) returns matches:true so the
    // mobile chip cap (2) applies.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it('renders at most 2 chips on mobile and a `+N more` trigger', () => {
    const entries = [
      makeEntry({ startMinutes: 540 }),
      makeEntry({ startMinutes: 600 }),
      makeEntry({ startMinutes: 660 }),
      makeEntry({ startMinutes: 720 }),
    ];
    renderCell({ entries });

    // 2 visible chips (the first two). +N more shows N=2 (4 - 2).
    const chips = screen.getAllByTestId('entry-chip');
    expect(chips).toHaveLength(2);
    expect(screen.getByTestId('day-cell-2026-05-15-overflow-toggle')).toHaveTextContent(
      /\+2 more/i,
    );
  });

  it('does NOT render an overflow trigger when entries fit', () => {
    const entries = [makeEntry({ startMinutes: 540 }), makeEntry({ startMinutes: 600 })];
    renderCell({ entries });
    expect(screen.queryByTestId('day-cell-2026-05-15-overflow-toggle')).not.toBeInTheDocument();
  });

  it('opens an overflow popover listing all entries on click', async () => {
    const user = userEvent.setup();
    const entries = [
      makeEntry({ id: 'e1', startMinutes: 540 }),
      makeEntry({ id: 'e2', startMinutes: 600 }),
      makeEntry({ id: 'e3', startMinutes: 660 }),
      makeEntry({ id: 'e4', startMinutes: 720 }),
    ];
    renderCell({ entries });

    await user.click(screen.getByTestId('day-cell-2026-05-15-overflow-toggle'));

    const panel = screen.getByTestId('day-cell-2026-05-15-overflow-panel');
    expect(panel).toBeInTheDocument();
    // All 4 entries are listed inside the panel (the popover lists EVERY
    // entry for the day, not just the overflowed ones — easier to scan
    // than "you can see two of these elsewhere").
    const panelChips = within(panel).getAllByTestId('entry-chip');
    expect(panelChips).toHaveLength(4);
  });

  it('routes overflow chip taps through onEntryEdit and closes the popover', async () => {
    const user = userEvent.setup();
    const onEntryEdit = vi.fn();
    const entries = [
      makeEntry({ id: 'e1', startMinutes: 540 }),
      makeEntry({ id: 'e2', startMinutes: 600 }),
      makeEntry({ id: 'e3', startMinutes: 660 }),
      makeEntry({ id: 'e4', startMinutes: 720 }),
    ];
    renderCell({ entries, onEntryEdit });

    await user.click(screen.getByTestId('day-cell-2026-05-15-overflow-toggle'));
    const panel = screen.getByTestId('day-cell-2026-05-15-overflow-panel');
    const panelChips = within(panel).getAllByTestId('entry-chip');

    // Click the 4th entry — only reachable via the overflow popover.
    const fourthChip = panelChips[3];
    expect(fourthChip).toBeDefined();
    await user.click(fourthChip!);

    expect(onEntryEdit).toHaveBeenCalledWith('e4');
    // Popover should close after the edit handler fires.
    expect(screen.queryByTestId('day-cell-2026-05-15-overflow-panel')).not.toBeInTheDocument();
  });

  it('overflow toggle stopPropagation prevents day-click from firing', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const entries = [
      makeEntry({ startMinutes: 540 }),
      makeEntry({ startMinutes: 600 }),
      makeEntry({ startMinutes: 660 }),
    ];
    renderCell({ entries, onClick });
    await user.click(screen.getByTestId('day-cell-2026-05-15-overflow-toggle'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('DayCell — S18 desktop (no media match)', () => {
  // No beforeEach override — default polyfill returns matches:false.
  it('renders up to 3 chips on `sm:+` (default) before the overflow trigger', () => {
    const entries = [
      makeEntry({ startMinutes: 540 }),
      makeEntry({ startMinutes: 600 }),
      makeEntry({ startMinutes: 660 }),
      makeEntry({ startMinutes: 720 }),
    ];
    renderCell({ entries });
    const chips = screen.getAllByTestId('entry-chip');
    // Top-level chips only (not popover-internal chips — the popover is
    // closed by default). 3 visible + 0 in popover = 3.
    expect(chips).toHaveLength(3);
    expect(screen.getByTestId('day-cell-2026-05-15-overflow-toggle')).toHaveTextContent(
      /\+1 more/i,
    );
  });
});
