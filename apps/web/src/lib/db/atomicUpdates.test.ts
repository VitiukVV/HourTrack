import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Card, Entry, Payment, Reminder } from '@hourtrack/shared-types';

import { HourTrackDB } from './schema';
import {
  createCard,
  createEntry,
  createPayment,
  createReminder,
  initDB,
  updateCard,
  updateEntry,
  updatePayment,
  updateReminder,
} from './queries';

/**
 * S31 Task 6 (UR-31-4) — each `update*` runs its get→merge→put in ONE `rw`
 * transaction. Two concurrent read-modify-writes to different fields of the
 * same row (the classic "sync stamp vs user edit", cross-tab or during a
 * flush) must BOTH land: a non-atomic three-transaction version let the second
 * `put` read a stale base and clobber the first — losing `googleEventId` (→
 * orphaned Calendar event) or the user's edit.
 */

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-atomic-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

function cardInput(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    name: 'Card',
    color: '#2563EB',
    defaultDurationMin: 60,
    defaultStartMinutes: 540,
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

function entryInput(cardId: string): Omit<Entry, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    cardId,
    date: '2026-07-15',
    startMinutes: 540,
    durationMin: 60,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
  };
}

describe('updateEntry — atomic concurrent stamp vs edit', () => {
  it('a concurrent sync-stamp and user-edit both survive (no lost googleEventId)', async () => {
    const card = await createCard(db, cardInput());
    const entry = await createEntry(db, entryInput(card.id));

    await Promise.all([
      // Sync layer stamps the Calendar event id + synced status.
      updateEntry(db, entry.id, { googleEventId: 'evt-123', syncStatus: 'synced' }),
      // User edits the note at the same time.
      updateEntry(db, entry.id, { note: 'edited note' }),
    ]);

    const fresh = await db.entries.get(entry.id);
    expect(fresh?.googleEventId).toBe('evt-123');
    expect(fresh?.note).toBe('edited note');
  });
});

describe('updateCard — atomic concurrent patches', () => {
  it('two concurrent patches to different fields both land', async () => {
    const card = await createCard(db, cardInput());

    await Promise.all([
      updateCard(db, card.id, { name: 'Renamed' }),
      updateCard(db, card.id, { defaultNote: 'a note' }),
    ]);

    const fresh = await db.cards.get(card.id);
    expect(fresh?.name).toBe('Renamed');
    expect(fresh?.defaultNote).toBe('a note');
  });
});

describe('updatePayment — atomic concurrent patches', () => {
  it('two concurrent patches to different fields both land', async () => {
    const card = await createCard(db, cardInput());
    const payment = await createPayment(db, {
      id: crypto.randomUUID(),
      cardId: card.id,
      period: '2026-07',
      amount: 100,
      paidOn: '2026-07-15',
      note: null,
    } satisfies Omit<Payment, 'createdAt' | 'updatedAt'>);

    await Promise.all([
      updatePayment(db, payment.id, { amount: 150 }),
      updatePayment(db, payment.id, { note: 'partial' }),
    ]);

    const fresh = await db.payments.get(payment.id);
    expect(fresh?.amount).toBe(150);
    expect(fresh?.note).toBe('partial');
  });
});

describe('updateReminder — atomic concurrent stamp vs edit', () => {
  it('a concurrent sync-stamp and user-edit both survive', async () => {
    const reminder = await createReminder(db, {
      id: crypto.randomUUID(),
      text: 'Call client',
      dueDate: '2026-08-04',
      dueMinutes: 540,
      doneAt: null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
      notifiedAt: null,
    } satisfies Omit<Reminder, 'createdAt' | 'updatedAt'>);

    await Promise.all([
      updateReminder(db, reminder.id, { googleEventId: 'evt-rem', syncStatus: 'synced' }),
      updateReminder(db, reminder.id, { text: 'Call client back' }),
    ]);

    const fresh = await db.reminders.get(reminder.id);
    expect(fresh?.googleEventId).toBe('evt-rem');
    expect(fresh?.text).toBe('Call client back');
  });
});
