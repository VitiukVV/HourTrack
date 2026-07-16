import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Card, Entry, Tombstone } from '@hourtrack/shared-types';

import { HourTrackDB } from '@/lib/db/schema';
import {
  createCard,
  createEntry,
  getAllCards,
  getAllEntries,
  getAllTombstones,
  getSettings,
  initDB,
  updateSettings,
  writeTombstone,
} from '@/lib/db/queries';

import { applySnapshot, buildSnapshot } from './snapshot';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-snap-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

function newCard(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    name: 'Card',
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
    date: '2026-05-14',
    startMinutes: 600,
    durationMin: 240,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    ...overrides,
  };
}

describe('buildSnapshot', () => {
  it('captures all cards (incl. archived), entries, and tombstones', async () => {
    const c1 = await createCard(db, newCard({ name: 'Active' }));
    const c2 = await createCard(
      db,
      newCard({ name: 'Archived', isArchived: true, archivedAt: new Date().toISOString() }),
    );
    await createEntry(db, newEntry(c1.id));
    await writeTombstone(db, 'entry', 'gone-entry');

    const snap = await buildSnapshot(db);
    expect(snap.cards.map((c) => c.id).sort()).toEqual([c1.id, c2.id].sort());
    expect(snap.entries).toHaveLength(1);
    expect(snap.tombstones?.[0]?.entityId).toBe('gone-entry');
    // S27: writer always emits schemaVersion 4 going forward (DriveSnapshot
    // bumped in lockstep with the payments store). v2/v3 snapshots still
    // restore cleanly via validateSnapshot's in-band upgrade chain.
    expect(snap.schemaVersion).toBe(4);
    expect(snap.deviceId).toBeTruthy();
    expect(snap.exportedAt).toBeTruthy();
  });

  it('persists the deviceId so consecutive builds return the same id', async () => {
    const snap1 = await buildSnapshot(db);
    const snap2 = await buildSnapshot(db);
    expect(snap1.deviceId).toBe(snap2.deviceId);
  });
});

describe('applySnapshot', () => {
  it('overwrites local rows with the snapshot contents but preserves device-local Settings', async () => {
    // Pre-seed local state.
    const localCard = await createCard(db, newCard({ name: 'Will-be-replaced' }));
    await updateSettings(db, {
      deviceId: 'local-device',
      driveDataFileId: 'local-file',
      driveDataEtag: 'local-etag',
    });

    const incomingTomb: Tombstone = {
      entityId: 'gone',
      entityType: 'entry',
      deletedAt: '2026-05-13T00:00:00.000Z',
    };
    const incoming = {
      schemaVersion: 2 as const,
      exportedAt: '2026-05-15T00:00:00.000Z',
      deviceId: 'remote-device',
      settings: {
        language: 'es' as const,
        theme: 'dark' as const,
        defaultView: 'week' as const,
        hourtrackCalendarId: null,
        autoBackupEnabled: false,
        autoBackupIntervalDays: 7,
        lastBackupAt: null,
        lastSyncAt: '2026-05-15T00:00:00.000Z',
        firstLoginAt: null,
        deviceId: 'remote-device',
        driveDataFileId: 'remote-file',
        driveDataEtag: 'remote-etag',
        onboardingSeen: false,
      },
      cards: [
        {
          id: 'fresh-card',
          name: 'From snapshot',
          color: '#16A34A',
          defaultDurationMin: 360,
          defaultStartMinutes: 540,
          rateType: 'fixed' as const,
          hourlyRate: null,
          fixedTotal: 500,
          monthlyTotal: null,
          defaultNote: null,
          isArchived: false,
          archivedAt: null,
          createdAt: '2026-05-12T00:00:00.000Z',
          updatedAt: '2026-05-14T00:00:00.000Z',
        },
      ],
      entries: [],
      tombstones: [incomingTomb],
    };

    const result = await applySnapshot(incoming, db);
    expect(result.cards).toBe(1);

    const cards = await getAllCards(db, true);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.id).toBe('fresh-card');
    expect(cards.find((c) => c.id === localCard.id)).toBeUndefined();

    const tombs = await getAllTombstones(db);
    expect(tombs).toEqual([incomingTomb]);

    const entries = await getAllEntries(db);
    expect(entries).toHaveLength(0);

    const settings = await getSettings(db);
    // User prefs were taken from the incoming snapshot.
    expect(settings?.theme).toBe('dark');
    expect(settings?.defaultView).toBe('week');
    expect(settings?.lastSyncAt).toBe('2026-05-15T00:00:00.000Z');
    // Device-local fields were kept from the existing local row.
    expect(settings?.deviceId).toBe('local-device');
    expect(settings?.driveDataFileId).toBe('local-file');
    expect(settings?.driveDataEtag).toBe('local-etag');
  });
});
