import type { Card, Entry, Language, Settings } from '@hourtrack/shared-types';

import { isValidCardColor } from '@/lib/colors';

import type { HourTrackDB, SettingsRow } from './schema';

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
 *      - `rateType === 'hourly'` => `hourlyRate` non-null, `fixedTotal === null`
 *      - `rateType === 'fixed'`  => `fixedTotal` non-null, `hourlyRate === null`
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
  } else {
    if (card.fixedTotal == null) {
      throw new Error('fixedTotal is required when rateType is "fixed"');
    }
    if (card.hourlyRate != null) {
      throw new Error('hourlyRate must be null when rateType is "fixed"');
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
  assertCardShape(next);
  await db.cards.put(next);
  return next;
}

export async function archiveCard(db: HourTrackDB, id: string): Promise<Card> {
  return updateCard(db, id, { isArchived: true, archivedAt: nowIso() });
}

export async function restoreCard(db: HourTrackDB, id: string): Promise<Card> {
  return updateCard(db, id, { isArchived: false, archivedAt: null });
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

export async function getEntriesByDate(db: HourTrackDB, date: string): Promise<Entry[]> {
  return db.entries.where('date').equals(date).toArray();
}

export async function getEntriesByCardId(db: HourTrackDB, cardId: string): Promise<Entry[]> {
  return db.entries.where('cardId').equals(cardId).toArray();
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

export async function deleteEntry(db: HourTrackDB, id: string): Promise<void> {
  await db.entries.delete(id);
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
 * Apply a partial patch to the (always single) settings row. The row is
 * created with defaults if it does not yet exist.
 */
export async function updateSettings(db: HourTrackDB, patch: Partial<Settings>): Promise<Settings> {
  const existing = await db.settings.get(SETTINGS_KEY);
  const base: Settings = existing
    ? (() => {
        const { key: _key, ...rest } = existing;
        return rest;
      })()
    : defaultSettings();
  const next: Settings = { ...base, ...patch };
  await db.settings.put({ key: SETTINGS_KEY, ...next });
  return next;
}
