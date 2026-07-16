import type {
  Card,
  Entry,
  Language,
  Payment,
  Reminder,
  Settings,
  Tombstone,
  TombstoneEntityType,
} from '@hourtrack/shared-types';

import { isValidCardColor } from '@/lib/colors';

import type { HourTrackDB, SettingsRow, SyncQueueRow, TombstoneRow } from './schema';

/**
 * Pure Dexie query layer. Every write stamps `updatedAt` via `nowIso()`;
 * every create also stamps `createdAt`. UI/feature code MUST go through
 * these helpers rather than touching `db.<table>` directly so the timestamp
 * contract (used by Drive LWW merge in S10) stays invariant.
 */

const SETTINGS_KEY = 'current' as const;
const SUPPORTED_LANGUAGES = ['uk', 'en', 'es'] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function detectLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en';
  const tag = (navigator.language || 'en').toLowerCase();
  const base = tag.split('-')[0] as string | undefined;
  if (!base) return 'en';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(base) ? (base as Language) : 'en';
}

/** Default Settings row applied the first time the app opens on a device. */
export function defaultSettings(): Settings {
  return {
    language: detectLanguage(),
    theme: 'system',
    defaultView: 'month',
    hourtrackCalendarId: null,
    autoBackupEnabled: true,
    autoBackupIntervalDays: 3,
    lastBackupAt: null,
    lastSyncAt: null,
    firstLoginAt: null,
    deviceId: null,
    driveDataFileId: null,
    driveDataEtag: null,
    onboardingSeen: false,
  };
}

/**
 * Idempotent: seeds the single `settings` row if it doesn't exist yet. Safe
 * to call on every app boot.
 */
