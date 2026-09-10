import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card } from '@hourtrack/shared-types';

import { SortableCardChip } from './SortableCardChip';

/**
 * 001-cards-order-colors — `SortableCardChip` is the seam between the pill
 * row and dnd-kit. Its own logic is small and worth pinning: the tap must
 * survive (the row is still a tap-to-activate control), the click that
 * terminates a drag must NOT activate the card, the lift must be visible,
 * and the sortable transition must yield to `prefers-reduced-motion`.
 *
 * `useSortable` is mocked so each of those states can be driven directly.
 * Driving them through a real drag in happy-dom would test dnd-kit's sensor
 * plumbing (which is pinned by version, see docs/DEPENDENCY_POLICY.md)
 * rather than this component; the real gesture is covered by the Playwright
 * spec `e2e/12-card-reorder.spec.ts`.
 */

const sortable = vi.hoisted(() => ({
  isDragging: false,
  transition: 'transform 200ms ease',
}));

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {
      role: 'button',
      tabIndex: 0,
      'aria-roledescription': 'sortable',
      // dnd-kit really does contribute this key, and it is `undefined`
      // unless the chip is mid-drag. Spreading it over the chip's own
      // toggle state used to erase `aria-pressed` entirely.
      'aria-pressed': undefined,
      'aria-disabled': false,
    },
    listeners: { onKeyDown: vi.fn() },
    setNodeRef: vi.fn(),
    transform: null,
    transition: sortable.transition,
    isDragging: sortable.isDragging,
  }),
}));

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c-1',
    name: 'Anabel',
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
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function renderChip(props: Partial<Parameters<typeof SortableCardChip>[0]> = {}) {
  const onClick = vi.fn();
  const view = render(
    <SortableCardChip
      card={makeCard()}
      isActive={false}
      onClick={onClick}
      onContextMenu={vi.fn()}
      data-testid="cards-header-first-chip"
      {...props}
    />,
  );
  return { onClick, view };
}

beforeEach(() => {
  sortable.isDragging = false;
  sortable.transition = 'transform 200ms ease';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SortableCardChip', () => {
  it('still activates the card on a press that never became a drag', async () => {
    const { onClick } = renderChip();

    await userEvent.click(screen.getByRole('button', { name: 'Anabel' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('preserves the forwarded data-testid (the onboarding anchor)', () => {
    renderChip();
    expect(screen.getByTestId('cards-header-first-chip')).toBeInTheDocument();
  });

  it('leaves click suppression to dnd-kit — a click after a drop still activates', async () => {
    // This component used to keep its own "swallow one click after a drag"
    // ref. It could never work: dnd-kit's pointer sensor stops the drag's
    // click at `document` in the capture phase, so the ref never saw a click
    // to disarm on and ate the user's next real tap instead. That suppression
    // is browser-level and absent from this mock, which is exactly why the
    // old test passed on a fixture that could not occur — the real cage is
    // `e2e/12-card-reorder.spec.ts` › "a click right after a drag still
    // activates the card", verified to fail with the ref and pass without it.
    sortable.isDragging = true;
    const { onClick, view } = renderChip();

    sortable.isDragging = false;
    view.rerender(
      <SortableCardChip
        card={makeCard()}
        isActive={false}
        onClick={onClick}
        onContextMenu={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Anabel' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('paints an inactive chip in the pure card colour, with no opacity blend', () => {
    // SC-004's measured 4.5:1 labels assume the pill renders the card's exact
    // hex. `opacity-90` blended #2563EB into #3B73ED and dropped its white
    // label to 4.32:1 — the palette's contrast guarantee is only true while
    // nothing dilutes the background, and no colour test can see a class.
    renderChip();

    const chip = screen.getByRole('button', { name: 'Anabel' });
    expect(chip.className).not.toMatch(/(?:^|\s)opacity-\d/);
    expect(chip.style.backgroundColor).toBe('#2563EB');
  });

  it('gates its own transition on motion-safe', () => {
    // Dropping dnd-kit's inline transition under `prefers-reduced-motion` is
    // only half the job: this class would keep animating the lift and the
    // neighbours regardless, and the app has no global reduced-motion reset.
    renderChip();

    const chip = screen.getByRole('button', { name: 'Anabel' });
    expect(chip.className).toContain('motion-safe:transition-');
    expect(chip.className).not.toMatch(/(?:^|\s)transition-\[/);
  });

  it('marks the chip as lifted while it is being dragged', () => {
    sortable.isDragging = true;
    renderChip();

    const chip = screen.getByRole('button', { name: 'Anabel' });
    expect(chip).toHaveAttribute('data-dragging', 'true');
  });

  it('drops the lift marker once the chip has settled', () => {
    renderChip();

    const chip = screen.getByRole('button', { name: 'Anabel' });
    expect(chip).not.toHaveAttribute('data-dragging', 'true');
  });

  it('applies the sortable transition by default', () => {
    renderChip();

    const chip = screen.getByRole('button', { name: 'Anabel' });
    expect(chip.style.transition).toBe('transform 200ms ease');
  });

  it('drops the transition under prefers-reduced-motion', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    try {
      renderChip();
      const chip = screen.getByRole('button', { name: 'Anabel' });
      expect(chip.style.transition).toBe('');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('forwards the dnd-kit attributes so the keyboard sensor can reach the chip', () => {
    renderChip();

    const chip = screen.getByRole('button', { name: 'Anabel' });
    expect(chip).toHaveAttribute('aria-roledescription', 'sortable');
    expect(chip).toHaveAttribute('tabindex', '0');
  });

  it('keeps its own aria-pressed, which dnd-kit would otherwise erase', () => {
    renderChip({ isActive: true });

    expect(screen.getByRole('button', { name: 'Anabel' })).toHaveAttribute('aria-pressed', 'true');
  });
});
