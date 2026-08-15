import { describe, expect, it } from 'vitest';

import type { Entry } from '@hourtrack/shared-types';

import { compareEntriesForDisplay } from './entry-order';

const BASE_CREATED = '2026-05-14T08:00:00.000Z';

function makeEntry(overrides: Partial<Entry> & { id: string }): Entry {
  return {
    cardId: 'card-1',
    date: '2026-05-14',
    startMinutes: 540,
    durationMin: 60,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    createdAt: BASE_CREATED,
    updatedAt: BASE_CREATED,
    ...overrides,
  };
}

/** Sort a copy so the fixtures stay reusable between cases. */
function order(entries: Entry[]): string[] {
  return [...entries].sort(compareEntriesForDisplay).map((e) => e.id);
}

describe('compareEntriesForDisplay', () => {
  it('tier 1: orders by date ascending', () => {
    const entries = [
      makeEntry({ id: 'later', date: '2026-05-17' }),
      makeEntry({ id: 'earlier', date: '2026-05-14' }),
      makeEntry({ id: 'middle', date: '2026-05-15' }),
    ];

    expect(order(entries)).toEqual(['earlier', 'middle', 'later']);
  });

  it('tier 2: same date orders by startMinutes ascending', () => {
    const entries = [
      makeEntry({ id: 'eleven', startMinutes: 660 }),
      makeEntry({ id: 'seven', startMinutes: 420 }),
      makeEntry({ id: 'nine', startMinutes: 540 }),
    ];

    expect(order(entries)).toEqual(['seven', 'nine', 'eleven']);
  });

  it('tier 3: same start puts the LONGER entry first (Google Calendar rule)', () => {
    const entries = [
      makeEntry({ id: 'short', startMinutes: 540, durationMin: 30 }),
      makeEntry({ id: 'long', startMinutes: 540, durationMin: 240 }),
      makeEntry({ id: 'medium', startMinutes: 540, durationMin: 90 }),
    ];

    expect(order(entries)).toEqual(['long', 'medium', 'short']);
  });

  it('tier 4: same start and duration fall back to createdAt ascending', () => {
    const entries = [
      makeEntry({ id: 'second', createdAt: '2026-05-14T10:00:00.000Z' }),
      makeEntry({ id: 'first', createdAt: '2026-05-14T09:00:00.000Z' }),
    ];

    expect(order(entries)).toEqual(['first', 'second']);
  });

  it('tier 5: everything else equal falls back to id ascending', () => {
    const entries = [makeEntry({ id: 'z' }), makeEntry({ id: 'a' }), makeEntry({ id: 'm' })];

    expect(order(entries)).toEqual(['a', 'm', 'z']);
  });

  it('later tiers never override an earlier one', () => {
    // `late-long` starts later but runs longer and was created first — the
    // start time must still win, or tier 3/4 would be leaking upward.
    const entries = [
      makeEntry({
        id: 'late-long',
        startMinutes: 660,
        durationMin: 480,
        createdAt: '2026-05-01T00:00:00.000Z',
      }),
      makeEntry({
        id: 'early-short',
        startMinutes: 420,
        durationMin: 15,
        createdAt: '2026-05-20T00:00:00.000Z',
      }),
    ];

    expect(order(entries)).toEqual(['early-short', 'late-long']);
  });

  it('sorts a shuffled six-entry day deterministically', () => {
    // Six entries exercising every tier at once. A two-entry fixture cannot
    // catch a comparator whose tiers disagree across a longer chain.
    const entries = [
      makeEntry({ id: 'e', startMinutes: 660, durationMin: 60 }),
      makeEntry({ id: 'b', startMinutes: 540, durationMin: 120 }),
      makeEntry({ id: 'f', startMinutes: 660, durationMin: 30 }),
      makeEntry({ id: 'a', startMinutes: 420, durationMin: 60 }),
      makeEntry({
        id: 'd',
        startMinutes: 540,
        durationMin: 60,
        createdAt: '2026-05-14T12:00:00.000Z',
      }),
      makeEntry({
        id: 'c',
        startMinutes: 540,
        durationMin: 60,
        createdAt: '2026-05-14T09:00:00.000Z',
      }),
    ];

    const expected = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(order(entries)).toEqual(expected);
    // Same input, second run — the comparator is a total order, so the result
    // cannot drift between calls.
    expect(order(entries)).toEqual(expected);
    // And it does not depend on the input permutation.
    expect(order([...entries].reverse())).toEqual(expected);
  });

  it('a non-finite startMinutes or durationMin cannot destabilise the sort', () => {
    // Unreachable for stored rows (the Dexie v5 migration wiped entries
    // without these fields) — this guards a corrupt row pulled from Drive.
    const entries = [
      makeEntry({ id: 'normal', startMinutes: 540, durationMin: 60 }),
      makeEntry({ id: 'nan-start', startMinutes: Number.NaN, durationMin: 60 }),
      makeEntry({ id: 'nan-duration', startMinutes: 540, durationMin: Number.NaN }),
    ];

    // NaN start coerces to 0 → sorts first; NaN duration coerces to 0 → sorts
    // after the 60-minute entry at the same start (longer first).
    expect(order(entries)).toEqual(['nan-start', 'normal', 'nan-duration']);
    expect(order([...entries].reverse())).toEqual(['nan-start', 'normal', 'nan-duration']);
  });

  it('returns 0 for two entries that differ in nothing the rule looks at', () => {
    const a = makeEntry({ id: 'same', note: 'left' });
    const b = makeEntry({ id: 'same', note: 'right' });

    expect(compareEntriesForDisplay(a, b)).toBe(0);
  });
});
