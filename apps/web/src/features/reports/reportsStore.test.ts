import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatLocalDate, startOfMonth, startOfWeekMonday } from '@hourtrack/shared-utils';

import { useReportsFilters } from './reportsStore';

describe('useReportsFilters store', () => {
  beforeEach(() => {
    // Reset to defaults between tests
    useReportsFilters.getState().reset();
  });

  afterEach(() => {
    // Clean up any sessionStorage state to keep tests independent
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
  });

  it('defaults to month period with the first-of-current-month as anchor (S20)', () => {
    const s = useReportsFilters.getState();
    expect(s.period).toBe('month');
    expect(typeof s.anchorDate).toBe('string');
    expect(/^\d{4}-\d{2}-\d{2}$/.test(s.anchorDate)).toBe(true);
    // S20 Task 10: anchor is the 1st of the current month, not today.
    const expectedAnchor = formatLocalDate(startOfMonth(new Date()));
    expect(s.anchorDate).toBe(expectedAnchor);
    expect(s.customStart).toBeNull();
    expect(s.customEnd).toBeNull();
    expect(s.showArchived).toBe(false);
    // null = "follow active cards (all selected)" — the report hook expands this
    // into the actual current set of active card IDs. Storing literal IDs in the
    // store would freeze the selection when new cards are created.
    expect(s.selectedCardIds).toBeNull();
  });

  // S20 Task 1 — setPeriod snaps anchorDate to the period's natural start.
  it('setPeriod("month") snaps anchorDate to startOfMonth(today)', () => {
    useReportsFilters.getState().setAnchorDate('2025-03-17');
    useReportsFilters.getState().setPeriod('month');
    const expected = formatLocalDate(startOfMonth(new Date()));
    expect(useReportsFilters.getState().anchorDate).toBe(expected);
    expect(useReportsFilters.getState().period).toBe('month');
  });

  it('setPeriod("week") snaps anchorDate to the Monday of the current week', () => {
    useReportsFilters.getState().setAnchorDate('2025-03-17');
    useReportsFilters.getState().setPeriod('week');
    const expected = formatLocalDate(startOfWeekMonday(new Date()));
    expect(useReportsFilters.getState().anchorDate).toBe(expected);
    expect(useReportsFilters.getState().period).toBe('week');
  });

  it('setPeriod("day") snaps anchorDate to today', () => {
    useReportsFilters.getState().setAnchorDate('2025-03-17');
    useReportsFilters.getState().setPeriod('day');
    const expected = formatLocalDate(new Date());
    expect(useReportsFilters.getState().anchorDate).toBe(expected);
  });

  it('setPeriod("custom") leaves the prior anchor in place (custom uses its own range)', () => {
    useReportsFilters.getState().setAnchorDate('2025-03-17');
    useReportsFilters.getState().setPeriod('custom');
    expect(useReportsFilters.getState().anchorDate).toBe('2025-03-17');
    expect(useReportsFilters.getState().period).toBe('custom');
  });

  it('setAnchorDate updates the anchor', () => {
    useReportsFilters.getState().setAnchorDate('2026-05-14');
    expect(useReportsFilters.getState().anchorDate).toBe('2026-05-14');
  });

  it('setCustomRange stores start and end, switches period to custom', () => {
    useReportsFilters.getState().setCustomRange('2026-01-01', '2026-12-31');
    const s = useReportsFilters.getState();
    expect(s.customStart).toBe('2026-01-01');
    expect(s.customEnd).toBe('2026-12-31');
    expect(s.period).toBe('custom');
  });

  it('toggleCardId moves between selected-all (null) and explicit selection', () => {
    // Starting from null (all), toggling a card off should produce an explicit
    // list that EXCLUDES that card. Need known active cards for that — supply
    // them.
    useReportsFilters.getState().toggleCardId('a', ['a', 'b', 'c']);
    expect(useReportsFilters.getState().selectedCardIds).toEqual(['b', 'c']);

    // Toggle the same card again should re-include it.
    useReportsFilters.getState().toggleCardId('a', ['a', 'b', 'c']);
    expect(useReportsFilters.getState().selectedCardIds).toEqual(
      expect.arrayContaining(['a', 'b', 'c']),
    );
    expect(useReportsFilters.getState().selectedCardIds!.length).toBe(3);
  });

  it('selectAll resets selectedCardIds to null (follow-active sentinel)', () => {
    useReportsFilters.getState().toggleCardId('a', ['a', 'b']);
    expect(useReportsFilters.getState().selectedCardIds).not.toBeNull();

    useReportsFilters.getState().selectAll();
    expect(useReportsFilters.getState().selectedCardIds).toBeNull();
  });

  it('clearAll sets selectedCardIds to an empty array', () => {
    useReportsFilters.getState().clearAll();
    expect(useReportsFilters.getState().selectedCardIds).toEqual([]);
  });

  // S20 Task 12 — Reset-cards button handler.
  it('clearCardSelection returns to the null sentinel from an explicit list', () => {
    useReportsFilters.getState().toggleCardId('a', ['a', 'b']);
    expect(useReportsFilters.getState().selectedCardIds).not.toBeNull();
    useReportsFilters.getState().clearCardSelection();
    expect(useReportsFilters.getState().selectedCardIds).toBeNull();
  });

  it('setShowArchived toggles the archive flag', () => {
    expect(useReportsFilters.getState().showArchived).toBe(false);
    useReportsFilters.getState().setShowArchived(true);
    expect(useReportsFilters.getState().showArchived).toBe(true);
  });

  // S20 Task 10 — reset snaps anchorDate to startOfMonth(today), period to
  // 'month', card selection to null, archive flag to false.
  it('reset returns to S20 defaults (month + startOfMonth + null cards + no archive)', () => {
    const s = useReportsFilters.getState();
    s.setPeriod('day');
    s.setAnchorDate('2026-05-14');
    s.setCustomRange('2026-01-01', '2026-12-31');
    s.toggleCardId('a', ['a', 'b']);
    s.setShowArchived(true);

    s.reset();
    const after = useReportsFilters.getState();
    expect(after.period).toBe('month');
    expect(after.anchorDate).toBe(formatLocalDate(startOfMonth(new Date())));
    expect(after.customStart).toBeNull();
    expect(after.customEnd).toBeNull();
    expect(after.selectedCardIds).toBeNull();
    expect(after.showArchived).toBe(false);
  });
});

