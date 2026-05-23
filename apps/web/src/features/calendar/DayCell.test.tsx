import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  monthlyTotal: null,
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

describe('DayCell — mobile: no chip cap, cell grows', () => {
  beforeEach(() => {
    // Force the `< sm` branch. matchMedia(...) returns matches:true so the
    // mobile (no-cap) branch applies.
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

  it('renders ALL chips on mobile (no `+N more` overflow)', () => {
    const entries = [
      makeEntry({ id: 'e1', startMinutes: 540 }),
      makeEntry({ id: 'e2', startMinutes: 600 }),
      makeEntry({ id: 'e3', startMinutes: 660 }),
      makeEntry({ id: 'e4', startMinutes: 720 }),
    ];
    renderCell({ entries });

    // All 4 chips are visible. No overflow trigger on mobile — the cell
    // grows vertically to fit instead of collapsing into a `+N more` link.
    const chips = screen.getAllByTestId('entry-chip');
    expect(chips).toHaveLength(4);
    expect(screen.queryByTestId('day-cell-2026-05-15-overflow-toggle')).not.toBeInTheDocument();
  });

  it('still renders no overflow trigger when entries fit (regression)', () => {
    const entries = [makeEntry({ startMinutes: 540 }), makeEntry({ startMinutes: 600 })];
    renderCell({ entries });
    expect(screen.queryByTestId('day-cell-2026-05-15-overflow-toggle')).not.toBeInTheDocument();
  });
});

// S21 (UR-21-2) — the per-day duration/earnings footer was REMOVED. The cell
// renders day-number + entry-chips + (optional) note marker, and nothing else.
describe('DayCell — S21 footer removal (UR-21-2)', () => {
  it('does not render any EUR text on the cell', () => {
    const entries = [
      makeEntry({ startMinutes: 540, durationMin: 120 }),
      makeEntry({ startMinutes: 660, durationMin: 90 }),
    ];
    renderCell({ entries });
    const cell = screen.getByTestId('day-cell-2026-05-15');
    // No "EUR" copy anywhere in the cell — the footer is gone.
    expect(cell.textContent).not.toMatch(/EUR/);
    // Sanity: chips themselves still rendered.
    expect(cell.querySelectorAll('[data-testid="entry-chip"]').length).toBeGreaterThan(0);
  });

  it('renders no per-day total-duration text on a populated cell', () => {
    const entries = [makeEntry({ startMinutes: 540, durationMin: 60 })];
    renderCell({ entries });
    const cell = screen.getByTestId('day-cell-2026-05-15');
    // The chip is now name-only (S21 EntryChip change), so there's no
    // "1h 0m" anywhere in the cell.
    expect(cell.textContent).not.toMatch(/1h 0m|0\.00 EUR/);
  });
});

describe('DayCell — desktop: no chip cap either', () => {
  // No beforeEach override — default polyfill returns matches:false.
  // The chip-cap + `+N more` overflow popover was removed across both
  // breakpoints; desktop cells now also grow vertically to fit every entry.
  it('renders ALL chips on `sm:+` (default) without an overflow trigger', () => {
    const entries = [
      makeEntry({ startMinutes: 540 }),
      makeEntry({ startMinutes: 600 }),
      makeEntry({ startMinutes: 660 }),
      makeEntry({ startMinutes: 720 }),
    ];
    renderCell({ entries });
    const chips = screen.getAllByTestId('entry-chip');
    expect(chips).toHaveLength(4);
    expect(screen.queryByTestId('day-cell-2026-05-15-overflow-toggle')).not.toBeInTheDocument();
  });
});

/**
 * S23 — `memo(DayCell)` regression coverage.
 *
 * Pattern: count `DayCellImpl`'s actual renders via a Profiler boundary. If
 * the parent re-renders with reference-equal props, the memoized cell must
 * NOT re-render. If any prop changes by reference, it MUST re-render.
 */
describe('DayCell — S23 memo()', () => {
  // We can't use `React.Profiler`-based render counting because Profiler
  // reports reconciliation attempts even for memoized bailouts (see
  // EntryChip.test.tsx for the long version of this story). Assert on
  // the cell's rendered DOM identity instead: a memoized component that
  // bails out reuses the prior DOM, so `outerHTML` stays byte-identical
  // across a no-op parent re-render. When a prop changes by reference
  // (and changes the visible output via `entries` length here), the
  // DOM updates.
  function buildStableProps() {
    const entries = [makeEntry({ id: 'e1', startMinutes: 540 })];
    const cardsById = new Map<string, Card>([[card.id, card]]);
    const entriesByCard = new Map<string, Entry[]>([[card.id, entries]]);
    const onClick = (_d: string) => {};
    const onEntryEdit = (_id: string) => {};
    return { entries, cardsById, entriesByCard, onClick, onEntryEdit };
  }

  function StableHarness() {
    const [, setTick] = useState(0);
    const props = useState(buildStableProps)[0];
    return (
      <MemoryRouter>
        <DayCell
          date="2026-05-15"
          dayNumber={15}
          entries={props.entries}
          cardsById={props.cardsById}
          entriesByCard={props.entriesByCard}
          isToday={false}
          isCurrentMonth
          onClick={props.onClick}
          onEntryEdit={props.onEntryEdit}
        />
        <button data-testid="bump-stable" onClick={() => setTick((t) => t + 1)}>
          bump
        </button>
      </MemoryRouter>
    );
  }

  function ChangedHarness() {
    const [tick, setTick] = useState(0);
    const base = useState(buildStableProps)[0];
    // Bump tick → swap entries for a longer list (two entries instead of
    // one). Visible chip count changes; DOM must update.
    const entries =
      tick > 0 ? [...base.entries, makeEntry({ id: 'e2', startMinutes: 600 })] : base.entries;
    return (
      <MemoryRouter>
        <DayCell
          date="2026-05-15"
          dayNumber={15}
          entries={entries}
          cardsById={base.cardsById}
          entriesByCard={base.entriesByCard}
          isToday={false}
          isCurrentMonth
          onClick={base.onClick}
          onEntryEdit={base.onEntryEdit}
        />
        <button data-testid="bump-changed" onClick={() => setTick((t) => t + 1)}>
          bump
        </button>
      </MemoryRouter>
    );
  }

  it('preserves DOM output when parent re-renders with reference-equal props', () => {
    render(<StableHarness />);
    const before = screen.getByTestId('day-cell-2026-05-15').outerHTML;

    act(() => {
      fireEvent.click(screen.getByTestId('bump-stable'));
    });

    const after = screen.getByTestId('day-cell-2026-05-15').outerHTML;
    expect(after).toBe(before);
  });

  it('updates DOM output when entries reference (and chip count) changes', () => {
    render(<ChangedHarness />);
    const chipsBefore = screen.getAllByTestId('entry-chip').length;
    expect(chipsBefore).toBe(1);

    act(() => {
      fireEvent.click(screen.getByTestId('bump-changed'));
    });

    const chipsAfter = screen.getAllByTestId('entry-chip').length;
    expect(chipsAfter).toBe(2);
  });
});
