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
export type { SettingsRow, SyncQueueRow, SyncQueueOp, TombstoneRow } from './schema';

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
  deleteCardPermanently,
  // entries
  getAllEntries,
  getEntriesByDateRange,
  getEntriesByDate,
  getEntryById,
  getEntriesByCardId,
  getEntriesByCardAndDate,
  createEntry,
  updateEntry,
  deleteEntry,
  // payments
  getAllPayments,
  listPaymentsByPeriod,
  listPaymentsForCardPeriod,
  createPayment,
  updatePayment,
  deletePayment,
  // settings
  getSettings,
  updateSettings,
  // sync queue
  enqueueSyncOp,
  getReadySyncQueueRows,
  getAllSyncQueueRows,
  deleteSyncQueueRow,
  rescheduleSyncQueueRow,
  // tombstones
  writeTombstone,
  getAllTombstones,
  clearTombstone,
  pruneOldTombstones,
} from './queries';