describe('persisted-state sanitizing (merge)', () => {
  it('falls back to defaults for a corrupted sessionStorage slice', async () => {
    sessionStorage.setItem(
      'hourtrack:reports-filters',
      JSON.stringify({
        state: {
          period: 'nonsense',
          anchorDate: '2026-13-40',
          customStart: 'undefined',
          customEnd: null,
          selectedCardIds: 'not-an-array',
          showArchived: 'yes',
        },
        version: 0,
      }),
    );

    await useReportsFilters.persist.rehydrate();

    const state = useReportsFilters.getState();
    expect(['day', 'week', 'month', 'custom']).toContain(state.period);
    // A real date, not the impossible 2026-13-40 that would crash `format`.
    expect(state.anchorDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(state.anchorDate).toString()).not.toBe('Invalid Date');
    expect(state.customStart).toBeNull();
    expect(state.selectedCardIds).toBeNull();
    expect(state.showArchived).toBe(false);

    sessionStorage.removeItem('hourtrack:reports-filters');
  });

  it('keeps a well-formed persisted slice', async () => {
    sessionStorage.setItem(
      'hourtrack:reports-filters',
      JSON.stringify({
        state: {
          period: 'custom',
          anchorDate: '2026-05-14',
          customStart: '2026-05-01',
          customEnd: '2026-05-31',
          selectedCardIds: ['a', 'b'],
          showArchived: true,
        },
        version: 0,
      }),
    );

    await useReportsFilters.persist.rehydrate();

    const state = useReportsFilters.getState();
    expect(state.period).toBe('custom');
    expect(state.anchorDate).toBe('2026-05-14');
    expect(state.customStart).toBe('2026-05-01');
    expect(state.selectedCardIds).toEqual(['a', 'b']);
    expect(state.showArchived).toBe(true);

    sessionStorage.removeItem('hourtrack:reports-filters');
    useReportsFilters.getState().reset();
  });
});
