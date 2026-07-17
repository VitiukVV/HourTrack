import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  Card,
  DriveSnapshot,
  Entry,
  Payment,
  Reminder,
  Settings,
  Tombstone,
} from '@hourtrack/shared-types';

import { HourTrackDB } from '@/lib/db/schema';
import { defaultSettings, initDB } from '@/lib/db/queries';

import { applySnapshot } from './snapshot';

/**
 * S29 Blocker #1 — the row-wise LWW `applySnapshot({ mode: 'merge' })` path.
 *
 * The audit found that the SyncManager 412 merge and the bootstrap pull both
 * called `applySnapshot(merged)` which did `clear()` + `bulkPut(merged)`. A
 * row written locally AFTER the snapshot was built (but before the merge
 * applied) was in neither the local snapshot nor the pulled remote, so it was
 * absent from `merged` — and `clear()` destroyed it permanently.
 *
 * These tests lock the fix: merge mode NEVER clears, applies per-row LWW, and
 * a mid-flight local write survives. The first test also shows that the legacy
 * `replace` mode WOULD have lost the row (documenting the regression).
 */

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-merge-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

function card(id: string, updatedAt: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    name: `Card ${id}`,
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    ...overrides,
  };
}

function entry(
  id: string,
  cardId: string,
  updatedAt: string,
  overrides: Partial<Entry> = {},
): Entry {
  return {
    id,
    cardId,
    date: '2026-05-14',
    startMinutes: 600,
    durationMin: 240,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'synced',
    syncError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    ...overrides,
  };
}

function payment(id: string, updatedAt: string, overrides: Partial<Payment> = {}): Payment {
  return {
    id,
    cardId: 'c1',
    period: '2026-05',
    amount: 100,
    paidOn: '2026-05-15',
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    ...overrides,
  };
}

function reminder(id: string, updatedAt: string, overrides: Partial<Reminder> = {}): Reminder {
  return {
    id,
    text: 'Reminder',
    dueDate: '2026-08-04',
    dueMinutes: 540,
    doneAt: null,
    googleEventId: null,
    syncStatus: 'synced',
    syncError: null,
    notifiedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    ...overrides,
  };
}

function snapshot(overrides: Partial<DriveSnapshot> = {}): DriveSnapshot {
  return {
    schemaVersion: 5,
    exportedAt: '2026-05-15T00:00:00.000Z',
    deviceId: 'remote-device',
    settings: defaultSettings(),
    cards: [],
    entries: [],
    payments: [],
    reminders: [],
    tombstones: [],
    ...overrides,
  };
}

