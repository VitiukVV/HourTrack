import { render, screen } from '@testing-library/react';
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
