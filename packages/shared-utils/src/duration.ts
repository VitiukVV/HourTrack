/**
 * Duration formatting helpers. The DB stores durations as integer minutes;
 * the UI presents them as `{H}H {M}M` (e.g. `2H 45M`) per req #21.
 *
 * These two functions are the ONLY sanctioned conversion path between minutes
 * and the human-facing format. UI code MUST NOT inline duration strings -- if
 * a new presentation is needed, add a helper here rather than format inline.
 */

/**
 * Format an integer number of minutes as `{H}H {M}M`.
 *
 * - Hours and minutes are NEVER zero-padded (`0H 5M`, not `00H 05M`).
 * - Uppercase `H` and `M` markers, a single space separator.
 * - Negative inputs are not expected (durationMin is non-negative by contract);
 *   if a caller violates that, behaviour is undefined.
 */
export function formatDuration(durationMin: number): string {
  const h = Math.floor(durationMin / 60);
  const m = durationMin % 60;
  return `${h}H ${m}M`;
}

/**
 * Combine separate hours + minutes inputs (the EntryEditor dual-input pattern)
 * into a single integer-minute value suitable for `Entry.durationMin`.
 */
export function parseDuration(hours: number, minutes: number): number {
  return hours * 60 + minutes;
}
