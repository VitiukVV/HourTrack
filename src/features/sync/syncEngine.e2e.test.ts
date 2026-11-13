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
  createPayment,
  createReminder,
  setMonthAdjustment,
  updateSettings,
  updateEntry,
} from '@/lib/db/queries';
import { SCOPE_CALENDAR_APP_CREATED, SCOPE_DRIVE_APPDATA } from '@/lib/google/config';
import { SUPPORTED_SNAPSHOT_VERSION_MAX } from '@/lib/sync/validateSnapshot';

import { FakeDrive, type FakeDriveOptions } from './fakeDrive';
import { runBootstrap } from './bootstrap';
import { SyncManager } from './SyncManager';
import { SYNC_UPDATE_REQUIRED } from './syncErrorMessage';

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
  /** Whether a sign-in is stored — `enqueue` drops ops while false. */
  signedIn: boolean;
  /**
   * Pull + merge + apply (+ upload if needed), the way a session pull does.
   * `force` is the session's first pull (spec 016 A2).
   */
  sync: (opts?: { force?: boolean }) => Promise<string>;
  /** Replace the manager with a new one on the same database (an app reload). */
  reload: () => void;
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
  const makeManager = () =>
    new SyncManager({
      database: db,
      debounceMs: 0,
      fetchImpl: drive.fetchImpl,
      getAccessToken: () => Promise.resolve(token),
      isSignedIn: async () => device.signedIn,
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
    manager: makeManager(),
    signedIn: true,
    sync: async (syncOpts) => {
      const result = await runBootstrap(device.manager, syncOpts);
      if (result.outcome === 'failed') return `failed: ${result.error ?? ''}`;
      return result.outcome;
    },
    reload: () => {
      device.manager.dispose();
      device.manager = makeManager();
    },
    push: async () => {
      await device.manager.enqueue({ op: 'pushDataJson' });
      await device.manager.flushNow();
    },
    destroy: async () => {
      device.manager.dispose();
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

/**
 * A fresh cloud. It always holds a backup next to `data.json`, as a real
 * account does — a lookup that ignored the name filter would pick it up.
 */
function newDrive(options?: FakeDriveOptions): FakeDrive {
  const fresh = new FakeDrive(options);
  fresh.write('backups/2025-12-31T2300.json', { schemaVersion: 2, cards: [], entries: [] });
  return fresh;
}

beforeEach(() => {
  drive = newDrive();
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
    expect(settings?.driveDataEtag).toBe(drive.versionOf('data.json'));
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
    // One multipart write carries content + appProperties.
    expect(drive.writes - writesBefore).toBe(1);
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
    await createPayment(a.db, {
      id: crypto.randomUUID(),
      cardId: card.id,
      period: '2026-03',
      amount: 50,
      paidOn: '2026-03-31',
      note: null,
    });
    await createReminder(a.db, {
      id: crypto.randomUUID(),
      text: 'Invoice',
      dueDate: '2026-04-01',
      dueMinutes: 540,
      doneAt: null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
      notifiedAt: null,
    });
    await addShoppingItem(a.db, card.id, 'Milk');
    await setMonthAdjustment(a.db, { cardId: card.id, period: '2026-03', amount: 100 });
    // B uploads an identical copy — the remote revision changes, so A pulls.
    await b.push();

    expect(await a.sync()).toBe('pulled');

    const remote = drive.read<DriveSnapshot>('data.json');
    expect(remote?.payments).toHaveLength(1);
    expect(remote?.reminders).toHaveLength(1);
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

describe('newer-format remote (FR-008)', () => {
  /** Re-stamp the shared file as written by a newer app. */
  function makeRemoteNewer(): void {
    const remote = drive.read<Record<string, unknown>>('data.json');
    drive.write('data.json', {
      ...remote,
      schemaVersion: SUPPORTED_SNAPSHOT_VERSION_MAX + 1,
      somethingNew: [{ id: 'x' }],
    });
  }

  function remoteVersion(): unknown {
    return drive.read<{ schemaVersion: unknown }>('data.json')?.schemaVersion;
  }

  it('a push that discovers it uploads nothing, keeps the row queued, then drains once the file is readable', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    await a.sync();
    const supported = drive.read<DriveSnapshot>('data.json');
    makeRemoteNewer();

    const writesBefore = drive.writes;
    const entry = await createEntry(a.db, newEntry(card.id, { note: 'kept' }));
    await a.push();

    expect(drive.writes).toBe(writesBefore);
    expect(remoteVersion()).toBe(SUPPORTED_SNAPSHOT_VERSION_MAX + 1);
    expect(await a.db.syncQueue.count()).toBe(1);
    expect(a.manager.getStatus()).toBe('error');
    expect(a.manager.getLastError()).toBe(SYNC_UPDATE_REQUIRED);
    expect(await a.db.entries.get(entry.id)).toBeDefined();

    // No hammering: further flushes touch neither the network nor the row.
    const readsBefore = drive.reads;
    await a.manager.flushNow();
    await a.push();
    expect(drive.reads).toBe(readsBefore);
    expect(drive.writes).toBe(writesBefore);
    expect(a.manager.getLastError()).toBe(SYNC_UPDATE_REQUIRED);

    // A pull still checks — and keeps reporting the state.
    expect(await a.sync()).toBe('update-required');
    expect(drive.writes).toBe(writesBefore);

    // The file becomes readable again (the newer device wrote a supported
    // copy / this app was updated): the next pull clears the state and the
    // queued push drains on its own.
    drive.write('data.json', supported);
    expect(await a.sync()).toBe('pulled');
    await vi.waitFor(async () => expect(await a.db.syncQueue.count()).toBe(0));
    expect(a.manager.getStatus()).toBe('idle');
    expect(a.manager.getLastError()).toBeUndefined();
    expect(drive.read<DriveSnapshot>('data.json')?.entries.map((e) => e.note)).toContain('kept');
  });

  it('a pull that discovers it reports update-required and blocks later pushes', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    await a.sync();
    makeRemoteNewer();

    const writesBefore = drive.writes;
    expect(await a.sync()).toBe('update-required');
    expect(a.manager.getStatus()).toBe('error');
    expect(a.manager.getLastError()).toBe(SYNC_UPDATE_REQUIRED);

    await createEntry(a.db, newEntry(card.id));
    await a.push();
    expect(drive.writes).toBe(writesBefore);
    expect(await a.db.syncQueue.count()).toBe(1);
    expect(remoteVersion()).toBe(SUPPORTED_SNAPSHOT_VERSION_MAX + 1);
  });

  it('is not bypassed by a device with no cached file id', async () => {
    const a = await makeDevice('a');
    await createCard(a.db, newCard());
    await a.sync();
    makeRemoteNewer();

    const b = await makeDevice('b');
    await createCard(b.db, newCard({ name: 'Beta' }));
    const writesBefore = drive.writes;
    await b.push();
    expect(await b.sync()).toBe('update-required');

    expect(drive.writes).toBe(writesBefore);
    expect(drive.count('data.json')).toBe(1);
    expect(remoteVersion()).toBe(SUPPORTED_SNAPSHOT_VERSION_MAX + 1);
  });

  it('is not bypassed when the cached file is gone and a newer one exists (404 → find)', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    await a.sync();
    const remote = drive.read<Record<string, unknown>>('data.json');
    drive.remove('data.json');
    drive.write('data.json', { ...remote, schemaVersion: SUPPORTED_SNAPSHOT_VERSION_MAX + 1 });

    const writesBefore = drive.writes;
    await createEntry(a.db, newEntry(card.id));
    await a.push();

    expect(drive.writes).toBe(writesBefore);
    expect(drive.count('data.json')).toBe(1);
    expect(a.manager.getLastError()).toBe(SYNC_UPDATE_REQUIRED);
    expect(await a.db.syncQueue.count()).toBe(1);
  });
});

describe('review fixes (spec 016 Phase R)', () => {
  it('uploads a preference changed locally when nothing else differs (A3)', async () => {
    const a = await makeDevice('a');
    await createCard(a.db, newCard());
    await a.sync();
    const b = await makeDevice('b');
    await b.sync();

    // Stamps `settingsUpdatedAt`; no push is queued for it here.
    await updateSettings(a.db, { theme: 'dark' });
    await b.push(); // the remote revision changes, so A pulls

    expect(await a.sync()).toBe('pulled');
    expect(drive.read<DriveSnapshot>('data.json')?.settings.theme).toBe('dark');
  });

  it('edits made while signed out reach Drive at the next sign-in, remote unchanged (A2)', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    await a.sync();

    a.signedIn = false;
    await createEntry(a.db, newEntry(card.id, { note: 'signed out' }));
    await a.push(); // dropped: nothing is queued while signed out
    expect(await a.db.syncQueue.count()).toBe(0);

    a.signedIn = true;
    // A later, cheap pull sees the same version and does nothing…
    expect(await a.sync()).toBe('unchanged');
    // …the session's first pull compares the rows anyway.
    expect(await a.sync({ force: true })).toBe('pulled');
    const notes = drive.read<DriveSnapshot>('data.json')?.entries.map((e) => e.note);
    expect(notes).toEqual(['signed out']);
  });

  it('settles on the oldest data.json when an older build left duplicates (A5)', async () => {
    const oldest = await makeDevice('old');
    await createCard(oldest.db, newCard({ name: 'Oldest' }));
    await oldest.sync();
    const snapshot = drive.read<DriveSnapshot>('data.json')!;
    drive.addDuplicate('data.json', {
      ...snapshot,
      cards: snapshot.cards.map((c) => ({ ...c, id: crypto.randomUUID(), name: 'Newer' })),
    });

    const a = await makeDevice('a');
    expect(await a.sync()).toBe('pulled');
    expect((await a.db.cards.toArray()).map((c) => c.name)).toEqual(['Oldest']);
  });

  it('the near-simultaneous upload race heals at the next syncs', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    await a.sync();
    const b = await makeDevice('b');
    await b.sync();

    await createEntry(b.db, newEntry(card.id, { note: 'from B' }));
    await createEntry(a.db, newEntry(card.id, { note: 'from A' }));
    // B uploads after A checked the version but before A's upload lands.
    drive.beforeNextUpload(a.token, () => b.push());
    await a.push();
    // A's upload overwrote B's row — the accepted race.
    expect(drive.read<DriveSnapshot>('data.json')?.entries.map((e) => e.note)).toEqual(['from A']);

    await b.sync();
    await a.sync();

    const both = ['from A', 'from B'];
    const remote = drive.read<DriveSnapshot>('data.json')?.entries.map((e) => e.note) ?? [];
    expect(remote.sort()).toEqual(both);
    expect((await getAllEntries(a.db)).map((e) => e.note).sort()).toEqual(both);
    expect((await getAllEntries(b.db)).map((e) => e.note).sort()).toEqual(both);
  });

  it('a failed upload after a successful merge inside pullNow keeps the old revision', async () => {
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    await a.sync();
    const b = await makeDevice('b');
    await b.sync();

    await createEntry(a.db, newEntry(card.id, { note: 'local only' })); // no queued push
    await b.push(); // the remote revision changes
    const remembered = (await getSettings(a.db))?.driveDataEtag;

    drive.beforeNextUpload(a.token, () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await a.sync()).toMatch(/^failed/);
    expect((await getSettings(a.db))?.driveDataEtag).toBe(remembered);
    expect(drive.read<DriveSnapshot>('data.json')?.entries).toHaveLength(0);

    expect(await a.sync()).toBe('pulled');
    expect(drive.read<DriveSnapshot>('data.json')?.entries.map((e) => e.note)).toEqual([
      'local only',
    ]);
  });

  it('fails safe when Drive omits the version: SC-002 still keeps both rows', async () => {
    drive = newDrive({ omitVersion: true });
    const a = await makeDevice('a');
    const card = await createCard(a.db, newCard());
    await a.sync();
    const b = await makeDevice('b');
    await b.sync();

    await createEntry(b.db, newEntry(card.id, { note: 'from B' }));
    await b.push();
    await createEntry(a.db, newEntry(card.id, { note: 'from A' }));
    await a.push();

    const notes = drive.read<DriveSnapshot>('data.json')?.entries.map((e) => e.note) ?? [];
    expect(notes.sort()).toEqual(['from A', 'from B']);
  });

  describe('guards survive an app reload (new manager, same database)', () => {
    it('newer-format remote: zero writes, format untouched, revision not advanced', async () => {
      const a = await makeDevice('a');
      const card = await createCard(a.db, newCard());
      await a.sync();
      const remote = drive.read<Record<string, unknown>>('data.json');
      drive.write('data.json', { ...remote, schemaVersion: SUPPORTED_SNAPSHOT_VERSION_MAX + 1 });
      expect(await a.sync()).toBe('update-required');
      const remembered = (await getSettings(a.db))?.driveDataEtag;

      a.reload();
      const writesBefore = drive.writes;
      await createEntry(a.db, newEntry(card.id));
      await a.push();
      expect(await a.sync()).toBe('update-required');

      expect(drive.writes).toBe(writesBefore);
      expect(drive.read<{ schemaVersion: number }>('data.json')?.schemaVersion).toBe(
        SUPPORTED_SNAPSHOT_VERSION_MAX + 1,
      );
      expect((await getSettings(a.db))?.driveDataEtag).toBe(remembered);
      expect(await a.db.syncQueue.count()).toBe(1);
    });

    it('corrupt remote: zero writes, revision not advanced', async () => {
      const a = await makeDevice('a');
      const card = await createCard(a.db, newCard());
      await a.sync();
      drive.write('data.json', { schemaVersion: 2, cards: null });
      expect(await a.sync()).toMatch(/^failed/);
      const remembered = (await getSettings(a.db))?.driveDataEtag;

      a.reload();
      const writesBefore = drive.writes;
      await createEntry(a.db, newEntry(card.id));
      await a.push();
      expect(await a.sync()).toMatch(/^failed/);

      expect(drive.writes).toBe(writesBefore);
      expect(drive.read<{ cards: unknown }>('data.json')?.cards).toBeNull();
      expect((await getSettings(a.db))?.driveDataEtag).toBe(remembered);
      expect(await a.db.syncQueue.count()).toBe(1);
    });
  });
});

describe('FakeDrive fidelity', () => {
  it('rejects a files.list query it cannot parse with 400', async () => {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', "nam = 'data.json'");
    const res = await drive.fetchImpl(url.toString(), {
      headers: { Authorization: 'Bearer t' },
    });
    expect(res.status).toBe(400);
  });
});
