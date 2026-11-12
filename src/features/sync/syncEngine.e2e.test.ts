import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card, DriveSnapshot, Entry } from '@/shared/types';

import { HourTrackDB } from '@/lib/db/schema';
import {
  createCard,
  createEntry,
  deleteEntry,
  getAllEntries,
  getSettings,
  initDB,
  addShoppingItem,
  setMonthAdjustment,
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
  /** Pull + merge + apply (+ upload if needed), the way a session pull does. */
  sync: () => Promise<string>;
  /** Push local state to Drive, the way a mutation does. */
  push: () => Promise<void>;
  destroy: () => Promise<void>;
}

let drive: FakeDrive;
const devices: Device[] = [];

async function makeDevice(name: string, opts: { renewTo?: string } = {}): Promise<Device> {
  const db = new HourTrackDB(`hourtrack-e2e-${name}-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
  const token = `token-${name}`;
  const manager = new SyncManager({
    database: db,
    debounceMs: 0,
    fetchImpl: drive.fetchImpl,
    getAccessToken: () => Promise.resolve(token),
    forceRenewAccessToken: () => Promise.resolve(opts.renewTo ?? null),
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
      const result = await runBootstrap(manager);
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
    position: 0,
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
    expect(await b.sync()).toBe('pulled');

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
    // is stamped later, so B wins wherever the two meet. `updateEntry` stamps
    // `updatedAt` from the clock (a patched value is ignored), so pin the clock
    // — two real writes can land in the same millisecond and tie.
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(now + 1_000);
      await updateEntry(a.db, entry.id, { note: 'from A' });
      vi.setSystemTime(now + 2_000);
      await updateEntry(b.db, entry.id, { note: 'from B' });
    } finally {
      vi.useRealTimers();
    }

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

  it('keeps both rows when a device uploads without having pulled the other one (SC-002)', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    await a.sync();

    const b = await makeDevice('b');
    await b.sync();

    // B uploads a row; A has not pulled since, so its last-known revision is
    // stale. Drive offers no readable ETag, so A must notice the change by
    // the file's `version` and merge before it uploads.
    await createEntry(b.db, newEntry(card.id, { note: 'from B' }));
    await b.push();

    await createEntry(a.db, newEntry(card.id, { note: 'from A' }));
    await a.push();

    const notes = drive.read<DriveSnapshot>('data.json')?.entries.map((e) => e.note) ?? [];
    expect(notes).toHaveLength(2);
    expect(notes).toEqual(expect.arrayContaining(['from A', 'from B']));
    const onA = (await getAllEntries(a.db)).map((e) => e.note);
    expect(onA).toEqual(expect.arrayContaining(['from A', 'from B']));

    // The revision A holds is the one it just wrote — a stale value would
    // make every later push download the file again.
    const settings = await getSettings(a.db);
    expect(settings?.driveDataEtag).toBeTruthy();
  });

  it('does not download the file when the remote is unchanged (SC-003)', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    await a.sync();
    await createEntry(a.db, newEntry(card.id, { note: 'one' }));
    await a.push();

    const mediaBefore = drive.mediaReads;
    const writesBefore = drive.writes;
    await createEntry(a.db, newEntry(card.id, { note: 'two' }));
    await a.push();

    expect(drive.mediaReads).toBe(mediaBefore);
    // Content upload + the appProperties patch.
    expect(drive.writes - writesBefore).toBe(2);
    expect(drive.read<DriveSnapshot>('data.json')?.entries).toHaveLength(2);
  });

  it('merges into an existing file when this device has no cached file id (FR-005)', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard({ name: 'Acme' }));
    await createEntry(a.db, newEntry(card.id, { note: 'from A' }));
    await a.sync();

    // B never loaded (its first pull failed); its first edit must not replace
    // the shared copy.
    const b = await makeDevice('b');
    const bCard = await createCard(b.db, newCard({ name: 'Beta' }));
    await createEntry(b.db, newEntry(bCard.id, { note: 'from B' }));
    await b.push();

    const remote = drive.read<DriveSnapshot>('data.json');
    expect(remote?.entries.map((e) => e.note)).toEqual(
      expect.arrayContaining(['from A', 'from B']),
    );
    expect(remote?.cards).toHaveLength(2);
    expect(await getAllEntries(b.db)).toHaveLength(2);
    expect(drive.count('data.json')).toBe(1);
  });

  it('ends up with one shared file after the remote was removed (FR-007)', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    await a.sync();
    const b = await makeDevice('b');
    await b.sync();

    drive.remove('data.json');

    await createEntry(a.db, newEntry(card.id, { note: 'from A' }));
    await a.push();
    await createEntry(b.db, newEntry(card.id, { note: 'from B' }));
    await b.push();

    expect(drive.count('data.json')).toBe(1);
    const notes = drive.read<DriveSnapshot>('data.json')?.entries.map((e) => e.note) ?? [];
    expect(notes).toEqual(expect.arrayContaining(['from A', 'from B']));
  });
});

describe('pullNow', () => {
  it('pulls the other device rows and reports pulled / unchanged', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    expect(await a.sync()).toBe('created');

    const b = await makeDevice('b');
    expect(await b.sync()).toBe('pulled');

    await createEntry(a.db, newEntry(card.id, { note: 'later' }));
    await a.push();

    expect(await b.sync()).toBe('pulled');
    expect((await getAllEntries(b.db))[0]?.note).toBe('later');

    // Nothing changed since: one metadata read, no download, no write.
    const mediaBefore = drive.mediaReads;
    const writesBefore = drive.writes;
    expect(await b.sync()).toBe('unchanged');
    expect(drive.mediaReads).toBe(mediaBefore);
    expect(drive.writes).toBe(writesBefore);
  });

  it('uploads rows the remote lacks in payments / reminders / month amounts / shopping (FR-006)', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    await a.sync();
    const b = await makeDevice('b');
    await b.sync();

    // Local-only rows with no queued push (e.g. the queue row was lost).
    await addShoppingItem(a.db, card.id, 'Milk');
    await setMonthAdjustment(a.db, { cardId: card.id, period: '2026-03', amount: 100 });
    // B uploads an identical copy — the remote revision changes, so A pulls.
    await b.push();

    expect(await a.sync()).toBe('pulled');

    const remote = drive.read<DriveSnapshot>('data.json');
    expect(remote?.shoppingItems).toHaveLength(1);
    expect(remote?.monthAdjustments).toHaveLength(1);
  });

  it('renews the sign-in once on a 401 and still pulls', async () => {
    const a = await makeDevice('a');
    await createCard(a.db, newCard({ name: 'Acme' }));
    await a.sync();

    const b = await makeDevice('b', { renewTo: 'token-b-renewed' });
    drive.revoke('token-b');
    expect(await b.sync()).toBe('pulled');
    expect(await b.db.cards.count()).toBe(1);
  });
});
