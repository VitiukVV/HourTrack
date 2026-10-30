import { describe, expect, it } from 'vitest';

import { CalendarAuthError } from '@/lib/google/calendar';
import { DriveAuthError } from '@/lib/google/drive';

import { syncErrorDetail, syncErrorMessage } from './syncErrorMessage';

const t = (key: string) => `<${key}>`;

describe('syncErrorMessage', () => {
  it('shows the sign-in message for a Calendar 401', () => {
    expect(syncErrorMessage(t, new CalendarAuthError('{"error":{"code":401}}').message)).toBe(
      '<googleCalendar.syncErrorAuth>',
    );
  });

  it('shows the sign-in message for a Drive 401', () => {
    expect(syncErrorMessage(t, new DriveAuthError('Invalid Credentials').message)).toBe(
      '<googleCalendar.syncErrorAuth>',
    );
  });

  it('keeps the generic prefix and the detail for any other error', () => {
    expect(syncErrorMessage(t, 'Calendar API error 500 Internal Server Error')).toBe(
      '<googleCalendar.syncError>: Calendar API error 500 Internal Server Error',
    );
  });

  it('does not mistake a number that merely contains 401 for an auth error', () => {
    expect(syncErrorMessage(t, 'Calendar API error 500: event 14012 failed')).toBe(
      '<googleCalendar.syncError>: Calendar API error 500: event 14012 failed',
    );
  });

  it('shows only the prefix when there is no detail', () => {
    expect(syncErrorMessage(t, null)).toBe('<googleCalendar.syncError>');
  });
});

describe('syncErrorDetail', () => {
  it('replaces a 401 with the sign-in message and keeps anything else as is', () => {
    expect(syncErrorDetail(t, new DriveAuthError('x').message)).toBe(
      '<googleCalendar.syncErrorAuth>',
    );
    expect(syncErrorDetail(t, 'Drive scope not granted')).toBe('Drive scope not granted');
    expect(syncErrorDetail(t, undefined)).toBeUndefined();
  });
});
