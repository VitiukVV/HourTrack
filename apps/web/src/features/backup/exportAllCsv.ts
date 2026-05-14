import { buildReportCsv, downloadCsv } from '@/features/reports/exportCsv';
import { db as defaultDb, getAllCards, getAllEntries, type HourTrackDB } from '@/lib/db';

/**
 * Export every entry across the entire database as a single CSV, ignoring all
 * report filters. Distinct from `DataSection`'s S08 wiring which uses the
 * `1970-01-01 → 2200-12-31` range hack — now we route through `getAllEntries`
 * (the S10 helper that replaced the hack) and through `getAllCards(db, true)`
 * to include archived cards so a CSV row for an entry on an archived card
 * still resolves the card name instead of falling through to "?".
 *
 * Returns the filename + row count so the caller can surface a toast with
 * concrete details.
 */
export interface ExportAllCsvResult {
  filename: string;
  entryCount: number;
}

export async function exportAllEntriesAsCsv(
  database: HourTrackDB = defaultDb,
  now: Date = new Date(),
): Promise<ExportAllCsvResult> {
  const [entries, cards] = await Promise.all([
    getAllEntries(database),
    // include archived cards so archived-card entries still resolve a name
    getAllCards(database, true),
  ]);
  const csv = buildReportCsv(entries, cards);
  const filename = `hourtrack-export-${now.toISOString().slice(0, 10)}.csv`;
  downloadCsv(filename, csv);
  return { filename, entryCount: entries.length };
}
