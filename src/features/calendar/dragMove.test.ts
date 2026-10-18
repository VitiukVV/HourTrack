import { describe, it, expect } from 'vitest';

import { resolveEntryMove } from './dragMove';

describe('resolveEntryMove', () => {
  const entry = { id: 'e1', date: '2026-05-14' };

  it('returns the move payload when dropped on a different valid day', () => {
    expect(resolveEntryMove(entry, '2026-05-21')).toEqual({
      id: 'e1',
      patch: { date: '2026-05-21' },
    });
  });

  it('returns null for a same-day drop (no-op, must not fire a mutation)', () => {
    expect(resolveEntryMove(entry, '2026-05-14')).toBeNull();
  });

  it('returns null for a malformed toDate (defensive)', () => {
    expect(resolveEntryMove(entry, 'not-a-date')).toBeNull();
    expect(resolveEntryMove(entry, '2026/05/21')).toBeNull();
    expect(resolveEntryMove(entry, '2026-5-1')).toBeNull();
    expect(resolveEntryMove(entry, '')).toBeNull();
    // Shape-valid but impossible calendar date.
    expect(resolveEntryMove(entry, '2026-13-40')).toBeNull();
  });

  it('moves across month boundaries (leading/trailing cross-month cells)', () => {
    // MonthView leading/trailing days belong to adjacent months; dropping
    // there is a valid move (spec Notes "Cross-month / off-range drops").
    expect(resolveEntryMove({ id: 'e2', date: '2026-05-31' }, '2026-06-01')).toEqual({
      id: 'e2',
      patch: { date: '2026-06-01' },
    });
  });
});