describe('applySnapshot — merge mode (S29 row-wise LWW)', () => {
  it('preserves a local entry written AFTER the snapshot was built (Blocker #1 repro)', async () => {
    // A card + entry that existed when the snapshot was built.
    const c = card('c1', '2026-05-10T00:00:00.000Z');
    const e1 = entry('e1', 'c1', '2026-05-10T00:00:00.000Z');
    await db.cards.put(c);
    await db.entries.put(e1);

    // The snapshot the sync layer built at time T (it contains c + e1).
    const built = snapshot({ cards: [c], entries: [e1] });

    // Mid-flight: the user creates a NEW entry after the snapshot was built.
    const e2 = entry('e2-midflight', 'c1', '2026-05-16T00:00:00.000Z');
    await db.entries.put(e2);

    // Apply the (stale) built snapshot via the sync merge path.
    await applySnapshot(built, db, { mode: 'merge' });

    const ids = (await db.entries.toArray()).map((r) => r.id).sort();
    expect(ids).toEqual(['e1', 'e2-midflight']);
  });

  it('legacy replace mode WOULD have destroyed that mid-flight entry (documents the loss)', async () => {
    const c = card('c1', '2026-05-10T00:00:00.000Z');
    const e1 = entry('e1', 'c1', '2026-05-10T00:00:00.000Z');
    await db.cards.put(c);
    await db.entries.put(e1);
    const built = snapshot({ cards: [c], entries: [e1] });

    const e2 = entry('e2-midflight', 'c1', '2026-05-16T00:00:00.000Z');
    await db.entries.put(e2);

    await applySnapshot(built, db, { mode: 'replace' });

    const ids = (await db.entries.toArray()).map((r) => r.id).sort();
    expect(ids).toEqual(['e1']); // e2 lost — the bug the sprint fixes.
  });

  it('remote-newer row wins; local-newer row is preserved', async () => {
    await db.cards.put(card('remote-wins', '2026-05-10T00:00:00.000Z', { name: 'Old local' }));
    await db.cards.put(card('local-wins', '2026-05-20T00:00:00.000Z', { name: 'New local' }));

    const merged = snapshot({
      cards: [
        card('remote-wins', '2026-05-15T00:00:00.000Z', { name: 'Newer remote' }),
        card('local-wins', '2026-05-01T00:00:00.000Z', { name: 'Stale remote' }),
      ],
    });

    await applySnapshot(merged, db, { mode: 'merge' });

    const byId = new Map((await db.cards.toArray()).map((c) => [c.id, c]));
    expect(byId.get('remote-wins')!.name).toBe('Newer remote');
    expect(byId.get('local-wins')!.name).toBe('New local');
  });

  it('applies a winning tombstone delete but spares a locally re-created row', async () => {
    await db.entries.put(entry('deleted', 'c1', '2026-05-10T00:00:00.000Z'));
    await db.entries.put(entry('recreated', 'c1', '2026-05-20T00:00:00.000Z'));

    const tombs: Tombstone[] = [
      { entityId: 'deleted', entityType: 'entry', deletedAt: '2026-05-15T00:00:00.000Z' },
      // Tombstone OLDER than the re-created local row — must NOT delete it.
      { entityId: 'recreated', entityType: 'entry', deletedAt: '2026-05-12T00:00:00.000Z' },
    ];
    const merged = snapshot({ entries: [], tombstones: tombs });

    await applySnapshot(merged, db, { mode: 'merge' });

    const ids = (await db.entries.toArray()).map((r) => r.id);
    expect(ids).toEqual(['recreated']);
  });

  it('respects settingsUpdatedAt: a newer local preference change survives an older snapshot', async () => {
    const localSettings: Settings = {
      ...defaultSettings(),
      theme: 'dark',
      settingsUpdatedAt: '2026-05-20T00:00:00.000Z',
    };
    await db.settings.put({ key: 'current', ...localSettings });

    const merged = snapshot({
      exportedAt: '2026-05-25T00:00:00.000Z', // whole-file newer...
      settings: {
        ...defaultSettings(),
        theme: 'light',
        settingsUpdatedAt: '2026-05-10T00:00:00.000Z', // ...but prefs older
      },
    });

    await applySnapshot(merged, db, { mode: 'merge' });

    const row = await db.settings.get('current');
    expect(row!.theme).toBe('dark'); // local pref kept despite newer exportedAt
  });

  it('takes snapshot preferences when the snapshot preference stamp is newer', async () => {
    await db.settings.put({
      key: 'current',
      ...defaultSettings(),
      theme: 'dark',
      settingsUpdatedAt: '2026-05-10T00:00:00.000Z',
    });

    const merged = snapshot({
      settings: {
        ...defaultSettings(),
        theme: 'light',
        settingsUpdatedAt: '2026-05-20T00:00:00.000Z',
      },
    });

    await applySnapshot(merged, db, { mode: 'merge' });

    const row = await db.settings.get('current');
    expect(row!.theme).toBe('light');
  });

  it('never clears: an untouched store keeps its local rows when the snapshot omits them', async () => {
    await db.payments.put({
      id: 'p1',
      cardId: 'c1',
      period: '2026-05',
      amount: 100,
      paidOn: '2026-05-15',
      note: null,
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });

    // Snapshot with no payments and no tombstones — the payment must survive.
    await applySnapshot(snapshot(), db, { mode: 'merge' });

    expect(await db.payments.count()).toBe(1);
  });
});

// S31 Task 14 (UR-31-7) — the pure lwwMerge payments/reminders cases existed,
// but the per-store `mergeRowsIntoTable` + tombstone-suppression APPLY into
// Dexie was untested for these two stores.
describe('applySnapshot — merge mode for payments & reminders (S31)', () => {
  it('a remote-newer payment wins on apply', async () => {
    await db.payments.put(payment('p1', '2026-05-10T00:00:00.000Z', { amount: 100 }));

    const merged = snapshot({
      payments: [payment('p1', '2026-05-20T00:00:00.000Z', { amount: 250 })],
    });
    await applySnapshot(merged, db, { mode: 'merge' });

    const fresh = await db.payments.get('p1');
    expect(fresh?.amount).toBe(250);
  });

  it('a local-newer reminder is preserved against a stale snapshot row', async () => {
    await db.reminders.put(reminder('r1', '2026-05-20T00:00:00.000Z', { text: 'New local text' }));

    const merged = snapshot({
      reminders: [reminder('r1', '2026-05-01T00:00:00.000Z', { text: 'Stale remote text' })],
    });
    await applySnapshot(merged, db, { mode: 'merge' });

    const fresh = await db.reminders.get('r1');
    expect(fresh?.text).toBe('New local text');
  });

  it('a winning payment tombstone deletes a live payment on apply', async () => {
    await db.payments.put(payment('p-doomed', '2026-05-10T00:00:00.000Z'));

    const merged = snapshot({
      payments: [],
      tombstones: [
        { entityId: 'p-doomed', entityType: 'payment', deletedAt: '2026-05-15T00:00:00.000Z' },
      ],
    });
    await applySnapshot(merged, db, { mode: 'merge' });

    expect(await db.payments.get('p-doomed')).toBeUndefined();
  });

  it('a winning reminder tombstone deletes a live reminder on apply', async () => {
    await db.reminders.put(reminder('r-doomed', '2026-05-10T00:00:00.000Z'));

    const merged = snapshot({
      reminders: [],
      tombstones: [
        { entityId: 'r-doomed', entityType: 'reminder', deletedAt: '2026-05-15T00:00:00.000Z' },
      ],
    });
    await applySnapshot(merged, db, { mode: 'merge' });

    expect(await db.reminders.get('r-doomed')).toBeUndefined();
  });
});
