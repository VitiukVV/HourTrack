import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Reminder } from '@hourtrack/shared-types';

import { HourTrackDB } from '@/lib/db/schema';
import { createReminder, initDB, updateSettings } from '@/lib/db/queries';

import {
  handleCreateReminderEvent,
  handleDeleteReminderEvent,
  handleUpdateReminderEvent,
} from './calendarOps';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-remops-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});

function makeReminder(
  overrides: Partial<Omit<Reminder, 'createdAt' | 'updatedAt'>> = {},
): Omit<Reminder, 'createdAt' | 'updatedAt'> {
  return {
    id: 'r-' + Math.random().toString(36).slice(2, 8),
    text: 'Забрати кошти',
    dueDate: '2026-08-04',
    dueMinutes: 540,
    doneAt: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    notifiedAt: null,
    ...overrides,
  };
}

interface Stub {
  match: (url: string, init?: RequestInit) => boolean;
  response: () => Response;
}

function makeFetch(stubs: Stub[]): { fetchImpl: typeof fetch; calls: string[]; bodies: string[] } {
  const queue = [...stubs];
  const calls: string[] = [];
  const bodies: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (typeof init?.body === 'string') bodies.push(init.body);
    const idx = queue.findIndex((s) => s.match(url, init));
    if (idx === -1) throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
    return queue.splice(idx, 1)[0]!.response();
  }) as typeof fetch;
  return { fetchImpl, calls, bodies };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('handleCreateReminderEvent', () => {
  it('inserts the event with the 🔔 payload and stamps googleEventId + synced', async () => {
    const reminder = await createReminder(db, makeReminder({ id: 'r1', text: 'Test reminder' }));
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });

    const { fetchImpl, calls, bodies } = makeFetch([
      {
        match: (url, init) => url.includes('/events') && init?.method === 'POST',
        response: () => jsonResponse(200, { id: 'evt-rem', summary: 'x' }),
      },
    ]);

    await handleCreateReminderEvent(reminder.id, { accessToken: 'tk', database: db, fetchImpl });

    const fresh = await db.reminders.get(reminder.id);
    expect(fresh?.googleEventId).toBe('evt-rem');
    expect(fresh?.syncStatus).toBe('synced');
    expect(calls).toHaveLength(1);
    const payload = JSON.parse(bodies[0]!) as { summary: string; reminders?: unknown };
    expect(payload.summary).toBe('🔔 Test reminder');
    expect(payload.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 0 }],
    });
  });

  it('skips creating an event for an already-done reminder (no fetch)', async () => {
    const reminder = await createReminder(
      db,
      makeReminder({ id: 'r1', doneAt: '2026-08-01T10:00:00.000Z' }),
    );
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });
    const { fetchImpl, calls } = makeFetch([]);
    await handleCreateReminderEvent(reminder.id, { accessToken: 'tk', database: db, fetchImpl });
    expect(calls).toHaveLength(0);
  });

  it('stamps error + rethrows when the insert fails', async () => {
    const reminder = await createReminder(db, makeReminder({ id: 'r1' }));
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });
    const { fetchImpl } = makeFetch([
      {
        match: (url, init) => url.includes('/events') && init?.method === 'POST',
        response: () => jsonResponse(500, { error: 'boom' }),
      },
    ]);
    await expect(
      handleCreateReminderEvent(reminder.id, { accessToken: 'tk', database: db, fetchImpl }),
    ).rejects.toThrow();
    const fresh = await db.reminders.get(reminder.id);
    expect(fresh?.syncStatus).toBe('error');
    expect(fresh?.syncError).toBeTruthy();
  });

  // S31 Task 5 (UR-31-3): re-dispatched create on a reminder that already has
  // a googleEventId PATCHes instead of inserting a duplicate event.
  it('re-dispatched create on a reminder with a googleEventId PATCHes, never inserts a duplicate', async () => {
    const reminder = await createReminder(
      db,
      makeReminder({ id: 'r1', googleEventId: 'evt-rem-already', syncStatus: 'synced' }),
    );
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });

    const { fetchImpl, calls } = makeFetch([
      {
        match: (url, init) => url.includes('evt-rem-already') && init?.method === 'PATCH',
        response: () => jsonResponse(200, { id: 'evt-rem-already' }),
      },
    ]);

    await handleCreateReminderEvent(reminder.id, { accessToken: 'tk', database: db, fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('PATCH');
    expect(calls.some((c) => c.startsWith('POST'))).toBe(false);
    const fresh = await db.reminders.get(reminder.id);
    expect(fresh?.googleEventId).toBe('evt-rem-already');
    expect(fresh?.syncStatus).toBe('synced');
  });
});

describe('handleUpdateReminderEvent', () => {
  it('PATCHes the existing event when a googleEventId is present', async () => {
    const reminder = await createReminder(
      db,
      makeReminder({ id: 'r1', googleEventId: 'evt-existing', text: 'Edited' }),
    );
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });
    const { fetchImpl, calls, bodies } = makeFetch([
      {
        match: (url, init) => url.includes('/events/evt-existing') && init?.method === 'PATCH',
        response: () => jsonResponse(200, { id: 'evt-existing' }),
      },
    ]);
    await handleUpdateReminderEvent(reminder.id, { accessToken: 'tk', database: db, fetchImpl });
    expect(calls[0]).toContain('PATCH');
    const payload = JSON.parse(bodies[0]!) as { summary: string };
    expect(payload.summary).toBe('🔔 Edited');
    expect((await db.reminders.get(reminder.id))?.syncStatus).toBe('synced');
  });

  it('falls back to create when the reminder has no googleEventId yet', async () => {
    const reminder = await createReminder(db, makeReminder({ id: 'r1', googleEventId: null }));
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });
    const { fetchImpl, calls } = makeFetch([
      {
        match: (url, init) => url.includes('/events') && init?.method === 'POST',
        response: () => jsonResponse(200, { id: 'evt-new' }),
      },
    ]);
    await handleUpdateReminderEvent(reminder.id, { accessToken: 'tk', database: db, fetchImpl });
    expect(calls[0]).toContain('POST');
    expect((await db.reminders.get(reminder.id))?.googleEventId).toBe('evt-new');
  });
});

describe('handleDeleteReminderEvent', () => {
  it('DELETEs the event by id on the cached calendar', async () => {
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });
    const { fetchImpl, calls } = makeFetch([
      {
        match: (url, init) => url.includes('/events/evt-gone') && init?.method === 'DELETE',
        response: () => new Response('', { status: 204 }),
      },
    ]);
    await handleDeleteReminderEvent('evt-gone', { accessToken: 'tk', database: db, fetchImpl });
    expect(calls[0]).toContain('DELETE');
    expect(calls[0]).toContain('evt-gone');
  });

  it('is a no-op when no calendar is configured (user disconnected)', async () => {
    const { fetchImpl, calls } = makeFetch([]);
    await handleDeleteReminderEvent('evt-gone', { accessToken: 'tk', database: db, fetchImpl });
    expect(calls).toHaveLength(0);
  });
});
