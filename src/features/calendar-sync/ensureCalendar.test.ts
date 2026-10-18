import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HourTrackDB } from '@/lib/db/schema';
import { getSettings, initDB, updateSettings } from '@/lib/db/queries';

import { ensureCalendar } from './ensureCalendar';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-ensurecal-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});

interface Stub {
  match: (url: string, init?: RequestInit) => boolean;
  response: () => Response;
}

function makeFetch(stubs: Stub[]): { fetchImpl: typeof fetch; calls: string[] } {
  const queue = [...stubs];
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const idx = queue.findIndex((s) => s.match(url, init));
    if (idx === -1) throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
    return queue.splice(idx, 1)[0]!.response();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ensureCalendar', () => {
  it('returns the cached id without any Google API call', async () => {
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });
    const { fetchImpl, calls } = makeFetch([]);
    const result = await ensureCalendar({
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });
    expect(result).toEqual({ calendarId: 'cal-cached', created: false });
    expect(calls).toHaveLength(0);
  });

  it('reuses an existing HourTrack calendar via listCalendars and caches the id', async () => {
    const { fetchImpl, calls } = makeFetch([
      {
        match: (url) => url.includes('calendarList'),
        response: () =>
          jsonResponse(200, {
            items: [
              { id: 'cal-other', summary: 'Other' },
              { id: 'cal-found', summary: 'HourTrack' },
            ],
          }),
      },
    ]);
    const result = await ensureCalendar({
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });
    expect(result).toEqual({ calendarId: 'cal-found', created: false });
    expect(calls).toHaveLength(1);

    const settings = await getSettings(db);
    expect(settings?.hourtrackCalendarId).toBe('cal-found');
  });

  it('creates a new HourTrack calendar when none exists and caches the id', async () => {
    const { fetchImpl, calls } = makeFetch([
      {
        match: (url) => url.includes('calendarList'),
        response: () => jsonResponse(200, { items: [] }),
      },
      {
        match: (url, init) => url.endsWith('/calendars') && init?.method === 'POST',
        response: () => jsonResponse(200, { id: 'cal-created', summary: 'HourTrack' }),
      },
    ]);
    const result = await ensureCalendar({
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });
    expect(result).toEqual({ calendarId: 'cal-created', created: true });
    expect(calls).toHaveLength(2);

    const settings = await getSettings(db);
    expect(settings?.hourtrackCalendarId).toBe('cal-created');
  });

  it('skips cache + list when forceRecreate is true', async () => {
    await updateSettings(db, { hourtrackCalendarId: 'cal-stale' });
    const { fetchImpl, calls } = makeFetch([
      {
        match: (url, init) => url.endsWith('/calendars') && init?.method === 'POST',
        response: () => jsonResponse(200, { id: 'cal-fresh', summary: 'HourTrack' }),
      },
    ]);
    const result = await ensureCalendar({
      accessToken: 'tk',
      database: db,
      fetchImpl,
      forceRecreate: true,
    });
    expect(result).toEqual({ calendarId: 'cal-fresh', created: true });
    expect(calls.every((c) => !c.includes('calendarList'))).toBe(true);

    const settings = await getSettings(db);
    expect(settings?.hourtrackCalendarId).toBe('cal-fresh');
  });

  it('falls back to create when listCalendars errors', async () => {
    const { fetchImpl } = makeFetch([
      {
        match: (url) => url.includes('calendarList'),
        response: () => new Response('boom', { status: 500 }),
      },
      {
        match: (url, init) => url.endsWith('/calendars') && init?.method === 'POST',
        response: () => jsonResponse(200, { id: 'cal-after-error', summary: 'HourTrack' }),
      },
    ]);
    const result = await ensureCalendar({
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });
    expect(result.calendarId).toBe('cal-after-error');
    expect(result.created).toBe(true);
  });
});
