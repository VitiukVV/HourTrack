import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { HourTrackDB } from '@/lib/db/schema';
import { createCard, createEntry, getCardById, initDB, updateSettings } from '@/lib/db/queries';

import {
  handleBulkUpdateCardEvents,
  handleCreateCalendarEvent,
  handleDeleteCalendarEvent,
  handleUpdateCalendarEvent,
} from './calendarOps';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-calops-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});

function makeCard(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: 'card-' + Math.random().toString(36).slice(2, 8),
    name: 'Raquel',
    color: '#EF4444',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 15,
    fixedTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    ...overrides,
  };
}

function makeEntry(
  cardId: string,
  overrides: Partial<Entry> = {},
): Omit<Entry, 'createdAt' | 'updatedAt'> {
  return {
    id: 'entry-' + Math.random().toString(36).slice(2, 8),
    cardId,
    date: '2026-05-15',
    startMinutes: 600,
    durationMin: 165,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    ...overrides,
  };
}

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

describe('handleCreateCalendarEvent', () => {
  it('uses cached calendar id, inserts event, and stamps googleEventId + synced', async () => {
    const card = await createCard(db, makeCard());
    const entry = await createEntry(db, makeEntry(card.id));
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });

    const { fetchImpl, calls } = makeFetch([
      {
        match: (url, init) => url.includes('/events') && init?.method === 'POST',
        response: () => jsonResponse(200, { id: 'evt-new', summary: 'x' }),
      },
    ]);

    await handleCreateCalendarEvent(entry.id, {
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });

    const fresh = await db.entries.get(entry.id);
    expect(fresh?.googleEventId).toBe('evt-new');
    expect(fresh?.syncStatus).toBe('synced');
    expect(fresh?.syncError).toBeNull();
    // Only ONE Google API call (insert) — calendar id was cached
    expect(calls).toHaveLength(1);
  });

  // S16b: end-to-end check that the body sent to Google Calendar uses the
  // time-bound payload shape from `buildEvent`. The fetchImpl captures the
  // body so we can assert on `start.dateTime`/`timeZone` directly.
  it('S16b: POSTs a time-bound event body with start.dateTime/timeZone (no all-day `date`)', async () => {
    const card = await createCard(db, makeCard());
    const entry = await createEntry(
      db,
      makeEntry(card.id, {
        date: '2026-05-15',
        startMinutes: 600, // 10:00
        durationMin: 240, // 4h
      }),
    );
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });

    let captured: Record<string, unknown> | null = null;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST' && input.toString().includes('/events')) {
        captured = JSON.parse(init.body as string) as Record<string, unknown>;
        return new Response(JSON.stringify({ id: 'evt-tb' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected ${init?.method} ${input.toString()}`);
    }) as typeof fetch;

    await handleCreateCalendarEvent(entry.id, {
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });

    expect(captured).not.toBeNull();
    const cap = captured as unknown as {
      start?: { date?: string; dateTime?: string; timeZone?: string };
      end?: { date?: string; dateTime?: string; timeZone?: string };
    };
    const start = cap.start;
    const end = cap.end;
    expect(start).toBeDefined();
    expect(start?.dateTime).toBe('2026-05-15T10:00:00');
    // tzdata may canonicalise to 'Europe/Kyiv' (modern) or 'Europe/Kiev'
    // (pre-2022) depending on Node ICU vintage. Both refer to the same zone.
    expect(['Europe/Kyiv', 'Europe/Kiev']).toContain(start?.timeZone);
    expect(start?.date).toBeUndefined(); // no all-day fallback
    expect(end?.dateTime).toBe('2026-05-15T14:00:00');
    expect(['Europe/Kyiv', 'Europe/Kiev']).toContain(end?.timeZone);
  });

  it('recreates calendar + retries when insertEvent returns 404', async () => {
    const card = await createCard(db, makeCard());
    const entry = await createEntry(db, makeEntry(card.id));
    await updateSettings(db, { hourtrackCalendarId: 'cal-stale' });

    const { fetchImpl, calls } = makeFetch([
      // First insert → 404
      {
        match: (url, init) =>
          url.includes('cal-stale') && url.includes('/events') && init?.method === 'POST',
        response: () => new Response('gone', { status: 404 }),
      },
      // ensureCalendar({ forceRecreate: true }) → POST /calendars
      {
        match: (url, init) => url.endsWith('/calendars') && init?.method === 'POST',
        response: () => jsonResponse(200, { id: 'cal-fresh', summary: 'HourTrack' }),
      },
      // Retried insert against the new calendar id
      {
        match: (url, init) =>
          url.includes('cal-fresh') && url.includes('/events') && init?.method === 'POST',
        response: () => jsonResponse(200, { id: 'evt-after-recovery' }),
      },
    ]);

    await handleCreateCalendarEvent(entry.id, {
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });

    const fresh = await db.entries.get(entry.id);
    expect(fresh?.googleEventId).toBe('evt-after-recovery');
    expect(fresh?.syncStatus).toBe('synced');
    expect(calls).toHaveLength(3);
  });

  it('stamps syncStatus=error + rethrows on transient failure', async () => {
    const card = await createCard(db, makeCard());
    const entry = await createEntry(db, makeEntry(card.id));
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });

    const { fetchImpl } = makeFetch([
      {
        match: (url, init) => url.includes('/events') && init?.method === 'POST',
        response: () => new Response('boom', { status: 500 }),
      },
    ]);

    await expect(
      handleCreateCalendarEvent(entry.id, {
        accessToken: 'tk',
        database: db,
        fetchImpl,
      }),
    ).rejects.toThrow();

    const fresh = await db.entries.get(entry.id);
    expect(fresh?.syncStatus).toBe('error');
    expect(fresh?.syncError).toMatch(/500/);
    expect(fresh?.googleEventId).toBeNull();
  });

  it('is a no-op when the entry was deleted between enqueue and run', async () => {
    const { fetchImpl } = makeFetch([]);
    await expect(
      handleCreateCalendarEvent('non-existent-entry', {
        accessToken: 'tk',
        database: db,
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('handleUpdateCalendarEvent', () => {
  it('PATCHes the existing event and stamps syncStatus=synced', async () => {
    const card = await createCard(db, makeCard());
    const entry = await createEntry(
      db,
      makeEntry(card.id, { googleEventId: 'evt-existing', syncStatus: 'synced' }),
    );
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });

    const { fetchImpl, calls } = makeFetch([
      {
        match: (url, init) => url.includes('evt-existing') && init?.method === 'PATCH',
        response: () => jsonResponse(200, { id: 'evt-existing' }),
      },
    ]);

    await handleUpdateCalendarEvent(entry.id, {
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });

    expect(calls[0]).toContain('PATCH');
    const fresh = await db.entries.get(entry.id);
    expect(fresh?.googleEventId).toBe('evt-existing');
    expect(fresh?.syncStatus).toBe('synced');
  });

  it('falls back to create when entry has no googleEventId yet', async () => {
    const card = await createCard(db, makeCard());
    const entry = await createEntry(db, makeEntry(card.id, { googleEventId: null }));
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });

    const { fetchImpl } = makeFetch([
      {
        match: (url, init) => url.includes('/events') && init?.method === 'POST',
        response: () => jsonResponse(200, { id: 'evt-via-update-fallback' }),
      },
    ]);

    await handleUpdateCalendarEvent(entry.id, {
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });

    const fresh = await db.entries.get(entry.id);
    expect(fresh?.googleEventId).toBe('evt-via-update-fallback');
  });

  it('drops the googleEventId when Calendar reports 404 (event deleted externally)', async () => {
    const card = await createCard(db, makeCard());
    const entry = await createEntry(
      db,
      makeEntry(card.id, { googleEventId: 'evt-gone', syncStatus: 'synced' }),
    );
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });

    const { fetchImpl } = makeFetch([
      {
        match: (url, init) => url.includes('evt-gone') && init?.method === 'PATCH',
        response: () => new Response('', { status: 404 }),
      },
    ]);

    await handleUpdateCalendarEvent(entry.id, {
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });

    const fresh = await db.entries.get(entry.id);
    expect(fresh?.googleEventId).toBeNull();
    expect(fresh?.syncStatus).toBe('synced');
  });
});

describe('handleDeleteCalendarEvent', () => {
  it('DELETEs the remote event using the cached calendar id', async () => {
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });
    const { fetchImpl, calls } = makeFetch([
      {
        match: (url, init) => url.includes('evt-doomed') && init?.method === 'DELETE',
        response: () => new Response('', { status: 204 }),
      },
    ]);
    await handleDeleteCalendarEvent('evt-doomed', {
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });
    expect(calls).toHaveLength(1);
  });

  it('is idempotent when the event is already gone (404)', async () => {
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });
    const { fetchImpl } = makeFetch([
      {
        match: (_url, init) => init?.method === 'DELETE',
        response: () => new Response('', { status: 404 }),
      },
    ]);
    await expect(
      handleDeleteCalendarEvent('evt-already-gone', {
        accessToken: 'tk',
        database: db,
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
  });

  it('is a no-op when no hourtrackCalendarId is set (user disconnected)', async () => {
    const { fetchImpl, calls } = makeFetch([]);
    await handleDeleteCalendarEvent('evt-anything', {
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });
    expect(calls).toHaveLength(0);
  });
});

describe('handleBulkUpdateCardEvents', () => {
  it('PATCHes every synced event for the card and reports progress', async () => {
    const card = await createCard(db, makeCard({ name: 'Old', color: '#22C55E' }));
    const e1 = await createEntry(
      db,
      makeEntry(card.id, {
        date: '2026-05-15',
        googleEventId: 'evt-a',
        syncStatus: 'synced',
      }),
    );
    const e2 = await createEntry(
      db,
      makeEntry(card.id, {
        date: '2026-05-16',
        googleEventId: 'evt-b',
        syncStatus: 'synced',
      }),
    );
    // Entry with no googleEventId — skipped.
    await createEntry(db, makeEntry(card.id, { date: '2026-05-17', googleEventId: null }));
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });

    let patches = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patches += 1;
        return jsonResponse(200, { id: 'whatever' });
      }
      throw new Error(`Unexpected ${init?.method} ${input.toString()}`);
    }) as typeof fetch;

    const progressEvents: Array<[number, number]> = [];
    await handleBulkUpdateCardEvents(card.id, {
      accessToken: 'tk',
      database: db,
      fetchImpl,
      onProgress: (done, total) => progressEvents.push([done, total]),
    });
    expect(patches).toBe(2);
    expect(progressEvents.at(-1)).toEqual([2, 2]);

    const refreshedA = await db.entries.get(e1.id);
    const refreshedB = await db.entries.get(e2.id);
    expect(refreshedA?.syncStatus).toBe('synced');
    expect(refreshedB?.syncStatus).toBe('synced');
  });

  it('is a no-op when the card has no synced events', async () => {
    const card = await createCard(db, makeCard());
    await createEntry(db, makeEntry(card.id, { googleEventId: null }));
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });

    const fetchImpl = (async () => {
      throw new Error('Should not call fetch');
    }) as typeof fetch;

    await expect(
      handleBulkUpdateCardEvents(card.id, {
        accessToken: 'tk',
        database: db,
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
  });

  it('drops googleEventId on per-event 404 without failing the bulk', async () => {
    const card = await createCard(db, makeCard());
    const e = await createEntry(
      db,
      makeEntry(card.id, { googleEventId: 'evt-vanished', syncStatus: 'synced' }),
    );
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });

    const fetchImpl = (async () => new Response('', { status: 404 })) as typeof fetch;

    await expect(
      handleBulkUpdateCardEvents(card.id, {
        accessToken: 'tk',
        database: db,
        fetchImpl,
      }),
    ).resolves.toBeUndefined();

    const refreshed = await db.entries.get(e.id);
    expect(refreshed?.googleEventId).toBeNull();
  });

  it('is a no-op when the card was deleted between enqueue and run', async () => {
    const fetchImpl = (async () => {
      throw new Error('Should not call fetch');
    }) as typeof fetch;
    await expect(
      handleBulkUpdateCardEvents('non-existent-card', {
        accessToken: 'tk',
        database: db,
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
    // Card lookup returned undefined — confirm via the public helper for transparency.
    const lookup = await getCardById(db, 'non-existent-card');
    expect(lookup).toBeUndefined();
  });
});
