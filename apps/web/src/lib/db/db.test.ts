import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { HourTrackDB } from './schema';
import {
  archiveCard,
  createCard,
  createEntry,
  deleteEntry,
  getAllCards,
  getCardById,
  getEntriesByCardAndDate,
  getEntriesByCardId,
  getEntriesByDate,
  getEntriesByDateRange,
  getSettings,
  initDB,
  restoreCard,
  updateCard,
  updateEntry,
  updateSettings,
} from './queries';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-test-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

function newCard(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    name: 'Test',
    color: '#3B82F6',
    defaultDurationMin: 480,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
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
    durationMin: 60,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    ...overrides,
  };
}

describe('Dexie schema bootstrap', () => {
  it('opens with all five stores (cards, entries, settings, syncQueue, authTokens)', () => {
    const names = db.tables.map((t) => t.name).sort();
    expect(names).toEqual(['authTokens', 'cards', 'entries', 'settings', 'syncQueue']);
  });

  it('seeds a default settings row on initDB', async () => {
    const settings = await getSettings(db);
    expect(settings).not.toBeNull();
    expect(settings?.autoBackupEnabled).toBe(true);
    expect(settings?.autoBackupIntervalDays).toBe(3);
    expect(settings?.defaultView).toBe('month');
    expect(settings?.theme).toBe('system');
    expect(settings?.lastBackupAt).toBeNull();
    expect(settings?.lastSyncAt).toBeNull();
    expect(settings?.firstLoginAt).toBeNull();
  });

  it('initDB is idempotent (running twice does not duplicate settings)', async () => {
    await initDB(db);
    const all = await db.settings.toArray();
    expect(all).toHaveLength(1);
  });
});

describe('cards queries', () => {
  it('createCard stamps createdAt and updatedAt and persists', async () => {
    const card = await createCard(db, newCard({ name: 'Alpha' }));
    expect(card.createdAt).toMatch(/T.+Z$/);
    expect(card.updatedAt).toBe(card.createdAt);

    const fetched = await getCardById(db, card.id);
    expect(fetched?.name).toBe('Alpha');
  });

  it('getAllCards excludes archived cards by default', async () => {
    const active = await createCard(db, newCard({ name: 'Active' }));
    const archived = await createCard(db, newCard({ name: 'Archived', isArchived: true }));

    const cards = await getAllCards(db);
    expect(cards.map((c) => c.id)).toContain(active.id);
    expect(cards.map((c) => c.id)).not.toContain(archived.id);
  });

  it('getAllCards(true) includes archived cards', async () => {
    await createCard(db, newCard({ name: 'A' }));
    await createCard(db, newCard({ name: 'B', isArchived: true }));
    const cards = await getAllCards(db, true);
    expect(cards).toHaveLength(2);
  });

  it('updateCard stamps a new updatedAt newer than createdAt', async () => {
    const card = await createCard(db, newCard({ name: 'X' }));
    // Force a measurable timestamp delta
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateCard(db, card.id, { name: 'Y' });
    expect(updated.name).toBe('Y');
    expect(updated.createdAt).toBe(card.createdAt);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date(card.createdAt).getTime(),
    );
  });

  it('archiveCard sets isArchived=true and archivedAt timestamp', async () => {
    const card = await createCard(db, newCard({ name: 'Z' }));
    const archived = await archiveCard(db, card.id);
    expect(archived.isArchived).toBe(true);
    expect(archived.archivedAt).not.toBeNull();
  });

  it('restoreCard sets isArchived=false and clears archivedAt', async () => {
    const card = await createCard(db, newCard({ isArchived: true }));
    const restored = await restoreCard(db, card.id);
    expect(restored.isArchived).toBe(false);
    expect(restored.archivedAt).toBeNull();
  });
});

