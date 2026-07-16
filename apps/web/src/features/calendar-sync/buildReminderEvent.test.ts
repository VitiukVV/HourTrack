import { describe, expect, it } from 'vitest';

import type { Reminder } from '@hourtrack/shared-types';

import { buildReminderEvent } from './buildReminderEvent';

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r-1',
    text: 'Забрати кошти в Марі за липень',
    dueDate: '2026-08-04',
    dueMinutes: 540, // 09:00
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

describe('buildReminderEvent', () => {
  it('produces a 🔔-prefixed summary with the reminder text', () => {
    const event = buildReminderEvent(makeReminder());
    expect(event.summary).toBe('🔔 Забрати кошти в Марі за липень');
    expect(event.description).toBe('Забрати кошти в Марі за липень');
  });

  it('starts at the due wall-clock and lasts 15 minutes', () => {
    const event = buildReminderEvent(makeReminder({ dueDate: '2026-08-04', dueMinutes: 540 }));
    expect(event.start.dateTime).toBe('2026-08-04T09:00:00');
    expect(event.end.dateTime).toBe('2026-08-04T09:15:00');
  });

  it('emits a floating wall-clock (no Z, no offset) plus an IANA timeZone', () => {
    const event = buildReminderEvent(makeReminder());
    expect(event.start.dateTime.endsWith('Z')).toBe(false);
    expect(event.start.dateTime.includes('+')).toBe(false);
    expect(event.end.dateTime.endsWith('Z')).toBe(false);
    // vitest.setup pins TZ to Europe/Kyiv; Node ICU may resolve it as the
    // legacy 'Europe/Kiev' alias depending on the bundled tz database.
    expect(['Europe/Kyiv', 'Europe/Kiev']).toContain(event.start.timeZone);
    expect(['Europe/Kyiv', 'Europe/Kiev']).toContain(event.end.timeZone);
  });

  it('rolls the 15-min end past midnight for a late-day reminder', () => {
    // 23:50 + 15 min → 00:05 next day.
    const event = buildReminderEvent(makeReminder({ dueDate: '2026-08-04', dueMinutes: 1430 }));
    expect(event.start.dateTime).toBe('2026-08-04T23:50:00');
    expect(event.end.dateTime).toBe('2026-08-05T00:05:00');
  });

  it('includes a single popup override at minute 0', () => {
    const event = buildReminderEvent(makeReminder());
    expect(event.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 0 }],
    });
  });

  it('uses a fixed reminder colorId', () => {
    expect(buildReminderEvent(makeReminder()).colorId).toBe('5');
  });

  it('throws on an out-of-range dueMinutes', () => {
    expect(() => buildReminderEvent(makeReminder({ dueMinutes: 1440 }))).toThrow(/dueMinutes/);
  });
});
