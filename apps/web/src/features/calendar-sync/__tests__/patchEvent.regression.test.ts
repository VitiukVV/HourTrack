import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { HourTrackDB } from '@/lib/db/schema';
import { createCard, createEntry, initDB, updateSettings } from '@/lib/db/queries';

import {
  handleCreateCalendarEvent,
  handleUpdateCalendarEvent,
} from '@/features/sync/handlers/calendarOps';

/**
 * S20 Task 17 — Google Calendar edit regression test.
 *
 * Background: the user complaint (UR-20-11) was "I edited an entry in HourTrack
 * and Google Calendar showed TWO events instead of one — looks like an edit
 * POSTed a new event instead of PATCHing the existing one." The current code
 * (`calendarOps.handleUpdateCalendarEvent`) is correct — it PATCHes the
 * existing event when `entry.googleEventId` is set, and only falls back to
 * insert when it's null (the offline-edit-before-original-create-synced
 * recovery path).
 *
 * This test exists to LOCK that contract. A future refactor of SyncManager
 * dispatch, of `handleUpdateCalendarEvent`, or of `buildEvent` MUST keep
 * the PATCH-on-edit + no-duplicate-POST invariant. It is the explicit
 * regression cage UR-20-11 asked for.
 *
 * Scenario:
 *   1. Insert entry → POST returns `evt_123`.
 *   2. Edit entry (change `durationMin: 120 → 180`).
 *   3. Assert: SECOND fetch is a PATCH to `evt_123` (not a POST).
 *   4. Assert: the PATCH body's `end.dateTime` reflects the new 180 min duration.
 *   5. Assert: no second POST fired (i.e. no duplicate event was created).
 *
 * Uses the same fetch-mock harness pattern as `calendarOps.test.ts`.
 */

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-patchregr-${Math.random().toString(36).slice(2)}`);
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
    color: '#DC2626',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 15,
    fixedTotal: null,
    monthlyTotal: null,
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
    startMinutes: 600, // 10:00
    durationMin: 120, // 2h initially → end at 12:00
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    ...overrides,
  };
}

interface CapturedCall {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

function makeRecordingFetch(): {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
  // Allow per-call response overrides; default to 200 + a synthesized body.
  setNextInsertId: (id: string) => void;
} {
  const calls: CapturedCall[] = [];
  let nextInsertId = 'evt_default';
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = null;
      }
    }
    calls.push({ method, url, body });
    if (method === 'POST' && url.includes('/events')) {
      return new Response(JSON.stringify({ id: nextInsertId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'PATCH' && url.includes('/events/')) {
      // Echo body as the updated event.
      return new Response(JSON.stringify({ id: nextInsertId, ...(body ?? {}) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected ${method} ${url}`);
  }) as typeof fetch;
  return {
    fetchImpl,
    calls,
    setNextInsertId: (id) => {
      nextInsertId = id;
    },
  };
}

describe('Google Calendar PATCH-on-edit regression (S20 / UR-20-11)', () => {
  it('editing an entry PATCHes the existing event (no duplicate POST)', async () => {
    // Arrange: card + entry seeded, calendar id cached.
    const card = await createCard(db, makeCard());
    const entry = await createEntry(db, makeEntry(card.id));
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });

    const { fetchImpl, calls, setNextInsertId } = makeRecordingFetch();
    setNextInsertId('evt_123');

    // 1. Insert (POST) → stamp googleEventId on the entry.
    await handleCreateCalendarEvent(entry.id, {
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });
    const insertCalls = calls.filter((c) => c.method === 'POST' && c.url.includes('/events'));
    expect(insertCalls).toHaveLength(1);
    const afterCreate = await db.entries.get(entry.id);
    expect(afterCreate?.googleEventId).toBe('evt_123');
    expect(afterCreate?.syncStatus).toBe('synced');

    // 2. Edit: change durationMin 120 → 180.
    await db.entries.update(entry.id, {
      durationMin: 180,
      syncStatus: 'pending',
      updatedAt: new Date().toISOString(),
    });

    // 3. Trigger the update handler — must PATCH, not POST.
    await handleUpdateCalendarEvent(entry.id, {
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });

    // 4. Assert: exactly ONE PATCH was made against `evt_123`. The same
    //    test also guards "POST count stayed at 1" — a regression where
    //    the update handler accidentally falls into the create branch
    //    would surface as a second POST.
    const postsAfterEdit = calls.filter((c) => c.method === 'POST' && c.url.includes('/events'));
    const patches = calls.filter((c) => c.method === 'PATCH' && c.url.includes('/events/evt_123'));
    expect(postsAfterEdit).toHaveLength(1); // still just the original insert
    expect(patches).toHaveLength(1);

    // 5. Assert: the PATCH body carries the new end time. Start is 10:00,
    //    new duration 180 min → end 13:00. `buildEvent` produces a
    //    time-bound payload with `start.dateTime` / `end.dateTime` (S16b).
    const patch = patches[0]!;
    const end = (patch.body?.end as { dateTime?: string } | undefined) ?? undefined;
    expect(end?.dateTime).toBe('2026-05-15T13:00:00');
  });

  // Defensive: editing the entry SHOULD NOT recreate the event under the
  // happy-path. The above test covers the call shape; this one explicitly
  // asserts the entry's googleEventId stays put (no resurrection on PATCH).
  it('googleEventId is preserved across the edit (event is not re-created)', async () => {
    const card = await createCard(db, makeCard());
    const entry = await createEntry(db, makeEntry(card.id));
    await updateSettings(db, { hourtrackCalendarId: 'cal-cached' });

    const { fetchImpl, setNextInsertId } = makeRecordingFetch();
    setNextInsertId('evt_persistent');

    await handleCreateCalendarEvent(entry.id, {
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });

    await db.entries.update(entry.id, {
      durationMin: 240,
      syncStatus: 'pending',
      updatedAt: new Date().toISOString(),
    });

    await handleUpdateCalendarEvent(entry.id, {
      accessToken: 'tk',
      database: db,
      fetchImpl,
    });

    const fresh = await db.entries.get(entry.id);
    expect(fresh?.googleEventId).toBe('evt_persistent');
    expect(fresh?.syncStatus).toBe('synced');
    expect(fresh?.syncError).toBeNull();
  });
});
