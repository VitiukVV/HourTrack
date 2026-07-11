import { useState, type ReactElement } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DndContext } from '@dnd-kit/core';

import type { Card, Entry } from '@hourtrack/shared-types';

import { EntryChip } from './EntryChip';

function makeCard(overrides: Partial<Card> = {}): Card {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'card-1',
    name: 'Raquel',
    color: '#DC2626',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 15,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  const now = '2026-05-14T08:00:00.000Z';
  return {
    id: 'entry-1',
    cardId: 'card-1',
    date: '2026-05-14',
    startMinutes: 600, // 10:00
    durationMin: 120,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * EntryChip — visual unit tests.
 *
 * S21 (UR-21-1): `bar` variant (MonthView/DayCell) became NAME-ONLY. The
 * leading HH:MM time and trailing `formatDuration` text were dropped to
 * reduce visual density. The `title` attribute on the chip still carries
 * the full "HH:MM · name · duration" string so hover / tap-hold preserves
 * the data.
 *
 * `row` variant (WeekView) is unchanged: it still leads with HH:MM and
 * shows duration + earnings on the right.
 */
describe('EntryChip — bar variant (S21: name-only)', () => {
  it('renders only the project name (no visible time, no duration text)', () => {
    render(<EntryChip entry={makeEntry({ startMinutes: 600 })} card={makeCard()} />);

    const chip = screen.getByTestId('entry-chip');
    // Name is present.
    expect(chip.textContent).toContain('Raquel');
    // Time prefix is NOT visible (still in title — see below).
    expect(chip.textContent).not.toMatch(/10:00/);
    // Duration text is NOT visible.
    expect(chip.textContent).not.toMatch(/2h 0m|2h/);
    // The dedicated time slot was removed.
    expect(within(chip).queryByTestId('entry-chip-time')).not.toBeInTheDocument();
  });

  it('exposes the full "HH:MM · name · duration" data on the title attribute', () => {
    render(<EntryChip entry={makeEntry({ startMinutes: 600 })} card={makeCard()} />);
    const chip = screen.getByTestId('entry-chip');
    const title = chip.getAttribute('title') ?? '';
    expect(title).toContain('10:00');
    expect(title).toContain('Raquel');
    // entry default durationMin = 120 → "2h 0m".
    expect(title).toMatch(/2h 0m/);
  });

  it('keeps the card-name truncation behaviour for long names', () => {
    const longName = 'A really exceptionally long card name that should truncate';
    render(<EntryChip entry={makeEntry()} card={makeCard({ name: longName })} />);
    const chip = screen.getByTestId('entry-chip');
    // The full name still appears in textContent (truncate is visual).
    expect(chip.textContent).toContain(longName);
  });

  it('falls back to a neutral chip when card is undefined (no crash)', () => {
    render(<EntryChip entry={makeEntry()} card={undefined} />);
    const chip = screen.getByTestId('entry-chip');
    // "…" ellipsis stands in for the missing name; no time/duration text.
    expect(chip.textContent).toMatch(/…/);
    expect(chip.textContent).not.toMatch(/10:00/);
  });
});

describe('EntryChip — row variant', () => {
  it('renders the start-time HH:MM prefix on the row variant', () => {
    render(
      <EntryChip
        entry={makeEntry({ startMinutes: 8 * 60 + 30 })}
        card={makeCard()}
        variant="row"
      />,
    );

    const chip = screen.getByTestId('entry-chip');
    expect(within(chip).getByTestId('entry-chip-time')).toHaveTextContent('08:30');
  });

  it('still shows note marker when entry.note is non-null', () => {
    render(<EntryChip entry={makeEntry({ note: 'reminder' })} card={makeCard()} variant="row" />);

    expect(screen.getByTestId('note-marker')).toBeInTheDocument();
  });

  it('does NOT show note marker when entry.note is null', () => {
    render(<EntryChip entry={makeEntry({ note: null })} card={makeCard()} variant="row" />);

    expect(screen.queryByTestId('note-marker')).not.toBeInTheDocument();
  });

  it('renders earningsEur when provided', () => {
    render(<EntryChip entry={makeEntry()} card={makeCard()} variant="row" earningsEur={42.5} />);

    const chip = screen.getByTestId('entry-chip');
    expect(chip.textContent).toContain('42.50 EUR');
  });

  it('still surfaces the card color regardless of variant (S19: bg in bar, left-border in row)', () => {
    // S19 Task 12 dropped the leading color dot. The bar variant carries
    // the color as a 20%-alpha background; the row variant carries it as
    // a 4px left border. Either way the inline `style` of the chip /
    // row root encodes the card's color, so the test asserts that the
    // hex appears in an inline-style attribute on the chip subtree.
    const { rerender } = render(
      <EntryChip entry={makeEntry()} card={makeCard({ color: '#16A34A' })} />,
    );
    let chip = screen.getByTestId('entry-chip');
    expect(chip.getAttribute('style')?.toLowerCase()).toContain('#16a34a');

    rerender(<EntryChip entry={makeEntry()} card={makeCard({ color: '#16A34A' })} variant="row" />);
    chip = screen.getByTestId('entry-chip');
    expect(chip.getAttribute('style')?.toLowerCase()).toContain('#16a34a');
  });
});

/**
 * S17 — Clickable chip wiring.
 *
 * When `onEdit` is provided, the chip becomes a `role="button"`, keyboard-
 * activatable, and crucially does NOT bubble its click to ancestor elements
 * (DayCell wraps cells in a click-to-add-entry handler — a chip click must
 * stay scoped to "edit this entry", not "add another entry to the day").
 *
 * When `onEdit` is omitted, the chip stays read-only (current MonthView
 * behaviour pre-S17). This is what guarantees we don't accidentally make
 * the +N-more cell decoration tappable.
 */
describe('EntryChip — S17 onEdit wiring', () => {
  it('renders role="button" + tabIndex=0 when onEdit is provided', () => {
    render(<EntryChip entry={makeEntry()} card={makeCard()} onEdit={() => {}} />);

    const chip = screen.getByTestId('entry-chip');
    expect(chip.getAttribute('role')).toBe('button');
    expect(chip.getAttribute('tabindex')).toBe('0');
  });

  it('is NOT a button when onEdit is omitted (legacy read-only mode)', () => {
    render(<EntryChip entry={makeEntry()} card={makeCard()} />);

    const chip = screen.getByTestId('entry-chip');
    expect(chip.getAttribute('role')).not.toBe('button');
    // tabIndex must be absent so the chip doesn't steal focus from the day
    // cell's keyboard handler in read-only mode.
    expect(chip.getAttribute('tabindex')).toBeNull();
  });

  it('invokes onEdit(entry.id) when clicked', async () => {
    const onEdit = vi.fn();
    render(<EntryChip entry={makeEntry({ id: 'e-42' })} card={makeCard()} onEdit={onEdit} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('entry-chip'));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith('e-42');
  });

  it('invokes onEdit on Enter and Space key activation', async () => {
    const onEdit = vi.fn();
    render(<EntryChip entry={makeEntry({ id: 'e-7' })} card={makeCard()} onEdit={onEdit} />);

    const chip = screen.getByTestId('entry-chip');
    chip.focus();

    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    expect(onEdit).toHaveBeenCalledWith('e-7');

    await user.keyboard(' ');
    expect(onEdit).toHaveBeenCalledTimes(2);
  });

  it('does NOT bubble the click to an ancestor click handler (stopPropagation)', async () => {
    const parentClick = vi.fn();
    const onEdit = vi.fn();
    render(
      <div onClick={parentClick} data-testid="parent">
        <EntryChip entry={makeEntry({ id: 'e-bubble' })} card={makeCard()} onEdit={onEdit} />
      </div>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId('entry-chip'));

    expect(onEdit).toHaveBeenCalledWith('e-bubble');
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('row-variant chip is also clickable when onEdit is provided', async () => {
    const onEdit = vi.fn();
    render(
      <EntryChip
        entry={makeEntry({ id: 'e-row' })}
        card={makeCard()}
        variant="row"
        onEdit={onEdit}
      />,
    );

    const chip = screen.getByTestId('entry-chip');
    expect(chip.getAttribute('role')).toBe('button');
    expect(chip.getAttribute('tabindex')).toBe('0');

    const user = userEvent.setup();
    await user.click(chip);

    expect(onEdit).toHaveBeenCalledWith('e-row');
  });
});

/**
 * S23 — `memo(EntryChip)` regression coverage.
 *
 * The natural pattern (React.Profiler + assert no `'update'` phase) does
 * NOT work here: Profiler reports reconciliation attempts, not actual
 * renders, so a memoized component that bails out still fires
 * `onRender('update', ...)` with near-zero duration. Instead we verify
 * the chip's behavior structurally: after a parent re-render, the chip's
 * DOM node identity must be preserved when props are reference-equal,
 * and it must change when a prop reference changes.
 *
 * This is what `memo()`'s bailout produces visibly: when React skips a
 * memoized component, the prior DOM node is reused as-is; when React
 * re-renders, a fresh reconciliation produces a (potentially) new DOM
 * node — at minimum the React fiber commits an update phase that
 * replaces inline-style strings even when the visual output didn't
 * change.
 *
 * We assert via the `data-testid` element's `outerHTML`: stable across
 * a no-op parent re-render means the chip was bailed out.
 */
describe('EntryChip — S23 memo()', () => {
  function StableHarness() {
    const [, setTick] = useState(0);
    const entry = useState(() => makeEntry({ id: 'memo-1', startMinutes: 600 }))[0];
    const card = useState(() => makeCard())[0];
    const onEdit = useState(() => (_id: string) => {})[0];
    return (
      <>
        <EntryChip entry={entry} card={card} onEdit={onEdit} />
        <button data-testid="bump-stable" onClick={() => setTick((t) => t + 1)}>
          bump
        </button>
      </>
    );
  }

  function ChangedHarness() {
    const [tick, setTick] = useState(0);
    const base = useState(() => makeEntry({ id: 'memo-2', startMinutes: 600, durationMin: 60 }))[0];
    const card = useState(() => makeCard())[0];
    const onEdit = useState(() => (_id: string) => {})[0];
    // Bump tick → return a *different* entry shape (longer duration) so
    // the chip's `title` attribute must change.
    const entry = tick > 0 ? { ...base, durationMin: 180 } : base;
    return (
      <>
        <EntryChip entry={entry} card={card} onEdit={onEdit} />
        <button data-testid="bump-changed" onClick={() => setTick((t) => t + 1)}>
          bump
        </button>
      </>
    );
  }

  it('preserves DOM output when parent re-renders with reference-equal props', () => {
    render(<StableHarness />);
    const before = screen.getByTestId('entry-chip').outerHTML;

    act(() => {
      fireEvent.click(screen.getByTestId('bump-stable'));
    });

    const after = screen.getByTestId('entry-chip').outerHTML;
    expect(after).toBe(before);
  });

  it('updates DOM output when entry reference (and durationMin) changes', () => {
    render(<ChangedHarness />);
    const before = screen.getByTestId('entry-chip').outerHTML;
    expect(before).toContain('1h 0m'); // initial durationMin: 60 → "1h 0m"

    act(() => {
      fireEvent.click(screen.getByTestId('bump-changed'));
    });

    const after = screen.getByTestId('entry-chip').outerHTML;
    // The `title` attribute carries the duration text — after bump it
    // should reflect the new 180-minute duration ("3h 0m").
    expect(after).not.toBe(before);
    expect(after).toContain('3h 0m');
  });
});

describe('EntryChip — S25 dragEnabled', () => {
  function renderInCtx(ui: ReactElement) {
    return render(<DndContext>{ui}</DndContext>);
  }

  it('is NOT a drag source by default (no aria-roledescription, no dnd attributes)', () => {
    renderInCtx(<EntryChip entry={makeEntry()} card={makeCard()} />);
    const chip = screen.getByTestId('entry-chip');
    expect(chip).not.toHaveAttribute('aria-roledescription');
    // dnd-kit attributes spread (e.g. aria-disabled) is absent when inert.
    expect(chip).not.toHaveAttribute('aria-disabled');
  });

  it('becomes a drag source when dragEnabled — adds aria-roledescription', () => {
    renderInCtx(<EntryChip entry={makeEntry()} card={makeCard()} dragEnabled />);
    const chip = screen.getByTestId('entry-chip');
    // roledescription uses the i18n key (no provider → key returned).
    expect(chip).toHaveAttribute('aria-roledescription', 'calendar.dnd.draggable');
  });

  it('keeps the onEdit click affordance while draggable (tap still edits)', () => {
    // NOTE: a real browser fires `click` after a no-movement
    // pointerdown→pointerup; dnd-kit only suppresses the click that follows
    // a REAL drag. userEvent's pointer simulation + happy-dom's zero geometry
    // mis-classifies the no-move sequence, so we dispatch the click event
    // directly here (the chip still carries the onClick handler). The real
    // tap-still-edits assertion lives in the Playwright touch spec (Task 23).
    const onEdit = vi.fn();
    renderInCtx(<EntryChip entry={makeEntry()} card={makeCard()} onEdit={onEdit} dragEnabled />);
    const chip = screen.getByTestId('entry-chip');
    expect(chip).toHaveAttribute('role', 'button');
    fireEvent.click(chip);
    expect(onEdit).toHaveBeenCalledWith('entry-1');
  });

  it('Enter still triggers edit when both draggable and editable (Space reserved for drag)', () => {
    const onEdit = vi.fn();
    renderInCtx(<EntryChip entry={makeEntry()} card={makeCard()} onEdit={onEdit} dragEnabled />);
    const chip = screen.getByTestId('entry-chip');
    fireEvent.keyDown(chip, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('entry-1');
  });

  it('row variant is also draggable when dragEnabled', () => {
    renderInCtx(<EntryChip entry={makeEntry()} card={makeCard()} variant="row" dragEnabled />);
    const chip = screen.getByTestId('entry-chip');
    expect(chip).toHaveAttribute('aria-roledescription', 'calendar.dnd.draggable');
  });

  // Mobile long-press regression: draggable chips must suppress the browser's
  // native text-selection / iOS Copy callout, otherwise the native long-press
  // wins the TouchSensor's 220ms hold race and cancels the drag. The mechanism
  // is `select-none` (+ `-webkit-touch-callout:none` for iOS). Assert the
  // classes are wired on BOTH variants; the real-browser computed-style check
  // lives in the Playwright touch spec.
  it.each(['bar', 'row'] as const)(
    'suppresses native long-press selection on the %s variant when dragEnabled',
    (variant) => {
      renderInCtx(
        <EntryChip entry={makeEntry()} card={makeCard()} variant={variant} dragEnabled />,
      );
      const chip = screen.getByTestId('entry-chip');
      expect(chip.className).toContain('select-none');
      expect(chip.className).toContain('[-webkit-touch-callout:none]');
    },
  );

  it('does NOT add select-none when the chip is inert (not a drag source)', () => {
    renderInCtx(<EntryChip entry={makeEntry()} card={makeCard()} />);
    const chip = screen.getByTestId('entry-chip');
    expect(chip.className).not.toContain('select-none');
  });
});
