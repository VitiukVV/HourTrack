import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Card, DriveSnapshot, Entry } from '@hourtrack/shared-types';

import { HourTrackDB } from '@/lib/db/schema';
import {
  createCard,
  createEntry,
  deleteEntry,
  getAllEntries,
  getSettings,
  initDB,
  updateEntry,
} from '@/lib/db/queries';
import { SCOPE_CALENDAR_APP_CREATED, SCOPE_DRIVE_APPDATA } from '@/lib/google/config';

import { FakeDrive } from './fakeDrive';
import { runBootstrap } from './bootstrap';
import { SyncManager } from './SyncManager';

/**
 * Two devices, one cloud.
 *
 * Every existing sync test looks at one half of the cycle: `lwwMerge` as a
 * pure function, `SyncManager` against canned fetch responses, one Playwright
 * scenario in a browser. The full merge → push → pull-by-the-other-device loop
 * was tested nowhere — which is exactly the seam the S29/S31 defects lived in.
 *
 * Each device gets its own Dexie database and its own `SyncManager`; both talk
 * to a single `FakeDrive`, whose files are stored as JSON text so the devices
 * cannot accidentally share an object graph.
 */

const SCOPES = `${SCOPE_DRIVE_APPDATA} ${SCOPE_CALENDAR_APP_CREATED}`;

interface Device {
  db: HourTrackDB;
  token: string;
  manager: SyncManager;
  /** Pull + merge + apply, the way AuthProvider does on an authed transition. */
  sync: () => Promise<string>;
  /** Push local state to Drive, the way a mutation does. */
  push: () => Promise<void>;
  destroy: () => Promise<void>;
}

let drive: FakeDrive;
const devices: Device[] = [];

