/**
 * Dexie database -- public re-exports.
 *
 * Import path convention:
 *   - `import { db } from '@/lib/db';`               // singleton runtime instance
 *   - `import { createCard, getAllCards, ... } from '@/lib/db';`
 *
 * Tests construct their own `HourTrackDB(<unique-name>)` instances via the
 * `schema` module to avoid sharing IndexedDB state across cases.
 */

export { db, HourTrackDB } from './schema';
export type { SettingsRow, SyncQueueRow } from './schema';

export {
  defaultSettings,
  initDB,
  // cards
  getAllCards,
  getArchivedCards,
  getCardById,
  createCard,
  updateCard,
  archiveCard,
  restoreCard,
  // entries
  getEntriesByDateRange,
  getEntriesByDate,
  getEntriesByCardId,
  createEntry,
  updateEntry,
  deleteEntry,
  // settings
  getSettings,
  updateSettings,
} from './queries';
