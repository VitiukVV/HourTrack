import type { Card, Entry } from '@hourtrack/shared-types';
import { earningsForEntry, formatDuration } from '@hourtrack/shared-utils';

import { db as defaultDb, getAllCards, getAllEntries, type HourTrackDB } from '@/lib/db';

/**
 * Export every entry across the entire database as a single CSV, ignoring all
 * report filters. Distinct from `DataSection`'s S08 wiring which uses the
 * `1970-01-01 → 2200-12-31` range hack — now we route through `getAllEntries`
 * (the S10 helper that replaced the hack) and through `getAllCards(db, true)`
 * to include archived cards so a CSV row for an entry on an archived card
 * still resolves the card name instead of falling through to "?".
 *
 * History: the CSV builder + downloader used to live at
 * `@/features/reports/exportCsv` so both the Reports page and this Settings →
 * Backup → "Export CSV (all data)" button shared the same implementation. S15
 * removed the Reports CSV surface (V2 decision #3) and deleted that module
 * along with it. The Settings backup export remains untouched per S15 scope,
 * so we own a private copy of the helpers here. Format is unchanged from
 * pre-S15 so existing exports stay byte-for-byte compatible.
 *
 * Returns the filename + row count so the caller can surface a toast with
 * concrete details.
 */

const CSV_HEADER =
  'date,card,durationMin,durationFormatted,useCustomPayment,customPayment,note,earnings';
const CSV_BOM = '﻿';
const CSV_QUOTABLE = /[",\r\n]/;

function csvEscape(value: string): string {
  if (value === '') return '';
  if (CSV_QUOTABLE.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildAllEntriesCsv(entries: Entry[], cards: Card[]): string {
  const cardsById = new Map(cards.map((c) => [c.id, c] as const));
  const entriesByCard = new Map<string, Entry[]>();
  for (const entry of entries) {
    const list = entriesByCard.get(entry.cardId);
    if (list) list.push(entry);
    else entriesByCard.set(entry.cardId, [entry]);
  }

  const lines: string[] = [CSV_HEADER];

  for (const entry of entries) {
    const card = cardsById.get(entry.cardId);
    const cardName = card?.name ?? '?';
    const earnings = card
      ? earningsForEntry(entry, card, entriesByCard.get(entry.cardId) ?? [])
      : 0;
    const fields = [
      entry.date,
      csvEscape(cardName),
      String(entry.durationMin),
      csvEscape(formatDuration(entry.durationMin)),
      entry.useCustomPayment ? 'Y' : 'N',
      entry.useCustomPayment && entry.customPayment != null ? entry.customPayment.toFixed(2) : '',
      csvEscape(entry.note ?? ''),
      earnings.toFixed(2),
    ];
    lines.push(fields.join(','));
  }

  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

function downloadCsv(filename: string, csv: string): void {
  // Blob respects the BOM byte we encoded in `csv` because we declare UTF-8.
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // Some browsers (older Safari) require the anchor to be attached to the DOM
  // before click() will trigger the download.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Defer revoke so the click is fully processed.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

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
  const csv = buildAllEntriesCsv(entries, cards);
  const filename = `hourtrack-export-${now.toISOString().slice(0, 10)}.csv`;
  downloadCsv(filename, csv);
  return { filename, entryCount: entries.length };
}

// Exported for unit tests; not part of the public feature API.
export const __internal = { buildAllEntriesCsv, csvEscape };
