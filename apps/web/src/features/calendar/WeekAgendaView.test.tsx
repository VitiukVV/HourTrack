import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import type { Card, Entry } from '@hourtrack/shared-types';

import { WeekAgendaView } from './WeekAgendaView';

/**
 * S18 — `WeekAgendaView` (Task 18) tests.
 *
 * The agenda view is the `< md` replacement for the 7-column WeekView grid.
 * Tests cover:
 *   - 7 day sections render
 *   - Entries grouped under their date with per-day total
 *   - Empty days show a muted "no entries" line
 *   - Tap on a chip routes through `onEntryEdit`
 *   - Week total in header aggregates correctly
 *   - Entirely empty week shows the shared EmptyState with a CTA
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

interface RenderArgs {
  /** Map keyed by YYYY-MM-DD. */
  entriesByDate: Map<string, Entry[]>;
  onEntryEdit?: (id: string) => void;
  /** Override the week range. Defaults to Mon 2026-05-11 → Sun 2026-05-17. */
  start?: string;
  end?: string;
}

function renderAgenda(args: RenderArgs) {
  const cardsById = new Map<string, Card>([[card.id, card]]);
  // Flatten all entries to feed `entriesByCard` (any non-empty list works
  // for hourly rate cards).
  const allEntries: Entry[] = [];
  args.entriesByDate.forEach((list) => allEntries.push(...list));
  const entriesByCard = new Map<string, Entry[]>([[card.id, allEntries]]);
  return render(
    <MemoryRouter>
      <WeekAgendaView
        start={args.start ?? '2026-05-11'}
        end={args.end ?? '2026-05-17'}
        entriesByDate={args.entriesByDate}
        cardsById={cardsById}
        entriesByCard={entriesByCard}
        onEntryEdit={args.onEntryEdit}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WeekAgendaView — populated week', () => {
  beforeEach(() => {
    // Default polyfill returns false; no override needed for these tests
    // (the agenda renders without any matchMedia subscription).
  });

  it('renders all 7 day sections in chronological order', () => {
    const entriesByDate = new Map<string, Entry[]>([
      ['2026-05-13', [makeEntry({ date: '2026-05-13', durationMin: 30 })]],
    ]);
    renderAgenda({ entriesByDate });

    // 7 day sections: 2026-05-11 .. 2026-05-17
    for (const date of [
      '2026-05-11',
      '2026-05-12',
      '2026-05-13',
      '2026-05-14',
      '2026-05-15',
      '2026-05-16',
      '2026-05-17',
    ]) {
      expect(screen.getByTestId(`week-agenda-day-${date}`)).toBeInTheDocument();
    }
  });

  it('groups entries under their date and renders the per-day total', () => {
    const entriesByDate = new Map<string, Entry[]>([
      [
        '2026-05-13',
        [
          makeEntry({ id: 'e1', date: '2026-05-13', durationMin: 60 }),
          makeEntry({ id: 'e2', date: '2026-05-13', durationMin: 30 }),
        ],
      ],
      ['2026-05-14', [makeEntry({ id: 'e3', date: '2026-05-14', durationMin: 120 })]],
    ]);
    renderAgenda({ entriesByDate });

    const day13 = screen.getByTestId('week-agenda-day-2026-05-13');
    expect(within(day13).getAllByTestId('entry-chip')).toHaveLength(2);
    expect(screen.getByTestId('week-agenda-day-2026-05-13-total')).toHaveTextContent('1H 30M');

    const day14 = screen.getByTestId('week-agenda-day-2026-05-14');
    expect(within(day14).getAllByTestId('entry-chip')).toHaveLength(1);
    expect(screen.getByTestId('week-agenda-day-2026-05-14-total')).toHaveTextContent('2H 0M');
  });

  it('renders a muted "no entries" line for empty days within a populated week', () => {
    const entriesByDate = new Map<string, Entry[]>([
      ['2026-05-13', [makeEntry({ date: '2026-05-13', durationMin: 60 })]],
    ]);
    renderAgenda({ entriesByDate });

    // 2026-05-11 has no entries → empty line; populated day has no empty line.
    expect(screen.getByTestId('week-agenda-day-2026-05-11-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('week-agenda-day-2026-05-13-empty')).not.toBeInTheDocument();
  });

  it('aggregates the week total in the header', () => {
    const entriesByDate = new Map<string, Entry[]>([
      ['2026-05-13', [makeEntry({ date: '2026-05-13', durationMin: 60 })]],
      [
        '2026-05-15',
        [
          makeEntry({ id: 'e1', date: '2026-05-15', durationMin: 90 }),
          makeEntry({ id: 'e2', date: '2026-05-15', durationMin: 30 }),
        ],
      ],
    ]);
    renderAgenda({ entriesByDate });

    expect(screen.getByTestId('week-agenda-total')).toHaveTextContent('3H 0M');
  });

  it('routes chip taps through onEntryEdit', async () => {
    const user = userEvent.setup();
    const onEntryEdit = vi.fn();
    const entriesByDate = new Map<string, Entry[]>([
      ['2026-05-13', [makeEntry({ id: 'e1', date: '2026-05-13', durationMin: 60 })]],
    ]);
    renderAgenda({ entriesByDate, onEntryEdit });

    const chip = within(screen.getByTestId('week-agenda-day-2026-05-13')).getByTestId('entry-chip');
    await user.click(chip);
    expect(onEntryEdit).toHaveBeenCalledWith('e1');
  });
});

describe('WeekAgendaView — empty week', () => {
  it('renders the shared EmptyState with the add-for-today CTA when the week has zero entries', () => {
    renderAgenda({ entriesByDate: new Map() });

    expect(screen.getByTestId('week-agenda-empty')).toBeInTheDocument();
    expect(screen.getByTestId('week-agenda-empty-cta')).toBeInTheDocument();
    // Day sections should NOT render in the empty-week escape branch.
    expect(screen.queryByTestId('week-agenda-day-2026-05-11')).not.toBeInTheDocument();
  });
});