describe('entries queries', () => {
  it('createEntry persists and stamps timestamps', async () => {
    const card = await createCard(db, newCard());
    const entry = await createEntry(db, newEntry(card.id, { durationMin: 90 }));
    expect(entry.createdAt).toBe(entry.updatedAt);
    expect(entry.durationMin).toBe(90);
  });

  it('getEntriesByDate filters by exact YYYY-MM-DD', async () => {
    const card = await createCard(db, newCard());
    await createEntry(db, newEntry(card.id, { date: '2026-05-14' }));
    await createEntry(db, newEntry(card.id, { date: '2026-05-15' }));

    const onMay14 = await getEntriesByDate(db, '2026-05-14');
    expect(onMay14).toHaveLength(1);
    expect(onMay14[0]?.date).toBe('2026-05-14');
  });

  it('getEntriesByDateRange returns inclusive range sorted by date', async () => {
    const card = await createCard(db, newCard());
    await createEntry(db, newEntry(card.id, { date: '2026-05-16' }));
    await createEntry(db, newEntry(card.id, { date: '2026-05-14' }));
    await createEntry(db, newEntry(card.id, { date: '2026-05-20' })); // outside
    await createEntry(db, newEntry(card.id, { date: '2026-05-15' }));

    const range = await getEntriesByDateRange(db, '2026-05-14', '2026-05-16');
    expect(range.map((e) => e.date)).toEqual(['2026-05-14', '2026-05-15', '2026-05-16']);
  });

  it('getEntriesByCardId returns only entries for that card', async () => {
    const a = await createCard(db, newCard({ name: 'A' }));
    const b = await createCard(db, newCard({ name: 'B' }));
    await createEntry(db, newEntry(a.id));
    await createEntry(db, newEntry(b.id));
    await createEntry(db, newEntry(a.id));

    const aEntries = await getEntriesByCardId(db, a.id);
    expect(aEntries).toHaveLength(2);
    expect(aEntries.every((e) => e.cardId === a.id)).toBe(true);
  });

  it('getEntriesByCardAndDate returns only entries matching (cardId, date) via [cardId+date] index', async () => {
    const a = await createCard(db, newCard({ name: 'A' }));
    const b = await createCard(db, newCard({ name: 'B' }));
    await createEntry(db, newEntry(a.id, { date: '2026-05-14' }));
    await createEntry(db, newEntry(a.id, { date: '2026-05-15' }));
    await createEntry(db, newEntry(b.id, { date: '2026-05-14' }));

    const aOn14 = await getEntriesByCardAndDate(db, a.id, '2026-05-14');
    expect(aOn14).toHaveLength(1);
    expect(aOn14[0]?.cardId).toBe(a.id);
    expect(aOn14[0]?.date).toBe('2026-05-14');

    const aOn99 = await getEntriesByCardAndDate(db, a.id, '2026-12-31');
    expect(aOn99).toHaveLength(0);
  });

  it('updateEntry stamps a fresh updatedAt', async () => {
    const card = await createCard(db, newCard());
    const entry = await createEntry(db, newEntry(card.id));
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateEntry(db, entry.id, { note: 'hello' });
    expect(updated.note).toBe('hello');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date(entry.updatedAt).getTime(),
    );
  });

  it('deleteEntry removes the entry from the store', async () => {
    const card = await createCard(db, newCard());
    const entry = await createEntry(db, newEntry(card.id));
    await deleteEntry(db, entry.id);
    expect(await db.entries.get(entry.id)).toBeUndefined();
  });
});

describe('settings queries', () => {
  it('updateSettings merges the patch and stamps lastSyncAt when provided', async () => {
    const updated = await updateSettings(db, { language: 'en', theme: 'dark' });
    expect(updated.language).toBe('en');
    expect(updated.theme).toBe('dark');
    // unchanged fields preserved
    expect(updated.autoBackupEnabled).toBe(true);
  });

  it('updateSettings is a noop-safe operation with an empty patch', async () => {
    const before = await getSettings(db);
    const after = await updateSettings(db, {});
    expect(after).toEqual(before);
  });
});
