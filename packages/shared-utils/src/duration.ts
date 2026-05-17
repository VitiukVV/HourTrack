/**
 * Duration formatting helpers. The DB stores durations as integer minutes;
 * the UI presents them as `{h}h {m}m` (e.g. `2h 45m`).
 *
 * These two functions are the ONLY sanctioned conversion path between minutes
 * and the human-facing format. UI code MUST NOT inline duration strings -- if
 * a new presentation is needed, add a helper here rather than format inline.
 */

/**
 * Format an integer number of minutes as `{h}h {m}m`.
 *
 * - Hours and minutes are NEVER zero-padded (`0h 5m`, not `00h 05m`).
 * - Lowercase `h` and `m` markers, a single space separator.
 * - Negative inputs are not expected (durationMin is non-negative by contract);
 *   if a caller violates that, behaviour is undefined.
 */
export function formatDuration(durationMin: number): string {
  const h = Math.floor(durationMin / 60);
  const m = durationMin % 60;
  return `${h}h ${m}m`;
}

/**
 * Combine separate hours + minutes inputs (the EntryEditor dual-input pattern)
 * into a single integer-minute value suitable for `Entry.durationMin`.
 */
export function parseDuration(hours: number, minutes: number): number {
  return hours * 60 + minutes;
}
