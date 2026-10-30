import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card } from '@/shared/types';

import { HourTrackDB } from '@/lib/db/schema';
import {
  createCard,
  createEntry,
  enqueueSyncOp,
  getAllSyncQueueRows,
  getEntryById,
  initDB,
  updateSettings,
} from '@/lib/db/queries';
import { SCOPE_CALENDAR_APP_CREATED, SCOPE_DRIVE_APPDATA } from '@/lib/google/config';

import { SyncManager } from './SyncManager';

/**
 * Spec 014 — a phone suspends the token-renewal timer with the backgrounded
 * PWA, so the first sync after resume can carry an expired token. A 401 must
 * renew the sign-in once per run and repeat the request, not stamp an error.
 */

const SCOPES = `openid email profile ${SCOPE_DRIVE_APPDATA} ${SCOPE_CALENDAR_APP_CREATED}`;

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-authrenew-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
  await updateSettings(db, { hourtrackCalendarId: 'cal-1' });
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});

const card: Omit<Card, 'createdAt' | 'updatedAt'> = {
  id: 'card-1',
  name: 'Raquel',
  color: '#2563EB',
  position: 0,
  defaultDurationMin: 150,
  defaultStartMinutes: 540,
  rateType: 'hourly',
  hourlyRate: 12,
  fixedTotal: null,
  monthlyTotal: null,
  defaultNote: null,
  isArchived: false,
  archivedAt: null,
};

async function seedEntryWithUpdateOp(id: string): Promise<void> {
  await createEntry(db, {
    id,
    cardId: card.id,
    date: '2026-10-30',
    startMinutes: 540,
    durationMin: 150,
    useCustomPayment: false,
    customPayment: null,
    note: 'Bags',
    googleEventId: `evt-${id}`,
    syncStatus: 'pending',
    syncError: null,
  });
  await enqueueSyncOp(db, {
    op: 'updateCalendarEvent',
    mutation: 'update',
    entityType: 'entry',
    entityId: id,
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', etag: 'etag-1' },
  });
}

/** Calendar + Drive stub that only accepts the `valid` bearer token. */
function googleAccepting(valid: string, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('Authorization') ?? '';
    calls.push(auth);
    if (auth !== `Bearer ${valid}`) {
      return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
    }
    const url = input.toString();
    if (url.includes('/calendar/')) return json(200, { id: 'evt', status: 'confirmed' });
    if (url.includes('upload/drive/v3/files'))
      return json(200, { id: 'file-1', name: 'data.json' });
    return json(200, { files: [] });
  }) as typeof fetch;
}

function manager(fetchImpl: typeof fetch, renewAccessToken: () => Promise<string | null>) {
  return new SyncManager({
    database: db,
    debounceMs: 0,
    fetchImpl,
    attachWindowListeners: false,
    getAccessToken: async () => 'AT-OLD',
    getGrantedScopes: async () => SCOPES,
    renewAccessToken,
    computeRetryDelay: () => 60_000,
  });
}

describe('SyncManager — renew the sign-in on 401 (spec 014)', () => {
  it('renews and repeats a calendar update rejected as unauthorized', async () => {
    await createCard(db, card);
    await seedEntryWithUpdateOp('e1');
    const renew = vi.fn(async () => 'AT-NEW');

    await manager(googleAccepting('AT-NEW'), renew).flushNow();

    expect(renew).toHaveBeenCalledTimes(1);
    expect(await getAllSyncQueueRows(db)).toHaveLength(0);
    const entry = await getEntryById(db, 'e1');
    expect(entry?.syncStatus).toBe('synced');
    expect(entry?.syncError).toBeNull();
  });

  it('records the error when the repeated request is rejected again', async () => {
    await createCard(db, card);
    await seedEntryWithUpdateOp('e1');
    const renew = vi.fn(async () => 'AT-ALSO-BAD');

    await manager(googleAccepting('AT-NEW'), renew).flushNow();

    expect(renew).toHaveBeenCalledTimes(1);
    const rows = await getAllSyncQueueRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attempts).toBe(1);
    expect((await getEntryById(db, 'e1'))?.syncStatus).toBe('error');
  });

  it('keeps the existing error path when renewal fails', async () => {
    await createCard(db, card);
    await seedEntryWithUpdateOp('e1');
    const renew = vi.fn(async () => null);
    const calls: string[] = [];

    await manager(googleAccepting('AT-NEW', calls), renew).flushNow();

    expect(renew).toHaveBeenCalledTimes(1);
    expect(calls.every((c) => c === 'Bearer AT-OLD')).toBe(true);
    expect(await getAllSyncQueueRows(db)).toHaveLength(1);
    expect((await getEntryById(db, 'e1'))?.syncStatus).toBe('error');
  });

  it('renews once for a whole batch of queued calendar changes', async () => {
    await createCard(db, card);
    await seedEntryWithUpdateOp('e1');
    await seedEntryWithUpdateOp('e2');
    await seedEntryWithUpdateOp('e3');
    const renew = vi.fn(async () => 'AT-NEW');

    await manager(googleAccepting('AT-NEW'), renew).flushNow();

    expect(renew).toHaveBeenCalledTimes(1);
    expect(await getAllSyncQueueRows(db)).toHaveLength(0);
    for (const id of ['e1', 'e2', 'e3']) {
      expect((await getEntryById(db, id))?.syncStatus).toBe('synced');
    }
  });

  it('renews and repeats a Drive backup push rejected as unauthorized', async () => {
    await createCard(db, card);
    await enqueueSyncOp(db, { op: 'pushDataJson' });
    const renew = vi.fn(async () => 'AT-NEW');

    await manager(googleAccepting('AT-NEW'), renew).flushNow();

    expect(renew).toHaveBeenCalledTimes(1);
    expect(await getAllSyncQueueRows(db)).toHaveLength(0);
  });

  it('does not renew when nothing is rejected', async () => {
    await createCard(db, card);
    await seedEntryWithUpdateOp('e1');
    const renew = vi.fn(async () => 'AT-NEW');

    await manager(googleAccepting('AT-OLD'), renew).flushNow();

    expect(renew).not.toHaveBeenCalled();
    expect(await getAllSyncQueueRows(db)).toHaveLength(0);
  });
});