async function makeDevice(name: string): Promise<Device> {
  const db = new HourTrackDB(`hourtrack-e2e-${name}-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
  const token = `token-${name}`;
  const manager = new SyncManager({
    database: db,
    debounceMs: 0,
    fetchImpl: drive.fetchImpl,
    getAccessToken: () => Promise.resolve(token),
    getGrantedScopes: () => Promise.resolve(SCOPES),
    attachWindowListeners: false,
    // No backoff: a failed push must be retryable on the very next flush, or
    // the airplane-mode scenario would just be measuring the retry schedule.
    computeRetryDelay: () => 0,
  });
  const device: Device = {
    db,
    token,
    manager,
    sync: async () => {
      const result = await runBootstrap({
        database: db,
        accessToken: token,
        grantedScopes: SCOPES,
        fetchImpl: drive.fetchImpl,
      });
      if (result.outcome === 'failed') return `failed: ${result.error ?? ''}`;
      return result.outcome;
    },
    push: async () => {
      await manager.enqueue({ op: 'pushDataJson' });
      await manager.flushNow();
    },
    destroy: async () => {
      manager.dispose();
      await db.delete();
    },
  };
  devices.push(device);
  return device;
}

function newCard(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    name: 'Client',
    color: '#2563EB',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    ...overrides,
  };
}

function newEntry(
  cardId: string,
  overrides: Partial<Entry> = {},
): Omit<Entry, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    cardId,
    date: '2026-03-10',
    startMinutes: 600,
    durationMin: 120,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    ...overrides,
  };
}

beforeEach(() => {
  drive = new FakeDrive();
});

afterEach(async () => {
  for (const device of devices.splice(0)) await device.destroy();
});

describe('two-device sync', () => {
  it('carries a card and an entry from A to B', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard({ name: 'Acme' }));
    await createEntry(a.db, newEntry(card.id, { note: 'kickoff' }));

    expect(await a.sync()).toBe('created');
    expect(drive.read<DriveSnapshot>('data.json')?.entries).toHaveLength(1);

    const b = await makeDevice('b');
    expect(await b.sync()).toBe('merged-remote-newer');

    const onB = await getAllEntries(b.db);
    expect(onB).toHaveLength(1);
    expect(onB[0]?.note).toBe('kickoff');
    expect(await b.db.cards.get(card.id)).toMatchObject({ name: 'Acme' });
  });

  it('resolves a concurrent edit of the same entry by last write', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    const entry = await createEntry(a.db, newEntry(card.id, { note: 'original' }));
    await a.sync();

    const b = await makeDevice('b');
    await b.sync();

    // Both devices edit the same entry while unaware of each other. B's write
    // is stamped later, so B wins wherever the two meet.
    await updateEntry(a.db, entry.id, { note: 'from A', updatedAt: '2026-03-10T09:00:00.000Z' });
    await updateEntry(b.db, entry.id, { note: 'from B', updatedAt: '2026-03-10T10:00:00.000Z' });

    await a.push();
    await b.sync(); // B pulls A's version, merges, and keeps its newer note.
    await b.push();

    expect(drive.read<DriveSnapshot>('data.json')?.entries[0]?.note).toBe('from B');

    // A picks the resolution up on its next sync rather than re-winning.
    await a.sync();
    expect((await getAllEntries(a.db))[0]?.note).toBe('from B');
  });

  it('propagates a delete without the other device resurrecting it', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    const entry = await createEntry(a.db, newEntry(card.id));
    await a.sync();

    const b = await makeDevice('b');
    await b.sync();
    expect(await getAllEntries(b.db)).toHaveLength(1);

    await deleteEntry(a.db, entry.id);
    await a.push();

    await b.sync();
    expect(await getAllEntries(b.db)).toHaveLength(0);

    // The row B still had locally must not travel back up on B's next push —
    // the tombstone is what stops "delete on one device, reappear on the
    // other" and it has to survive the round trip through Drive.
    await b.push();
    expect(drive.read<DriveSnapshot>('data.json')?.entries).toHaveLength(0);

    await a.sync();
    expect(await getAllEntries(a.db)).toHaveLength(0);
  });

  it('holds edits made in airplane mode and flushes them on reconnect', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    await a.sync();

    drive.setOffline(true);
    const offlineEntry = await createEntry(a.db, newEntry(card.id, { note: 'on the plane' }));
    await a.push(); // fails; the queue row survives

    expect(drive.read<DriveSnapshot>('data.json')?.entries ?? []).toHaveLength(0);
    expect(await a.db.syncQueue.count()).toBeGreaterThan(0);

    drive.setOffline(false);
    await a.manager.flushNow();

    const uploaded = drive.read<DriveSnapshot>('data.json');
    expect(uploaded?.entries.map((e) => e.id)).toContain(offlineEntry.id);

    const b = await makeDevice('b');
    await b.sync();
    expect((await getAllEntries(b.db))[0]?.note).toBe('on the plane');
  });

  it('recovers from a concurrent write that invalidates the cached etag', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    await a.sync();

    const b = await makeDevice('b');
    await b.sync();

    // A writes; B's cached etag is now stale, so B's push gets a 412 and has
    // to pull + merge + retry rather than clobbering A's row.
    await createEntry(a.db, newEntry(card.id, { note: 'from A' }));
    await a.push();

    await createEntry(b.db, newEntry(card.id, { note: 'from B' }));
    await b.push();

    const notes = drive.read<DriveSnapshot>('data.json')?.entries.map((e) => e.note) ?? [];
    expect(notes).toHaveLength(2);
    expect(notes).toEqual(expect.arrayContaining(['from A', 'from B']));

    // The etag B ends up holding is the one it just wrote — a stale cache here
    // would make every subsequent push pay for another 412 round trip.
    const settings = await getSettings(b.db);
    expect(settings?.driveDataEtag).toBeTruthy();
    const writesBefore = drive.writes;
    await b.push();
    expect(drive.writes - writesBefore).toBeLessThanOrEqual(3);
  });
});