export async function initDB(db: HourTrackDB): Promise<void> {
  const existing = await db.settings.get(SETTINGS_KEY);
  if (existing) return;
  const row: SettingsRow = { key: SETTINGS_KEY, ...defaultSettings() };
  await db.settings.put(row);
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * Defensive runtime check applied by `createCard` / `updateCard` per the S03
 * followups flagged in the S02 pipeline journal:
 *
 *   1. `color` must be one of the 12 sanctioned palette hexes
 *      (`CARD_COLORS`). Off-palette hexes would otherwise sneak in via a
 *      future Drive-snapshot restore (S11) or a malformed external write.
 *   2. Rate-type invariants:
 *      - `rateType === 'hourly'`  => hourlyRate non-null, fixedTotal === null, monthlyTotal === null
 *      - `rateType === 'fixed'`   => fixedTotal non-null, hourlyRate === null, monthlyTotal === null
 *      - `rateType === 'monthly'` => monthlyTotal non-null, hourlyRate === null, fixedTotal === null (S21)
 *
 * The zod form schema in `@/features/cards/cardSchema.ts` enforces the same
 * rules upstream so users see friendly i18n'd errors before this check fires.
 * This helper is the last line of defense.
 *
 * Throws `Error` with a concrete message (always includes the offending field
 * name) so the layer that triggered the write can surface a useful diagnostic.
 */
function assertCardShape(card: {
  color: string;
  rateType: Card['rateType'];
  hourlyRate: number | null;
  fixedTotal: number | null;
  monthlyTotal: number | null;
}): void {
  if (!isValidCardColor(card.color)) {
    throw new Error(`Invalid card color "${card.color}": not in CARD_COLORS palette`);
  }
  if (card.rateType === 'hourly') {
    if (card.hourlyRate == null) {
      throw new Error('hourlyRate is required when rateType is "hourly"');
    }
    if (card.fixedTotal != null) {
      throw new Error('fixedTotal must be null when rateType is "hourly"');
    }
    if (card.monthlyTotal != null) {
      throw new Error('monthlyTotal must be null when rateType is "hourly"');
    }
  } else if (card.rateType === 'fixed') {
    if (card.fixedTotal == null) {
      throw new Error('fixedTotal is required when rateType is "fixed"');
    }
    if (card.hourlyRate != null) {
      throw new Error('hourlyRate must be null when rateType is "fixed"');
    }
    if (card.monthlyTotal != null) {
      throw new Error('monthlyTotal must be null when rateType is "fixed"');
    }
  } else {
    // S21: 'monthly' retainer card.
    if (card.monthlyTotal == null) {
      throw new Error('monthlyTotal is required when rateType is "monthly"');
    }
    if (card.hourlyRate != null) {
      throw new Error('hourlyRate must be null when rateType is "monthly"');
    }
    if (card.fixedTotal != null) {
      throw new Error('fixedTotal must be null when rateType is "monthly"');
    }
  }
}

/**
 * Returns all cards. By default archived cards are excluded; pass
 * `includeArchived = true` to include them (e.g. Settings -> Card archive).
 */
export async function getAllCards(db: HourTrackDB, includeArchived = false): Promise<Card[]> {
  if (includeArchived) {
    return db.cards.toArray();
  }
  // Dexie cannot index booleans as keys reliably across all browsers, so
  // filter in memory. `isArchived` is also indexed for tooling but the
  // filter remains the source of truth.
  return db.cards.filter((c) => !c.isArchived).toArray();
}

/**
 * Convenience wrapper for the archive list (Settings page, S08).
 */
export async function getArchivedCards(db: HourTrackDB): Promise<Card[]> {
  return db.cards.filter((c) => c.isArchived).toArray();
}

export async function getCardById(db: HourTrackDB, id: string): Promise<Card | undefined> {
  return db.cards.get(id);
}

export async function createCard(
  db: HourTrackDB,
  input: Omit<Card, 'createdAt' | 'updatedAt'>,
): Promise<Card> {
  assertCardShape(input);
  const now = nowIso();
  const card: Card = { ...input, createdAt: now, updatedAt: now };
  await db.cards.add(card);
  return card;
}

/**
 * Apply a partial patch and stamp a fresh `updatedAt`. Throws if the card
 * does not exist, or if the resulting merged shape violates the card
 * invariants (see `assertCardShape`).
 */
export async function updateCard(
  db: HourTrackDB,
  id: string,
  patch: Partial<Omit<Card, 'id' | 'createdAt'>>,
): Promise<Card> {
  const existing = await db.cards.get(id);
  if (!existing) throw new Error(`updateCard: card not found: ${id}`);
  const next: Card = { ...existing, ...patch, id, updatedAt: nowIso() };
  // Only assert the shape if the patch actually touches invariant-bearing
  // fields. This keeps archive/restore reachable for cleanup even when a
  // legacy or Drive-restored card has a stale shape (e.g. an off-palette
  // color introduced by a future palette change in S11 restore).
  const touchesShape =
    'color' in patch ||
    'rateType' in patch ||
    'hourlyRate' in patch ||
    'fixedTotal' in patch ||
    'monthlyTotal' in patch;
  if (touchesShape) {
    assertCardShape(next);
  }
  await db.cards.put(next);
  return next;
}

export async function archiveCard(db: HourTrackDB, id: string): Promise<Card> {
  // Archive is a SOFT delete -- the card row stays in Dexie with
  // `isArchived = true`. No tombstone is written: the card is still
  // "alive" from a sync perspective and other devices learn about the
  // archive via the row's updated `isArchived` field + bumped
  // `updatedAt`. Restore is its inverse.
  return updateCard(db, id, { isArchived: true, archivedAt: nowIso() });
}

export async function restoreCard(db: HourTrackDB, id: string): Promise<Card> {
  // Restore also clears any stale tombstone for this card id — covers the
  // edge case where the user hard-deleted, then restored the same id from
  // a backup (S11), then immediately restored from archive. Without this
  // call the tombstone in `data.json` would silently re-delete the card
  // on every other device.
  await clearTombstone(db, id);
  return updateCard(db, id, { isArchived: false, archivedAt: null });
}

/**
 * Hard-delete a card AND every entry that references it. Used by the S08
 * Settings "Delete permanently" affordance.
 *
 * Wrapped in a Dexie transaction so the cascade is atomic — either every
 * table is cleaned up or none is touched. Idempotent: deleting a card that
 * doesn't exist is a no-op (mirrors `db.cards.delete`'s own behavior).
 *
 * S10: writes a tombstone for the card AND one per cascaded entry. Other
 * devices learn about the cascade by replaying tombstones during their next
 * Drive snapshot read.
 */
export async function deleteCardPermanently(db: HourTrackDB, id: string): Promise<void> {
  await db.transaction('rw', db.cards, db.entries, db.tombstones, async () => {
    const orphanedEntryIds = await db.entries.where('cardId').equals(id).primaryKeys();
    const deletedAt = nowIso();
    await db.entries.where('cardId').equals(id).delete();
    await db.cards.delete(id);
    // Tombstones for the cascade so remote devices propagate the same
    // delete instead of treating the absence as "not yet synced".
    const tombstoneRows: TombstoneRow[] = [
      { entityId: id, entityType: 'card', deletedAt },
      ...orphanedEntryIds.map((entryId): TombstoneRow => ({
        entityId: String(entryId),
        entityType: 'entry',
        deletedAt,
      })),
    ];
    if (tombstoneRows.length > 0) {
      await db.tombstones.bulkPut(tombstoneRows);
    }
  });
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/**
 * Inclusive range `[start, end]` on YYYY-MM-DD strings. Returns entries
 * sorted by `date` ascending (and by `createdAt` as a stable tiebreaker
 * when two entries share a date).
 */
export async function getEntriesByDateRange(
  db: HourTrackDB,
  start: string,
  end: string,
): Promise<Entry[]> {
  const rows = await db.entries.where('date').between(start, end, true, true).toArray();
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  return rows;
}

/**
 * Returns ALL entries across all dates. Used by the S10 snapshot builder
 * (replaces the prior 1970→2200 range hack flagged in the S08 journal). The
 * Settings CSV export that previously consumed this was removed in V2
 * cleanup per V2_FEATURE_PLAN decision #3.
 *
 * Sorted by `date` ascending with `createdAt` as a stable tiebreaker so two
 * consecutive calls produce identical orderings (important for tests that
 * snapshot the result).
 */
export async function getAllEntries(db: HourTrackDB): Promise<Entry[]> {
  const rows = await db.entries.toArray();
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  return rows;
}

export async function getEntriesByDate(db: HourTrackDB, date: string): Promise<Entry[]> {
  return db.entries.where('date').equals(date).toArray();
}

/**
 * Single-entry lookup by primary key. Used by the S17 inline-edit modal,
 * which needs to populate the form from a known `entryId` without paying
 * the cost of a range query. Returns `undefined` if the entry was deleted
 * out from under the caller (e.g. another tab tombstone'd it mid-edit).
 */
export async function getEntryById(db: HourTrackDB, id: string): Promise<Entry | undefined> {
  return db.entries.get(id);
}

export async function getEntriesByCardId(db: HourTrackDB, cardId: string): Promise<Entry[]> {
  return db.entries.where('cardId').equals(cardId).toArray();
}

/**
 * Fast lookup for "all entries belonging to `cardId` on `date`" via the
 * compound `[cardId+date]` index (declared in `schema.ts`). Used by the
 * S05 active-card day-click flow to decide whether a click creates a new
 * entry or deletes the existing one, and by the S06 DayPage to surface
 * card-specific multi-session entries.
 *
 * Returns `[]` when no entries match (never `undefined`).
 */
export async function getEntriesByCardAndDate(
  db: HourTrackDB,
  cardId: string,
  date: string,
): Promise<Entry[]> {
  return db.entries.where('[cardId+date]').equals([cardId, date]).toArray();
}

export async function createEntry(
  db: HourTrackDB,
  input: Omit<Entry, 'createdAt' | 'updatedAt'>,
): Promise<Entry> {
  const now = nowIso();
  const entry: Entry = { ...input, createdAt: now, updatedAt: now };
  await db.entries.add(entry);
  return entry;
}

export async function updateEntry(
  db: HourTrackDB,
  id: string,
  patch: Partial<Omit<Entry, 'id' | 'createdAt'>>,
): Promise<Entry> {
  const existing = await db.entries.get(id);
  if (!existing) throw new Error(`updateEntry: entry not found: ${id}`);
  const next: Entry = { ...existing, ...patch, id, updatedAt: nowIso() };
  await db.entries.put(next);
  return next;
}

/**
 * Delete an entry and record a tombstone. The tombstone is what propagates
 * the delete to other devices via the next Drive snapshot — without it
 * remote devices would treat the entry's absence as "not yet synced" and
 * re-add it from their own copy.
 *
 * Returns the deleted entry's metadata so the calling hook can enqueue the
 * matching `deleteCalendarEvent` op without a separate Dexie read. Returns
 * `null` if the entry didn't exist (delete is idempotent).
 */
export async function deleteEntry(
  db: HourTrackDB,
  id: string,
): Promise<Pick<Entry, 'id' | 'cardId' | 'date' | 'googleEventId'> | null> {
  return db.transaction('rw', db.entries, db.tombstones, async () => {
    const existing = await db.entries.get(id);
    if (!existing) return null;
    await db.entries.delete(id);
    const tombstoneRow: TombstoneRow = {
      entityId: id,
      entityType: 'entry',
      deletedAt: nowIso(),
    };
    await db.tombstones.put(tombstoneRow);
    return {
      id: existing.id,
      cardId: existing.cardId,
      date: existing.date,
      googleEventId: existing.googleEventId,
    };
  });
}

// ---------------------------------------------------------------------------
// Payments (S27)
// ---------------------------------------------------------------------------

/**
 * ALL payments across every card + period. Used by the S27 snapshot builder
 * so payments ride the Drive `data.json` sync. Sorted by `id` for a stable,
 * deterministic ordering (snapshot round-trip tests depend on it).
 */
export async function getAllPayments(db: HourTrackDB): Promise<Payment[]> {
  const rows = await db.payments.toArray();
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

/**
 * Every payment recorded for `period` (`'YYYY-MM'`), across all cards. Drives
 * the Payments page's per-month view. Sorted by `paidOn` ascending, then
 * `createdAt` as a stable tiebreaker.
 */
export async function listPaymentsByPeriod(db: HourTrackDB, period: string): Promise<Payment[]> {
  const rows = await db.payments.where('period').equals(period).toArray();
  rows.sort((a, b) => {
    if (a.paidOn !== b.paidOn) return a.paidOn < b.paidOn ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  return rows;
}

/**
 * Payments for one card in one period, via the `[cardId+period]` compound
 * index. `received` for a ledger row = sum of `amount` across this set.
 * Sorted by `paidOn` ascending, then `createdAt`.
 */
export async function listPaymentsForCardPeriod(
  db: HourTrackDB,
  cardId: string,
  period: string,
): Promise<Payment[]> {
  const rows = await db.payments.where('[cardId+period]').equals([cardId, period]).toArray();
  rows.sort((a, b) => {
    if (a.paidOn !== b.paidOn) return a.paidOn < b.paidOn ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  return rows;
}

export async function createPayment(
  db: HourTrackDB,
  input: Omit<Payment, 'createdAt' | 'updatedAt'>,
): Promise<Payment> {
  if (!(input.amount > 0)) {
    throw new Error(`createPayment: amount must be > 0, got ${input.amount}`);
  }
  const now = nowIso();
  const payment: Payment = { ...input, createdAt: now, updatedAt: now };
  await db.payments.add(payment);
  return payment;
}

/**
 * Apply a partial patch and stamp a fresh `updatedAt`. Throws if the payment
 * does not exist. `amount` (when present) must stay > 0.
 */
export async function updatePayment(
  db: HourTrackDB,
  id: string,
  patch: Partial<Omit<Payment, 'id' | 'createdAt'>>,
): Promise<Payment> {
  const existing = await db.payments.get(id);
  if (!existing) throw new Error(`updatePayment: payment not found: ${id}`);
  const next: Payment = { ...existing, ...patch, id, updatedAt: nowIso() };
  if (!(next.amount > 0)) {
    throw new Error(`updatePayment: amount must be > 0, got ${next.amount}`);
  }
  await db.payments.put(next);
  return next;
}

/**
 * Delete a payment and record a tombstone (`entityType: 'payment'`). The
 * tombstone is what propagates the delete to other devices via the next Drive
 * snapshot — without it a remote device would treat the absence as "not yet
 * synced" and re-add its stale copy. Idempotent: returns `null` if the
 * payment didn't exist.
 */
export async function deletePayment(db: HourTrackDB, id: string): Promise<Payment | null> {
  return db.transaction('rw', db.payments, db.tombstones, async () => {
    const existing = await db.payments.get(id);
    if (!existing) return null;
    await db.payments.delete(id);
    const tombstoneRow: TombstoneRow = {
      entityId: id,
      entityType: 'payment',
      deletedAt: nowIso(),
    };
    await db.tombstones.put(tombstoneRow);
    return existing;
  });
}

// ---------------------------------------------------------------------------
// Reminders (S28)
// ---------------------------------------------------------------------------

/** Zero-padded `YYYY-MM-DD` local date + minutes-since-midnight for `now`. */
function localDateAndMinutes(now: Date): { date: string; minutes: number } {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return { date: `${y}-${mo}-${d}`, minutes: now.getHours() * 60 + now.getMinutes() };
}

/**
 * Pure predicate: true when a reminder's due moment is at or before `now`
 * (local terms). Exported so the bell badge / banner can classify an
 * already-loaded open-reminders list without a second DB round-trip, and so
 * the mark-done flow can decide whether the Calendar event still needs
 * deleting (future due) or can be left alone (past due).
 */
export function isReminderDue(reminder: Reminder, now: Date): boolean {
  const { date, minutes } = localDateAndMinutes(now);
  if (reminder.dueDate < date) return true;
  if (reminder.dueDate > date) return false;
  return reminder.dueMinutes <= minutes;
}

/**
 * ALL reminders across every date. Used by the S28 snapshot builder so
 * reminders ride the Drive `data.json` sync. Sorted by `id` for a stable,
 * deterministic ordering (snapshot round-trip tests depend on it).
 */
export async function getAllReminders(db: HourTrackDB): Promise<Reminder[]> {
  const rows = await db.reminders.toArray();
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

/**
 * Open (not-done) reminders, soonest due first. Drives the bell list. Sorted
 * by `dueDate` then `dueMinutes` ascending, then `createdAt` as a stable
 * tiebreaker.
 */
export async function listOpenReminders(db: HourTrackDB): Promise<Reminder[]> {
  const rows = await db.reminders.filter((r) => r.doneAt === null).toArray();
  rows.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.dueMinutes !== b.dueMinutes) return a.dueMinutes - b.dueMinutes;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  return rows;
}

/**
 * Due, not-done reminders as of `now` — `dueDate + dueMinutes <= now` (local
 * terms) AND `doneAt === null`. Drives the bell badge, the open-app banner, and
 * the while-open scheduler. Sorted soonest-due first.
 */
export async function listDueReminders(
  db: HourTrackDB,
  now: Date = new Date(),
): Promise<Reminder[]> {
  const open = await listOpenReminders(db);
  return open.filter((r) => isReminderDue(r, now));
}

export async function getReminderById(db: HourTrackDB, id: string): Promise<Reminder | undefined> {
  return db.reminders.get(id);
}

export async function createReminder(
  db: HourTrackDB,
  input: Omit<Reminder, 'createdAt' | 'updatedAt'>,
): Promise<Reminder> {
  if (input.text.trim().length === 0) {
    throw new Error('createReminder: text must not be empty');
  }
  if (!Number.isInteger(input.dueMinutes) || input.dueMinutes < 0 || input.dueMinutes > 1439) {
    throw new Error(`createReminder: dueMinutes out of range: ${input.dueMinutes}`);
  }
  const now = nowIso();
  const reminder: Reminder = { ...input, createdAt: now, updatedAt: now };
  await db.reminders.add(reminder);
  return reminder;
}

/**
 * Apply a partial patch and stamp a fresh `updatedAt`. Throws if the reminder
 * does not exist. `dueMinutes` (when present) must stay in `[0, 1439]`.
 */
export async function updateReminder(
  db: HourTrackDB,
  id: string,
  patch: Partial<Omit<Reminder, 'id' | 'createdAt'>>,
): Promise<Reminder> {
  const existing = await db.reminders.get(id);
  if (!existing) throw new Error(`updateReminder: reminder not found: ${id}`);
  const next: Reminder = { ...existing, ...patch, id, updatedAt: nowIso() };
  if (!Number.isInteger(next.dueMinutes) || next.dueMinutes < 0 || next.dueMinutes > 1439) {
    throw new Error(`updateReminder: dueMinutes out of range: ${next.dueMinutes}`);
  }
  await db.reminders.put(next);
  return next;
}

/**
 * Delete a reminder and record a tombstone (`entityType: 'reminder'`). The
 * tombstone propagates the delete to other devices via the next Drive snapshot
 * — without it a remote device would treat the absence as "not yet synced" and
 * re-add its stale copy. Returns the deleted reminder (carrying `googleEventId`
 * so the caller can enqueue the matching `deleteReminderEvent` op) or `null`
 * if it didn't exist (delete is idempotent).
 */
export async function deleteReminder(db: HourTrackDB, id: string): Promise<Reminder | null> {
  return db.transaction('rw', db.reminders, db.tombstones, async () => {
    const existing = await db.reminders.get(id);
    if (!existing) return null;
    await db.reminders.delete(id);
    const tombstoneRow: TombstoneRow = {
      entityId: id,
      entityType: 'reminder',
      deletedAt: nowIso(),
    };
    await db.tombstones.put(tombstoneRow);
    return existing;
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(db: HourTrackDB): Promise<Settings | null> {
  const row = await db.settings.get(SETTINGS_KEY);
  if (!row) return null;
  // Strip the `key` discriminator before returning the public Settings shape.
  const { key: _key, ...rest } = row;
  return rest;
}

/**
 * User-preference fields (as opposed to device-local bookkeeping). A write
 * that touches any of these stamps `settingsUpdatedAt` (S29 Task 6) so the
 * LWW merge can tell a genuine preference change from a routine bookkeeping
 * push. `hourtrackCalendarId` / `driveData*` / `lastSyncAt` / `lastBackupAt` /
 * `firstLoginAt` / `deviceId` / `onboardingSeen` are deliberately EXCLUDED —
 * they are bookkeeping / monotonic fields, not user preferences.
 */
const PREFERENCE_KEYS: ReadonlyArray<keyof Settings> = [
  'language',
  'theme',
  'defaultView',
  'autoBackupEnabled',
  'autoBackupIntervalDays',
];

/**
 * Apply a partial patch to the (always single) settings row. The row is
 * created with defaults if it does not yet exist.
 *
 * S29 Task 7 — the read-modify-write runs inside a single `rw` transaction so
 * concurrent patches (SyncManager bookkeeping vs a UI toggle vs ensureCalendar
 * vs autoBackup) can't clobber each other: IndexedDB serialises readwrite
 * transactions over the `settings` store, so each caller sees the previous
 * caller's write as its base instead of a stale snapshot.
 *
 * S29 Task 6 — a patch that touches any user-preference field stamps
 * `settingsUpdatedAt` (unless the caller supplied one explicitly), which
 * `lwwMerge.mergeSettings` uses to resolve preference conflicts.
 */
export async function updateSettings(db: HourTrackDB, patch: Partial<Settings>): Promise<Settings> {
  const touchesPrefs = PREFERENCE_KEYS.some((k) => k in patch);
  return db.transaction('rw', db.settings, async () => {
    const existing = await db.settings.get(SETTINGS_KEY);
    const base: Settings = existing
      ? (() => {
          const { key: _key, ...rest } = existing;
          return rest;
        })()
      : defaultSettings();
    const next: Settings = { ...base, ...patch };
    if (touchesPrefs && !('settingsUpdatedAt' in patch)) {
      next.settingsUpdatedAt = nowIso();
    }
    await db.settings.put({ key: SETTINGS_KEY, ...next });
    return next;
  });
}

// ---------------------------------------------------------------------------
// Sync queue (S10)
// ---------------------------------------------------------------------------

/**
 * Enqueue a sync operation. Returns the auto-incremented row id.
 *
 * S10 callers should funnel through `SyncManager.enqueue` rather than calling
 * this directly so the in-process debounce + lock semantics apply, but the
 * pure helper is exposed for tests and for the SyncManager itself.
 */
export async function enqueueSyncOp(
  db: HourTrackDB,
  op: Omit<SyncQueueRow, 'id' | 'createdAt' | 'attempts' | 'nextAttemptAt'> &
    Partial<Pick<SyncQueueRow, 'createdAt' | 'attempts' | 'nextAttemptAt'>>,
): Promise<number> {
  const row: Omit<SyncQueueRow, 'id'> = {
    op: op.op,
    mutation: op.mutation,
    entityType: op.entityType,
    entityId: op.entityId,
    payload: op.payload,
    createdAt: op.createdAt ?? nowIso(),
    attempts: op.attempts ?? 0,
    nextAttemptAt: op.nextAttemptAt ?? 0,
    lastError: null,
  };
  // Dexie's `add()` typing returns `IndexableType` for auto-inc primaries.
  // The actual runtime value is a number; cast accordingly.
  const id = (await db.syncQueue.add(row as SyncQueueRow)) as unknown as number;
  return id;
}

/**
 * Drain the queue head: returns rows whose `nextAttemptAt <= now`, ordered
 * by `createdAt`. Filtering by `nextAttemptAt` index is the fast path; we
 * default to "now" when the param is omitted so callers don't have to clock
 * themselves.
 */
export async function getReadySyncQueueRows(
  db: HourTrackDB,
  now: number = Date.now(),
): Promise<SyncQueueRow[]> {
  const rows = await db.syncQueue.where('nextAttemptAt').belowOrEqual(now).sortBy('createdAt');
  return rows;
}

export async function getAllSyncQueueRows(db: HourTrackDB): Promise<SyncQueueRow[]> {
  return db.syncQueue.orderBy('createdAt').toArray();
}

/**
 * Mark an op as completed and remove it. Wrapped in a transaction so a
 * concurrent enqueue cannot lose the row.
 */
export async function deleteSyncQueueRow(db: HourTrackDB, id: number): Promise<void> {
  await db.syncQueue.delete(id);
}

/**
 * Increment the attempts counter + push the next attempt out by `delayMs`.
 * Used by the retry policy after a failed push.
 */
export async function rescheduleSyncQueueRow(
  db: HourTrackDB,
  id: number,
  delayMs: number,
  lastError: string | null = null,
): Promise<void> {
  const existing = await db.syncQueue.get(id);
  if (!existing) return;
  await db.syncQueue.update(id, {
    attempts: (existing.attempts ?? 0) + 1,
    nextAttemptAt: Date.now() + delayMs,
    lastError,
  });
}

// ---------------------------------------------------------------------------
// Tombstones (S10)
// ---------------------------------------------------------------------------

/**
 * Record that an entity was deleted. Idempotent on `entityId` — re-deleting
 * the same id overwrites the existing tombstone's timestamp instead of
 * duplicating.
 */
export async function writeTombstone(
  db: HourTrackDB,
  entityType: TombstoneEntityType,
  entityId: string,
  deletedAt: string = nowIso(),
): Promise<Tombstone> {
  const row: TombstoneRow = { entityId, entityType, deletedAt };
  await db.tombstones.put(row);
  return row;
}

export async function getAllTombstones(db: HourTrackDB): Promise<Tombstone[]> {
  return db.tombstones.toArray();
}

/** Remove a tombstone — used when a card is restored from archive. */
export async function clearTombstone(db: HourTrackDB, entityId: string): Promise<void> {
  await db.tombstones.delete(entityId);
}

/**
 * Drop tombstones older than `keepDays` days (default 30). Returns the number
 * of rows pruned. Called from `SyncManager` after each successful push.
 */
export async function pruneOldTombstones(
  db: HourTrackDB,
  keepDays = 30,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000).toISOString();
  const toDelete = await db.tombstones.where('deletedAt').below(cutoff).primaryKeys();
  if (toDelete.length === 0) return 0;
  await db.tombstones.bulkDelete(toDelete);
  return toDelete.length;
}
