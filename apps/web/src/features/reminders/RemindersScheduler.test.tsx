import { describe, expect, it } from 'vitest';

import type { Reminder } from '@hourtrack/shared-types';

import { reminderDueMomentMs, selectDueToasts } from './reminderScheduling';

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r-' + Math.random().toString(36).slice(2, 8),
    text: 'Collect cash',
    dueDate: '2026-08-04',
    dueMinutes: 540, // 09:00 local
    doneAt: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    notifiedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const DUE_09_00 = reminderDueMomentMs(makeReminder());
const MIN = 60_000;

describe('reminderDueMomentMs', () => {
  it('computes a local-time moment from dueDate + dueMinutes', () => {
    expect(reminderDueMomentMs(makeReminder({ dueDate: '2026-08-04', dueMinutes: 540 }))).toBe(
      new Date(2026, 7, 4, 9, 0, 0).getTime(),
    );
  });
});

describe('selectDueToasts — while-open scheduler logic', () => {
  it('picks a reminder that crossed due within [startedAt, now]', () => {
    const r = makeReminder({ id: 'crossed' });
    // Scheduler started 30s before due; now is 30s after due.
    const picked = selectDueToasts([r], DUE_09_00 - 30_000, DUE_09_00 + 30_000);
    expect(picked.map((x) => x.id)).toEqual(['crossed']);
  });

  it('excludes a reminder that was already due before the app opened (banner’s job)', () => {
    const r = makeReminder({ id: 'old' });
    // Scheduler started AFTER the due moment.
    const picked = selectDueToasts([r], DUE_09_00 + MIN, DUE_09_00 + 5 * MIN);
    expect(picked).toHaveLength(0);
  });

  it('excludes a reminder not yet due (due after now)', () => {
    const r = makeReminder({ id: 'future' });
    const picked = selectDueToasts([r], DUE_09_00 - 5 * MIN, DUE_09_00 - MIN);
    expect(picked).toHaveLength(0);
  });

  it('excludes an already-notified reminder (fires once)', () => {
    const r = makeReminder({ id: 'notified', notifiedAt: '2026-08-04T05:00:00.000Z' });
    const picked = selectDueToasts([r], DUE_09_00 - MIN, DUE_09_00 + MIN);
    expect(picked).toHaveLength(0);
  });

  it('excludes a done reminder', () => {
    const r = makeReminder({ id: 'done', doneAt: '2026-08-04T06:00:00.000Z' });
    const picked = selectDueToasts([r], DUE_09_00 - MIN, DUE_09_00 + MIN);
    expect(picked).toHaveLength(0);
  });

  it('includes a reminder due exactly at now (boundary)', () => {
    const r = makeReminder({ id: 'now' });
    const picked = selectDueToasts([r], DUE_09_00 - MIN, DUE_09_00);
    expect(picked.map((x) => x.id)).toEqual(['now']);
  });
});
