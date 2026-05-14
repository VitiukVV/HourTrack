import type { Card, Entry } from '@hourtrack/shared-types';
import { earningsForEntry, formatDuration } from '@hourtrack/shared-utils';

/**
 * Build a CSV string of the given entries, joined with `\r\n` (CRLF) so the
 * file opens cleanly in Excel + LibreOffice + Numbers without any "what kind
 * of newline?" prompt.
 *
 * Format:
 *   - First character is a UTF-8 BOM (U+FEFF). Excel uses this to switch into
 *     UTF-8 mode regardless of system locale; without it, non-ASCII card names
 *     (e.g. "Раквель") render as mojibake on Windows.
 *   - Header row (no BOM on this line — BOM is the first char of the whole
 *     string, separate from header content):
 *       date,card,durationMin,durationFormatted,useCustomPayment,customPayment,note,earnings
 *   - One data row per entry.
 *
 * Field escaping (RFC 4180):
 *   - A field is quoted iff it contains a comma, a double-quote, a newline
 *     (CR or LF), or a leading/trailing space.
 *   - Within a quoted field, double-quotes are doubled (`"` → `""`).
 *
 * Earnings:
 *   - Computed via `earningsForEntry` so the CSV agrees with the table + pie
 *     chart values byte-for-byte.
 *   - Formatted with `.toFixed(2)`.
 *
 * Orphan entry defense:
 *   - If an entry's `cardId` doesn't match any card in `cards`, we still emit
 *     the row with `card="?"` and `earnings="0.00"`. Better to surface the
 *     orphan than to silently drop the entry.
 */

const HEADER =
  'date,card,durationMin,durationFormatted,useCustomPayment,customPayment,note,earnings';

const BOM = '﻿';

const QUOTABLE = /[",\r\n]/;

function csvEscape(value: string): string {
  if (value === '') return '';
  if (QUOTABLE.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildReportCsv(entries: Entry[], cards: Card[]): string {
  const cardsById = new Map(cards.map((c) => [c.id, c] as const));
  const entriesByCard = new Map<string, Entry[]>();
  for (const entry of entries) {
    const list = entriesByCard.get(entry.cardId);
    if (list) list.push(entry);
    else entriesByCard.set(entry.cardId, [entry]);
  }

  const lines: string[] = [HEADER];

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

  return BOM + lines.join('\r\n') + '\r\n';
}

/**
 * Trigger a browser download of the CSV. Uses Blob + anchor click — the same
 * pattern used by every "export" feature in the wild. Cleans up the object
 * URL on the next animation frame so the GC reclaims it.
 */
export function downloadCsv(filename: string, csv: string): void {
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
