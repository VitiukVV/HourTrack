import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

  it('defaults to month period with today as anchor and empty card selection sentinel', () => {
    const s = useReportsFilters.getState();
    expect(s.period).toBe('month');
    expect(typeof s.anchorDate).toBe('string');
    expect(/^\d{4}-\d{2}-\d{2}$/.test(s.anchorDate)).toBe(true);
    expect(s.customStart).toBeNull();
    expect(s.customEnd).toBeNull();
    expect(s.showArchived).toBe(false);
    // null = "follow active cards (all selected)" — the report hook expands this
    // into the actual current set of active card IDs. Storing literal IDs in the
    // store would freeze the selection when new cards are created.
    expect(s.selectedCardIds).toBeNull();
  });

  it('setPeriod updates the period', () => {
    useReportsFilters.getState().setPeriod('week');
    expect(useReportsFilters.getState().period).toBe('week');

    useReportsFilters.getState().setPeriod('custom');
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

  it('setShowArchived toggles the archive flag', () => {
    expect(useReportsFilters.getState().showArchived).toBe(false);
    useReportsFilters.getState().setShowArchived(true);
    expect(useReportsFilters.getState().showArchived).toBe(true);
  });

  it('reset returns to defaults', () => {
    const s = useReportsFilters.getState();
    s.setPeriod('day');
    s.setAnchorDate('2026-05-14');
    s.setCustomRange('2026-01-01', '2026-12-31');
    s.toggleCardId('a', ['a', 'b']);
    s.setShowArchived(true);

    s.reset();
    const after = useReportsFilters.getState();
    expect(after.period).toBe('month');
    expect(after.customStart).toBeNull();
    expect(after.customEnd).toBeNull();
    expect(after.selectedCardIds).toBeNull();
    expect(after.showArchived).toBe(false);
  });
});
